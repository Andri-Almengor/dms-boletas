import { forbidden } from '../core/errors.js';
import { nowIso, pick } from '../core/utils.js';
import { findById, updateRow } from '../infra/sheets.repository.js';
import { maintenanceHandlers } from '../modules/maintenance.module.js';
import { maintenanceReportAccessHandlers } from '../modules/maintenance-report-access.module.js';
import { maintenanceSignatureHandlers } from '../modules/maintenance-signature.module.js';
import { audit } from './audit.service.js';
import { deliverMaintenance } from './maintenance-delivery.service.js';
import {
  currentMaintenanceSignature,
  replaceMaintenanceSignature,
} from './maintenance-signature-state.service.js';

const REPORT_FLAG = Symbol.for('dms.maintenanceReportGridLimitHotfix');
const SIGNATURE_FLAG = Symbol.for('dms.maintenanceSignatureEditHotfix');

function clean(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function isAdmin(ctx) {
  return ctx.permissions?.includes('USUARIOS_GESTIONAR')
    || ctx.permissions?.includes('MANTENIMIENTOS_GESTIONAR')
    || ctx.permissions?.includes('MANTENIMIENTOS_ELIMINAR');
}

function canEditSignature(ctx) {
  return isAdmin(ctx)
    || ctx.permissions?.includes('MANTENIMIENTOS_EDITAR')
    || ctx.permissions?.includes('BOLETAS_EDITAR');
}

function maintenanceView(maintenance = {}, signed = false) {
  return {
    subjectType: 'maintenance',
    uid: clean(maintenance.MantenimientoID),
    number: clean(maintenance.MantenimientoID),
    title: clean(maintenance.TituloMantenimiento, 'Mantenimiento técnico'),
    clientName: clean(maintenance.Cliente, 'Cliente'),
    date: maintenance.Fecha || '',
    location: clean(maintenance.Ubicacion),
    description: clean(maintenance.DescripcionGeneral),
    supervisor: clean(maintenance.Responsables || maintenance.Responsable),
    signed,
    visitCount: 1,
    visits: [],
  };
}

function signedResponse(state) {
  const maintenance = maintenanceView(state.maintenance, true);
  return {
    request: {
      id: state.requestId || '',
      token: '',
      maintenanceId: clean(state.maintenance?.MantenimientoID),
      clientId: clean(state.maintenance?.ClienteID),
      clientName: clean(state.maintenance?.Cliente, 'Cliente'),
      maintenanceTitle: clean(state.maintenance?.TituloMantenimiento, 'Mantenimiento técnico'),
      url: '',
      status: 'FIRMADA',
      testMode: false,
      subjectType: 'maintenance',
      signedAt: state.signedAt || '',
    },
    signed: true,
    testMode: false,
    maintenance,
    ticket: maintenance,
    signature: {
      fileId: state.fileId || '',
      url: state.url || '',
      mimeType: state.mimeType || 'image/png',
      signedAt: state.signedAt || '',
      origin: state.origin || '',
      source: state.source || '',
      dataUrl: state.dataUrl || '',
      mediaError: state.mediaError || '',
    },
  };
}

async function finalizeWithoutGrowingMaintenanceGrid(ctx) {
  const id = pick(ctx.payload, ['maintenanceId', 'MantenimientoID', 'id']);
  const testMode = Boolean(ctx.payload.testMode || ctx.payload.prueba);
  if (testMode && !isAdmin(ctx)) {
    throw forbidden('Solo los administradores pueden probar el envío de mantenimientos.');
  }

  const before = await findById('Mantenimiento', id);
  const delivery = await deliverMaintenance(ctx, id, { testMode });

  if (testMode) {
    await audit(ctx, 'PROBAR_ENVIO_MANTENIMIENTO', 'Mantenimiento', id, before, {
      Estado: before.Estado,
      CarpetaDriveURL: delivery.folderUrl,
      ChatDestino: delivery.destination,
      EstadoCambiado: false,
    });
    return {
      tested: true,
      stateChanged: false,
      maintenanceId: id,
      delivery,
      message: 'La prueba fue enviada al Chat de pruebas sin cambiar el estado del mantenimiento.',
    };
  }

  // No se crean columnas nuevas aquí. updateRow persiste únicamente los campos
  // que ya existan y el job escalonado conserva el estado durable del proceso.
  const timestamp = nowIso();
  await updateRow('Mantenimiento', id, {
    Estado: 'FINALIZADO',
    FechaFinalizacion: timestamp,
    CarpetaDriveID: delivery.folderId,
    CarpetaDriveURL: delivery.folderUrl,
    EstadoNotificacion: 'ENVIADO',
    ChatDestino: delivery.destination,
    ChatEnviadoEn: timestamp,
    ChatFallbackPruebas: delivery.fallbackToTest,
    ImagenesEsperadas: delivery.imagesExpected,
    ImagenesCopiadas: delivery.imagesCopied,
    ImagenesYaExistentes: delivery.imagesAlreadyPresent,
    ErroresCopia: delivery.errors.join(' | '),
    ActualizadoPor: ctx.user?.UsuarioID || 'SISTEMA',
    FechaActualizacion: timestamp,
  });

  const result = await maintenanceHandlers.get({ ...ctx, payload: { maintenanceId: id } });
  await audit(ctx, 'FINALIZAR_MANTENIMIENTO_CON_ENTREGA', 'Mantenimiento', id, before, {
    ...result.mantenimiento,
    CarpetaDriveURL: delivery.folderUrl,
    ChatDestino: delivery.destination,
    ImagenesCopiadas: delivery.imagesCopied,
  });
  return { ...result, delivery };
}

if (!maintenanceReportAccessHandlers[REPORT_FLAG]) {
  maintenanceReportAccessHandlers.finalize = finalizeWithoutGrowingMaintenanceGrid;
  maintenanceReportAccessHandlers[REPORT_FLAG] = true;
}

if (!maintenanceSignatureHandlers[SIGNATURE_FLAG]) {
  const originalLink = maintenanceSignatureHandlers.link;

  maintenanceSignatureHandlers.link = async (ctx) => {
    const maintenanceId = clean(pick(ctx.payload, ['maintenanceId', 'MantenimientoID', 'id']));
    const replacementBase64 = clean(pick(ctx.payload, ['base64', 'signatureBase64', 'firmaBase64']));

    if (replacementBase64) {
      if (!canEditSignature(ctx)) {
        throw forbidden('No tiene permiso para editar la firma del mantenimiento.');
      }
      const state = await replaceMaintenanceSignature({
        maintenanceId,
        base64: replacementBase64,
        mimeType: clean(ctx.payload.mimeType, 'image/png'),
        actor: ctx.user?.UsuarioID || 'SISTEMA',
      });
      await audit(ctx, 'EDITAR_FIRMA_MANTENIMIENTO', 'Mantenimiento', maintenanceId, null, {
        FirmaArchivoID: state.fileId,
        FirmaURL: state.url,
        BoletasSincronizadas: state.synchronizedTickets,
      }).catch(() => {});
      return {
        ...signedResponse(state),
        replaced: true,
        synchronizedTickets: state.synchronizedTickets,
        message: state.synchronizedTickets > 0
          ? `Firma actualizada y sincronizada con ${state.synchronizedTickets} boleta(s) del mantenimiento.`
          : 'Firma del mantenimiento actualizada correctamente.',
      };
    }

    const state = await currentMaintenanceSignature(maintenanceId, {
      includeDataUrl: true,
      backfill: true,
    });
    if (state.signed) return signedResponse(state);

    return originalLink(ctx);
  };

  maintenanceSignatureHandlers[SIGNATURE_FLAG] = true;
}
