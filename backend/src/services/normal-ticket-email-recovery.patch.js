import { AppError } from '../core/errors.js';
import { nowIso, pick } from '../core/utils.js';
import { findById, updateRow } from '../infra/sheets.repository.js';
import { ticketDeliveryHandlers } from '../modules/ticket-delivery.module.js';
import { generateTicketWithAppsScript } from './apps-script-ticket-group.service.js';
import { audit } from './audit.service.js';
import {
  ensureVisitGroupForTicket,
  groupSummary,
} from './ticket-visit-group.service.js';

const INSTALL_FLAG = Symbol.for('dms.normalTicketEmailRecovery');
const running = new Map();

function clean(value) {
  return String(value ?? '').trim();
}

function finalized(value) {
  return clean(value).toUpperCase().includes('FINAL');
}

function isMaintenanceTicket(ticket = {}) {
  return Boolean(clean(ticket.OrigenMantenimientoID))
    || ticket.EsBoletaMantenimiento === true
    || clean(ticket.EsBoletaMantenimiento).toLowerCase() === 'true';
}

function reportForTicket(reports, ticket) {
  const uid = clean(ticket?.BoletaUID);
  const number = clean(ticket?.BoletaID);
  return (Array.isArray(reports) ? reports : []).find((report) => (
    clean(report.ticketUid || report.BoletaUID) === uid
    || (number && clean(report.ticketNumber || report.BoletaID) === number)
  )) || null;
}

function emailFailureRecorded(ticket = {}) {
  const state = clean(ticket.EstadoNotificacion).toUpperCase();
  const error = clean(ticket.UltimoErrorNotificacion).toLowerCase();
  if (['OMITIDO', 'PENDIENTE'].includes(state) || !state) return true;
  if (!['ERROR', 'PARCIAL'].includes(state)) return false;
  return error.includes('correo')
    || error.includes('email')
    || error.includes('correo_app_script')
    || error.includes('apps script');
}

function emailConfirmed(delivery = {}) {
  const notification = (delivery.notifications || []).find(
    (item) => clean(item.channel).toUpperCase() === 'CORREO_APPS_SCRIPT',
  );
  return Boolean(
    notification
    && notification.ok === true
    && notification.skipped !== true
    && notification.result?.sent === true,
  );
}

function existingSurvey(group = {}) {
  const url = clean(group.root?.EncuestaURL || group.root?.SurveyURL);
  return url ? { url, type: 'REAL' } : null;
}

function existingSignatureRequest(group = {}) {
  const url = clean(
    group.root?.FirmaURLPublica
    || group.root?.FirmaPublicaURL
    || group.root?.FirmaSolicitudURL,
  );
  return url ? { url } : null;
}

function runOnce(key, operation) {
  if (running.has(key)) return running.get(key);
  const promise = Promise.resolve().then(operation).finally(() => running.delete(key));
  running.set(key, promise);
  return promise;
}

async function recoverNormalTicketEmail(ctx, group, reason = 'ESTADO_HISTORICO') {
  return runOnce(`normal-ticket-email-recovery:${group.rootId}`, async () => {
    const currentGroup = await ensureVisitGroupForTicket(
      group.rootId,
      ctx.user?.UsuarioID || 'SISTEMA',
    );

    if (currentGroup.visits.some((visit) => isMaintenanceTicket(visit))) {
      throw new AppError(
        'MAINTENANCE_TICKET_EMAIL_DISABLED',
        'Las boletas automáticas de mantenimiento no se envían por correo.',
        409,
      );
    }

    const report = await generateTicketWithAppsScript({
      ticketId: currentGroup.rootId,
      testMode: false,
      sendEmail: true,
      survey: existingSurvey(currentGroup),
      signatureRequest: existingSignatureRequest(currentGroup),
      deliveryType: 'NORMAL_EMAIL_RECOVERY',
    });

    if (report.email?.sent !== true || report.email?.skipped === true) {
      throw new AppError(
        'NORMAL_TICKET_EMAIL_NOT_SENT',
        report.email?.error || 'Apps Script generó el reporte, pero no confirmó el envío del correo de la boleta normal.',
        502,
      );
    }

    const timestamp = nowIso();
    const actor = ctx.user?.UsuarioID || 'SISTEMA';
    for (const visit of currentGroup.visits) {
      const ownReport = reportForTicket(report.reports, visit) || report;
      await updateRow('Boletas', visit.BoletaUID, {
        Estado: 'FINALIZADA',
        FinalizadaEn: visit.FinalizadaEn || timestamp,
        EstadoNotificacion: 'ENVIADO',
        UltimoErrorNotificacion: '',
        DocumentoURL: ownReport.documentUrl || report.documentUrl || visit.DocumentoURL || '',
        PDFURL: ownReport.pdfUrl || report.pdfUrl || visit.PDFURL || '',
        CarpetaURL: ownReport.folderUrl || report.folderUrl || visit.CarpetaURL || '',
        ActualizadoPor: actor,
        FechaActualizacion: timestamp,
      });
    }

    const updatedGroup = await ensureVisitGroupForTicket(currentGroup.rootId, actor);
    await audit(ctx, 'RECUPERAR_CORREO_BOLETA_NORMAL', 'Boletas', updatedGroup.rootId, null, {
      Motivo: reason,
      CantidadVisitas: updatedGroup.visits.length,
      CorreoEnviado: true,
      Destinatarios: [
        ...(Array.isArray(report.recipients?.to) ? report.recipients.to : []),
        ...(Array.isArray(report.recipients?.cc) ? report.recipients.cc : []),
      ],
      ChatReenviado: false,
      Reportes: report.reports || [],
    }).catch(() => {});

    return {
      boleta: updatedGroup.root,
      grupoVisitas: groupSummary(updatedGroup),
      emailRecovered: true,
      delivery: {
        report,
        notifications: [{
          entityId: updatedGroup.rootId,
          channel: 'CORREO_APPS_SCRIPT',
          destination: [
            ...(Array.isArray(report.recipients?.to) ? report.recipients.to : []),
            ...(Array.isArray(report.recipients?.cc) ? report.recipients.cc : []),
          ].join(', '),
          type: 'RECUPERACION_CORREO_BOLETA_NORMAL',
          ok: true,
          result: report.email,
        }],
        notificationState: 'ENVIADO',
        errors: [],
      },
      message: 'El correo de la boleta normal fue enviado correctamente sin reenviar los mensajes de Google Chat.',
    };
  });
}

if (!ticketDeliveryHandlers[INSTALL_FLAG]) {
  const originalFinalize = ticketDeliveryHandlers.finalize;

  ticketDeliveryHandlers.finalize = async (ctx) => {
    const requestedId = pick(ctx.payload, ['boletaUid', 'BoletaUID', 'id']);
    const requestedTicket = await findById('Boletas', requestedId);

    // Las boletas de mantenimiento conservan el handler de archivo existente:
    // PDF sí, correo no.
    if (isMaintenanceTicket(requestedTicket)) return originalFinalize(ctx);

    const beforeGroup = await ensureVisitGroupForTicket(
      requestedTicket.BoletaUID,
      ctx.user?.UsuarioID || 'SISTEMA',
    );

    const alreadyFinalized = beforeGroup.visits.every((visit) => finalized(visit.Estado));
    const historicalEmailPending = alreadyFinalized
      && beforeGroup.visits.some((visit) => emailFailureRecorded(visit));

    if (historicalEmailPending) {
      return recoverNormalTicketEmail(ctx, beforeGroup, 'FINALIZADA_SIN_CORREO_CONFIRMADO');
    }

    const result = await originalFinalize(ctx);

    // Una finalización nueva de boleta normal debe confirmar realmente el correo.
    // Si una versión antigua de Apps Script devuelve skipped/ausente, recuperamos
    // el correo inmediatamente en lugar de dejar la boleta silenciosamente cerrada.
    if (result?.delivery && !emailConfirmed(result.delivery)) {
      const afterGroup = await ensureVisitGroupForTicket(
        requestedTicket.BoletaUID,
        ctx.user?.UsuarioID || 'SISTEMA',
      );
      return recoverNormalTicketEmail(ctx, afterGroup, 'FINALIZACION_SIN_CONFIRMACION_DE_CORREO');
    }

    return result;
  };

  ticketDeliveryHandlers[INSTALL_FLAG] = true;
}
