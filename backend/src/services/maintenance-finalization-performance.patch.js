import { nowIso, pick } from '../core/utils.js';
import { findById, updateRow } from '../infra/sheets.repository.js';
import { maintenanceAutomationHandlers } from '../modules/maintenance-automation.module.js';
import { maintenanceHandlers } from '../modules/maintenance.module.js';
import { maintenanceProgressChatHandlers } from '../modules/maintenance-progress-chat.module.js';
import { ticketDeliveryHandlers } from '../modules/ticket-delivery.module.js';
import { audit } from './audit.service.js';
import {
  generateMaintenanceTicketsFast,
  fitMaintenanceTicketCell,
} from './maintenance-fast-ticket-generation.service.js';
import { deliverMaintenanceFast } from './maintenance-fast-delivery.service.js';
import { runResumableMaintenanceFinalization } from './maintenance-finalization-state.service.js';
import { ensureMaintenanceQuestionsReady } from './maintenance-question-bootstrap.service.js';
import { maintenanceHasSignature } from './maintenance-signature-request.service.js';
import { ensureSheetColumns } from './sheet-columns.service.js';

const INSTALL_FLAG = Symbol.for('dms.maintenanceFinalizationPerformance');
const ROUTER_INSTALL_FLAG = Symbol.for('dms.maintenanceFinalizationPerformance.router');

const DELIVERY_COLUMNS = [
  'CarpetaDriveID',
  'CarpetaDriveURL',
  'EstadoNotificacion',
  'ChatDestino',
  'ChatEnviadoEn',
  'ChatFallbackPruebas',
  'ImagenesEsperadas',
  'ImagenesCopiadas',
  'ImagenesYaExistentes',
  'ErroresCopia',
];

const SIGNATURE_FINALIZATION_COLUMNS = [
  'FirmaEstadoFinalizacion',
  'FirmaOmitidaAlFinalizar',
];

function clean(value) {
  return String(value ?? '').trim();
}

function maintenanceId(ctx) {
  return clean(pick(ctx.payload, ['maintenanceId', 'MantenimientoID', 'id']));
}

function testMode(ctx) {
  return Boolean(ctx.payload?.testMode || ctx.payload?.prueba);
}

async function refreshReusedSignedReports(ctx, ticketGeneration) {
  const reused = (ticketGeneration?.tickets || []).filter((ticket) => ticket.reused);
  const refreshed = [];
  // Apps Script aún usa un lock global. Se conserva secuencial únicamente este
  // caso excepcional (boletas ya finalizadas que deben incorporar una firma).
  for (const ticket of reused) {
    const report = await ticketDeliveryHandlers.generatePdf({
      ...ctx,
      permissions: [...new Set([
        ...(ctx.permissions || []),
        'USUARIOS_GESTIONAR',
        'BOLETAS_VER',
        'BOLETAS_EDITAR',
      ])],
      payload: {
        boletaUid: ticket.ticketId,
        BoletaUID: ticket.ticketId,
        id: ticket.ticketId,
      },
    });
    refreshed.push({
      ticketId: ticket.ticketId,
      pdfUrl: report.pdfUrl || '',
      signatureIncluded: true,
    });
  }
  return refreshed;
}

async function recordSignatureState(ctx, id, included) {
  await ensureSheetColumns('Mantenimiento', SIGNATURE_FINALIZATION_COLUMNS);
  const timestamp = nowIso();
  await updateRow('Mantenimiento', id, {
    FirmaEstadoFinalizacion: included ? 'INCLUIDA' : 'OMITIDA',
    FirmaOmitidaAlFinalizar: !included,
    ActualizadoPor: ctx.user?.UsuarioID || 'SISTEMA',
    FechaActualizacion: timestamp,
  });
  await audit(
    ctx,
    included ? 'FINALIZAR_MANTENIMIENTO_CON_FIRMA' : 'FINALIZAR_MANTENIMIENTO_SIN_FIRMA',
    'Mantenimiento',
    id,
    null,
    {
      FirmaEstadoFinalizacion: included ? 'INCLUIDA' : 'OMITIDA',
      FirmaOmitidaAlFinalizar: !included,
    },
  ).catch(() => {});
}

async function persistDelivery(ctx, id, delivery, signatureIncluded) {
  await ensureSheetColumns('Mantenimiento', DELIVERY_COLUMNS);
  const timestamp = nowIso();
  const notificationSent = delivery.notificationState === 'ENVIADO';
  await updateRow('Mantenimiento', id, {
    Estado: 'FINALIZADO',
    FechaFinalizacion: timestamp,
    CarpetaDriveID: delivery.folderId,
    CarpetaDriveURL: delivery.folderUrl,
    EstadoNotificacion: delivery.notificationState,
    ChatDestino: delivery.destination,
    ChatEnviadoEn: notificationSent ? timestamp : '',
    ChatFallbackPruebas: delivery.fallbackToTest,
    ImagenesEsperadas: delivery.imagesExpected,
    ImagenesCopiadas: delivery.imagesCopied,
    ImagenesYaExistentes: delivery.imagesAlreadyPresent,
    ErroresCopia: fitMaintenanceTicketCell(delivery.errors.join(' | ')),
    FirmaEstadoFinalizacion: signatureIncluded ? 'INCLUIDA' : 'OMITIDA',
    FirmaOmitidaAlFinalizar: !signatureIncluded,
    ActualizadoPor: ctx.user?.UsuarioID || 'SISTEMA',
    FechaActualizacion: timestamp,
  });
  return timestamp;
}

async function finalizeOptimized(ctx, id, tracker) {
  await tracker.mark('VALIDANDO');
  const before = await findById('Mantenimiento', id);
  const signatureIncluded = maintenanceHasSignature(before);

  await tracker.mark('GENERANDO_BOLETAS');
  let ticketGeneration;
  try {
    ticketGeneration = await generateMaintenanceTicketsFast(ctx, id);
  } catch (error) {
    await updateRow('Mantenimiento', id, {
      EstadoBoletasMantenimiento: 'ERROR',
      UltimoErrorBoletasMantenimiento: clean(error?.message || error).slice(0, 1500),
      ActualizadoPor: ctx.user?.UsuarioID || 'SISTEMA',
      FechaActualizacion: nowIso(),
    }).catch(() => {});
    throw error;
  }

  const refreshedSignedReports = signatureIncluded
    ? await refreshReusedSignedReports(ctx, ticketGeneration)
    : [];

  await tracker.mark('ENTREGANDO', {
    EstadoNotificacion: 'ENVIANDO',
  });
  const delivery = await deliverMaintenanceFast(ctx, id, { testMode: false });
  const finalizedAt = await persistDelivery(ctx, id, delivery, signatureIncluded);
  await recordSignatureState(ctx, id, signatureIncluded);

  const result = await maintenanceHandlers.get({
    ...ctx,
    payload: { maintenanceId: id },
  });

  await audit(ctx, 'FINALIZAR_MANTENIMIENTO_CON_ENTREGA', 'Mantenimiento', id, before, {
    Estado: 'FINALIZADO',
    CarpetaDriveURL: delivery.folderUrl,
    ChatDestino: delivery.destination,
    EstadoNotificacion: delivery.notificationState,
    ChatError: delivery.chatError || '',
    ImagenesEsperadas: delivery.imagesExpected,
    ImagenesCopiadas: delivery.imagesCopied,
    ImagenesYaExistentes: delivery.imagesAlreadyPresent,
    ErroresCopia: delivery.errors.length,
    BoletasGeneradas: ticketGeneration.ticketCount,
    FinalizacionOptimizada: true,
    FechaFinalizacion: finalizedAt,
  }).catch(() => {});

  const notificationWarning = delivery.chatError
    ? ` El mantenimiento quedó finalizado, pero Google Chat reportó: ${delivery.chatError}`
    : delivery.notificationState !== 'ENVIADO'
      ? ' El mantenimiento quedó finalizado, pero no había un Chat válido configurado.'
      : '';

  return {
    ...result,
    delivery,
    signatureIncluded,
    signatureStatus: signatureIncluded ? 'INCLUIDA' : 'OMITIDA',
    ticketGeneration: {
      ...ticketGeneration,
      signatureIncluded,
      refreshedSignedReports,
    },
    message: `Mantenimiento finalizado. Se generaron ${ticketGeneration.ticketCount} boleta(s) y se procesaron ${delivery.imagesExpected} evidencia(s).${notificationWarning}`,
  };
}

if (!maintenanceAutomationHandlers[INSTALL_FLAG]) {
  const previousFinalize = maintenanceAutomationHandlers.finalize;

  maintenanceAutomationHandlers.finalize = async (ctx) => {
    if (testMode(ctx)) return previousFinalize(ctx);
    const id = maintenanceId(ctx);
    return runResumableMaintenanceFinalization(
      ctx,
      id,
      (tracker) => finalizeOptimized(ctx, id, tracker),
    );
  };

  maintenanceAutomationHandlers[INSTALL_FLAG] = true;
}

// El router no despacha directamente maintenanceAutomationHandlers. La cadena
// question-ready/progress-chat crea objetos nuevos mediante spread/wrappers y,
// por tanto, conserva una referencia histórica de finalize. Instalamos también
// aquí el camino optimizado sobre el objeto final que action-router importa.
if (!maintenanceProgressChatHandlers[ROUTER_INSTALL_FLAG]) {
  const previousRouterFinalize = maintenanceProgressChatHandlers.finalize;
  maintenanceProgressChatHandlers.finalize = async (ctx) => {
    if (testMode(ctx)) return previousRouterFinalize(ctx);
    await ensureMaintenanceQuestionsReady(ctx.user?.UsuarioID || 'SYSTEM');
    return maintenanceAutomationHandlers.finalize(ctx);
  };
  maintenanceProgressChatHandlers[ROUTER_INSTALL_FLAG] = true;
}
