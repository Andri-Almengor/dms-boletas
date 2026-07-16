import { findById, updateRow } from '../infra/sheets.repository.js';
import { badRequest, forbidden } from '../core/errors.js';
import { nowIso, pick } from '../core/utils.js';
import { audit } from '../services/audit.service.js';
import { deliverTicket, resendTicketChats } from '../services/ticket-group-delivery.service.js';
import { generateTicketWithAppsScript } from '../services/apps-script-ticket-group.service.js';
import {
  ensureVisitGroupForTicket,
  groupSummary,
} from '../services/ticket-visit-group.service.js';
import { ticketAccessHandlers } from './ticket-access.module.js';

const running = new Map();

async function runOnce(key, operation) {
  if (running.has(key)) return running.get(key);
  const promise = Promise.resolve().then(operation).finally(() => running.delete(key));
  running.set(key, promise);
  return promise;
}

function clean(value) {
  return String(value ?? '').trim();
}

function isFinalized(value) {
  return clean(value).toUpperCase().includes('FINAL');
}

function reportForTicket(reports, ticket) {
  const uid = clean(ticket.BoletaUID);
  const number = clean(ticket.BoletaID);
  return (Array.isArray(reports) ? reports : []).find((report) => (
    clean(report.ticketUid || report.BoletaUID) === uid
    || (number && clean(report.ticketNumber || report.BoletaID) === number)
  )) || null;
}

async function persistReportPerVisit(group, report, commonPatch, actor) {
  const reports = Array.isArray(report?.reports) ? report.reports : [];
  const timestamp = nowIso();
  for (const visit of group.visits) {
    const ownReport = reportForTicket(reports, visit);
    await updateRow('Boletas', visit.BoletaUID, {
      ...commonPatch,
      DocumentoURL: ownReport?.documentUrl || report?.documentUrl || '',
      PDFURL: ownReport?.pdfUrl || report?.pdfUrl || '',
      CarpetaURL: ownReport?.folderUrl || report?.folderUrl || '',
      ActualizadoPor: actor,
      FechaActualizacion: timestamp,
    });
  }
  return ensureVisitGroupForTicket(group.rootId, actor);
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
  returnPending: ticketAccessHandlers.returnPending,
  annul: ticketAccessHandlers.annul,

  finalize: async (ctx) => {
    const requestedId = pick(ctx.payload, ['boletaUid', 'BoletaUID', 'id']);
    const requestedTicket = await findById('Boletas', requestedId);
    await ticketAccessHandlers.assertTicketAccess(ctx, requestedTicket, 'finalizar');
    const group = await ensureVisitGroupForTicket(requestedId, ctx.user.UsuarioID);

    return runOnce(`finalize-group:${group.rootId}`, async () => {
      const currentGroup = await ensureVisitGroupForTicket(group.rootId, ctx.user.UsuarioID);
      if (currentGroup.visits.every((visit) => isFinalized(visit.Estado))) {
        return {
          boleta: currentGroup.root,
          grupoVisitas: groupSummary(currentGroup),
          alreadyFinalized: true,
        };
      }

      const delivery = await deliverTicket(ctx, { ticketId: currentGroup.rootId, testMode: false });
      const timestamp = nowIso();
      const updatedGroup = await persistReportPerVisit(currentGroup, delivery.report, {
        Estado: 'FINALIZADA',
        FinalizadaEn: timestamp,
        EncuestaURL: delivery.report.survey?.url || '',
        EstadoNotificacion: delivery.notificationState,
        UltimoErrorNotificacion: delivery.errors.join(' | '),
      }, ctx.user.UsuarioID);
      await audit(ctx, 'FINALIZAR_GRUPO_BOLETAS', 'Boletas', updatedGroup.rootId, currentGroup.root, {
        GrupoVisitaID: updatedGroup.id,
        CantidadVisitas: updatedGroup.visits.length,
        Boletas: updatedGroup.visits.map((visit) => visit.BoletaID || visit.BoletaUID),
        Reportes: delivery.report.reports || [],
        EstadoNotificacion: delivery.notificationState,
      });
      return {
        boleta: updatedGroup.root,
        grupoVisitas: groupSummary(updatedGroup),
        delivery,
        surveyUrl: delivery.report.survey?.url || '',
      };
    });
  },

  resendChats: async (ctx) => {
    const requestedId = pick(ctx.payload, ['boletaUid', 'BoletaUID', 'id']);
    await ticketAccessHandlers.assertCanModifyFinalized(ctx, requestedId);
    const group = await ensureVisitGroupForTicket(requestedId, ctx.user.UsuarioID);

    return runOnce(`resend-chats-group:${group.rootId}`, async () => {
      const currentGroup = await ensureVisitGroupForTicket(group.rootId, ctx.user.UsuarioID);
      if (!currentGroup.visits.some((visit) => isFinalized(visit.Estado))) {
        throw badRequest('Solo se pueden reenviar a los chats los seguimientos finalizados.');
      }
      const before = currentGroup.root;
      const delivery = await resendTicketChats(ctx, { ticketId: currentGroup.rootId });
      const afterGroup = await ensureVisitGroupForTicket(currentGroup.rootId, ctx.user.UsuarioID);
      await audit(ctx, 'REENVIAR_GRUPO_BOLETAS_CHATS', 'Boletas', afterGroup.rootId, before, {
        GrupoVisitaID: afterGroup.id,
        CantidadVisitas: afterGroup.visits.length,
        Canales: ['CHAT_BOLETAS', 'CHAT_CLIENTE'],
        CorreoEnviado: false,
        EstadoReenvio: delivery.notificationState,
        Errores: delivery.errors,
      });
      const clientSkipped = delivery.notifications.some((item) => item.channel === 'CHAT_CLIENTE' && item.skipped);
      return {
        boleta: afterGroup.root,
        grupoVisitas: groupSummary(afterGroup),
        delivery,
        emailSent: false,
        message: clientSkipped
          ? 'El seguimiento fue reenviado al Chat de boletas. El cliente no tiene un Chat configurado. No se envió correo.'
          : 'El seguimiento fue reenviado únicamente al Chat de boletas y al Chat del cliente. No se envió correo.',
      };
    });
  },

  testFinalize: async (ctx) => {
    if (!ctx.permissions.includes('USUARIOS_GESTIONAR')) {
      throw forbidden('Solo un administrador puede ejecutar las pruebas de correo y Google Chat.');
    }
    const requestedId = pick(ctx.payload, ['boletaUid', 'BoletaUID', 'id']);
    const requestedTicket = await findById('Boletas', requestedId);
    await ticketAccessHandlers.assertTicketAccess(ctx, requestedTicket, 'probar');
    const group = await ensureVisitGroupForTicket(requestedId, ctx.user.UsuarioID);

    return runOnce(`test-group:${group.rootId}`, async () => {
      const delivery = await deliverTicket(ctx, { ticketId: group.rootId, testMode: true });
      await audit(ctx, 'PROBAR_NOTIFICACIONES_GRUPO_BOLETAS', 'Boletas', group.rootId, null, {
        Estado: 'PRUEBA',
        GrupoVisitaID: group.id,
        CantidadVisitas: group.visits.length,
        Resultado: delivery.notificationState,
        Errores: delivery.errors,
        Reportes: delivery.report.reports || [],
      });
      return {
        tested: true,
        stateChanged: false,
        grupoVisitas: groupSummary(group),
        delivery,
      };
    });
  },

  generatePdf: async (ctx) => {
    const requestedId = pick(ctx.payload, ['boletaUid', 'BoletaUID', 'id']);
    await ticketAccessHandlers.assertCanModifyFinalized(ctx, requestedId);
    const group = await ensureVisitGroupForTicket(requestedId, ctx.user.UsuarioID);

    return runOnce(`pdf-group:${group.rootId}`, async () => {
      const surveyUrl = clean(group.root.EncuestaURL || group.root.SurveyURL);
      const report = await generateTicketWithAppsScript({
        ticketId: group.rootId,
        testMode: false,
        sendEmail: false,
        survey: surveyUrl ? { url: surveyUrl, type: 'REAL' } : null,
      });
      const updatedGroup = await persistReportPerVisit(group, report, {}, ctx.user.UsuarioID);
      const requestedVisit = updatedGroup.visits.find((visit) => clean(visit.BoletaUID) === clean(requestedId)) || updatedGroup.root;
      const requestedReport = reportForTicket(report.reports, requestedVisit) || report;
      await audit(ctx, 'GENERAR_REPORTES_GRUPO_BOLETAS', 'Boletas', updatedGroup.rootId, null, {
        GrupoVisitaID: updatedGroup.id,
        CantidadVisitas: updatedGroup.visits.length,
        Reportes: report.reports || [],
      });
      return {
        boletaUid: requestedVisit.BoletaUID,
        grupoVisitas: groupSummary(updatedGroup),
        documentId: requestedReport.documentId,
        documentUrl: requestedReport.documentUrl,
        pdfId: requestedReport.pdfId,
        pdfUrl: requestedReport.pdfUrl,
        folderId: requestedReport.folderId,
        folderUrl: requestedReport.folderUrl,
        reports: report.reports || [],
        evidenceCount: report.evidences.length,
        visitCount: report.visitGroup.count,
      };
    });
  },
};
