import { findById, updateRow } from '../infra/sheets.repository.js';
import { badRequest, forbidden } from '../core/errors.js';
import { nowIso, pick } from '../core/utils.js';
import { audit } from '../services/audit.service.js';
import { deliverTicket, resendTicketChats } from '../services/ticket-delivery.service.js';
import { generateTicketWithAppsScript } from '../services/apps-script-ticket.service.js';
import { ticketAccessHandlers } from './ticket-access.module.js';

const running = new Map();

async function runOnce(key, operation) {
  if (running.has(key)) return running.get(key);
  const promise = Promise.resolve().then(operation).finally(() => running.delete(key));
  running.set(key, promise);
  return promise;
}

function isFinalized(value) {
  return String(value || '').trim().toUpperCase().includes('FINAL');
}

export const ticketDeliveryHandlers = {
  list: ticketAccessHandlers.list,
  get: ticketAccessHandlers.get,
  mediaGet: ticketAccessHandlers.mediaGet,
  update: ticketAccessHandlers.update,
  autosave: ticketAccessHandlers.autosave,
  evidenceUpload: ticketAccessHandlers.evidenceUpload,
  evidenceUpdate: ticketAccessHandlers.evidenceUpdate,
  evidenceDelete: ticketAccessHandlers.evidenceDelete,
  signatureUpload: ticketAccessHandlers.signatureUpload,

  finalize: async (ctx) => {
    const id = pick(ctx.payload, ['boletaUid', 'BoletaUID', 'id']);
    return runOnce(`finalize:${id}`, async () => {
      const before = await findById('Boletas', id);
      if (isFinalized(before.Estado)) {
        return { boleta: before, alreadyFinalized: true };
      }
      const delivery = await deliverTicket(ctx, { ticketId: id, testMode: false });
      const surveyUrl = delivery.report.survey?.url || '';
      const after = await updateRow('Boletas', id, {
        Estado: 'FINALIZADA',
        FinalizadaEn: nowIso(),
        DocumentoURL: delivery.report.documentUrl,
        PDFURL: delivery.report.pdfUrl,
        CarpetaURL: delivery.report.folderUrl,
        EncuestaURL: surveyUrl,
        EstadoNotificacion: delivery.notificationState,
        UltimoErrorNotificacion: delivery.errors.join(' | '),
        ActualizadoPor: ctx.user.UsuarioID,
        FechaActualizacion: nowIso(),
      });
      await audit(ctx, 'FINALIZAR_BOLETA', 'Boletas', id, before, after);
      return { boleta: after, delivery, surveyUrl };
    });
  },

  resendChats: async (ctx) => {
    const id = pick(ctx.payload, ['boletaUid', 'BoletaUID', 'id']);
    await ticketAccessHandlers.assertCanModifyFinalized(ctx, id);
    return runOnce(`resend-chats:${id}`, async () => {
      const before = await findById('Boletas', id);
      if (!isFinalized(before.Estado)) {
        throw badRequest('Solo se pueden reenviar a los chats las boletas finalizadas.');
      }
      const delivery = await resendTicketChats(ctx, { ticketId: id });
      const after = await findById('Boletas', id);
      await audit(ctx, 'REENVIAR_BOLETA_CHATS', 'Boletas', id, before, {
        ...after,
        Canales: ['CHAT_BOLETAS', 'CHAT_CLIENTE'],
        CorreoEnviado: false,
        EstadoReenvio: delivery.notificationState,
        Errores: delivery.errors,
      });
      const clientSkipped = delivery.notifications.some((item) => item.channel === 'CHAT_CLIENTE' && item.skipped);
      return {
        boleta: after,
        delivery,
        emailSent: false,
        message: clientSkipped
          ? 'La boleta fue reenviada al Chat de boletas. El cliente no tiene un Chat configurado. No se envió correo.'
          : 'La boleta fue reenviada únicamente al Chat de boletas y al Chat del cliente. No se envió correo.',
      };
    });
  },

  testFinalize: async (ctx) => {
    if (!ctx.permissions.includes('USUARIOS_GESTIONAR')) {
      throw forbidden('Solo un administrador puede ejecutar las pruebas de correo y Google Chat.');
    }
    const id = pick(ctx.payload, ['boletaUid', 'BoletaUID', 'id']);
    return runOnce(`test:${id}`, async () => {
      const delivery = await deliverTicket(ctx, { ticketId: id, testMode: true });
      await audit(ctx, 'PROBAR_NOTIFICACIONES_BOLETA', 'Boletas', id, null, {
        Estado: 'PRUEBA',
        Resultado: delivery.notificationState,
        Errores: delivery.errors,
        DocumentoURL: delivery.report.documentUrl,
        PDFURL: delivery.report.pdfUrl,
      });
      return { tested: true, stateChanged: false, delivery };
    });
  },

  generatePdf: async (ctx) => {
    const id = pick(ctx.payload, ['boletaUid', 'BoletaUID', 'id']);
    await ticketAccessHandlers.assertCanModifyFinalized(ctx, id);
    return runOnce(`pdf:${id}`, async () => {
      const current = await findById('Boletas', id);
      const surveyUrl = String(current.EncuestaURL || current.SurveyURL || '').trim();
      const report = await generateTicketWithAppsScript({
        ticketId: id,
        testMode: false,
        sendEmail: false,
        survey: surveyUrl ? { url: surveyUrl, type: 'REAL' } : null,
      });
      await updateRow('Boletas', id, {
        DocumentoURL: report.documentUrl,
        PDFURL: report.pdfUrl,
        CarpetaURL: report.folderUrl,
        ActualizadoPor: ctx.user.UsuarioID,
        FechaActualizacion: nowIso(),
      });
      await audit(ctx, 'GENERAR_REPORTE_BOLETA', 'Boletas', id, null, {
        DocumentoURL: report.documentUrl,
        PDFURL: report.pdfUrl,
        CarpetaURL: report.folderUrl,
      });
      return {
        boletaUid: id,
        documentId: report.documentId,
        documentUrl: report.documentUrl,
        pdfId: report.pdfId,
        pdfUrl: report.pdfUrl,
        folderId: report.folderId,
        folderUrl: report.folderUrl,
        evidenceCount: report.evidences.length,
      };
    });
  },
};
