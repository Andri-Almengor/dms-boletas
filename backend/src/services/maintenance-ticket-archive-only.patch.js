import { findById, updateRow } from '../infra/sheets.repository.js';
import { nowIso, pick } from '../core/utils.js';
import { ticketDeliveryHandlers } from '../modules/ticket-delivery.module.js';
import { ticketAccessHandlers } from '../modules/ticket-access.module.js';
import { generateTicketWithAppsScript } from './apps-script-ticket-group.service.js';
import {
  ensureVisitGroupForTicket,
  groupSummary,
} from './ticket-visit-group.service.js';
import {
  maintenanceHasSignature,
  synchronizeMaintenanceSignatureToTickets,
} from './maintenance-signature-request.service.js';
import { archiveMaintenanceTicketPdf } from './maintenance-staged-delivery.service.js';
import { audit } from './audit.service.js';

const INSTALL_FLAG = Symbol.for('dms.maintenanceTicketArchiveOnly');
const running = new Map();

function clean(value) {
  return String(value ?? '').trim();
}

function finalized(value) {
  return clean(value).toUpperCase().includes('FINAL');
}

function reportForTicket(reports, ticket) {
  const uid = clean(ticket?.BoletaUID);
  const number = clean(ticket?.BoletaID);
  return (Array.isArray(reports) ? reports : []).find((report) => (
    clean(report.ticketUid || report.BoletaUID) === uid
    || (number && clean(report.ticketNumber || report.BoletaID) === number)
  )) || null;
}

function emailDeliveryState(report = {}) {
  const email = report.email || {};
  const sent = email.sent === true;
  const skipped = email.skipped === true;
  const error = !sent && !skipped
    ? clean(email.error || 'Apps Script no confirmó el envío del correo.')
    : '';
  const recipients = [
    ...(Array.isArray(report.recipients?.to) ? report.recipients.to : []),
    ...(Array.isArray(report.recipients?.cc) ? report.recipients.cc : []),
  ];
  return {
    sent,
    skipped,
    error,
    state: sent ? 'ENVIADO' : skipped ? 'OMITIDO' : 'ERROR',
    destination: [...new Set(recipients.map(clean).filter(Boolean))].join(', '),
  };
}

async function runOnce(key, operation) {
  if (running.has(key)) return running.get(key);
  const promise = Promise.resolve().then(operation).finally(() => running.delete(key));
  running.set(key, promise);
  return promise;
}

async function synchronizeSignatureIfPresent(ticket, actor) {
  const maintenanceId = clean(ticket.OrigenMantenimientoID);
  if (!maintenanceId) return ticket;
  const maintenance = await findById('Mantenimiento', maintenanceId);
  if (!maintenanceHasSignature(maintenance)) return ticket;
  await synchronizeMaintenanceSignatureToTickets(maintenanceId, maintenance, actor);
  return findById('Boletas', ticket.BoletaUID);
}

async function archiveExistingTicket(ticket) {
  const maintenanceId = clean(ticket.OrigenMantenimientoID);
  const pdfUrl = clean(ticket.PDFURL || ticket.PDF_Url || ticket.PDFUrl);
  if (!maintenanceId || !pdfUrl) return null;
  return archiveMaintenanceTicketPdf({
    maintenanceId,
    ticketId: ticket.BoletaUID,
    ticketNumber: ticket.BoletaID || ticket.BoletaUID,
    title: ticket.Titulo || 'Boleta de mantenimiento',
    pdfUrl,
  });
}

if (!ticketDeliveryHandlers[INSTALL_FLAG]) {
  const originalFinalize = ticketDeliveryHandlers.finalize;

  ticketDeliveryHandlers.finalize = async (ctx) => {
    const requestedId = pick(ctx.payload, ['boletaUid', 'BoletaUID', 'id']);
    let requestedTicket = await findById('Boletas', requestedId);
    const maintenanceId = clean(requestedTicket.OrigenMantenimientoID);
    const isMaintenanceTicket = Boolean(maintenanceId)
      || requestedTicket.EsBoletaMantenimiento === true
      || clean(requestedTicket.EsBoletaMantenimiento).toLowerCase() === 'true';

    if (!isMaintenanceTicket) return originalFinalize(ctx);

    await ticketAccessHandlers.assertTicketAccess(ctx, requestedTicket, 'finalizar');
    requestedTicket = await synchronizeSignatureIfPresent(
      requestedTicket,
      ctx.user?.UsuarioID || 'SISTEMA',
    );
    const group = await ensureVisitGroupForTicket(
      requestedTicket.BoletaUID,
      ctx.user?.UsuarioID || 'SISTEMA',
    );

    return runOnce(`maintenance-archive-ticket:${group.rootId}`, async () => {
      const currentGroup = await ensureVisitGroupForTicket(
        group.rootId,
        ctx.user?.UsuarioID || 'SISTEMA',
      );
      const requestedCurrent = currentGroup.visits.find(
        (visit) => clean(visit.BoletaUID) === clean(requestedTicket.BoletaUID),
      ) || currentGroup.root;

      const reportsReady = currentGroup.visits.every((visit) => finalized(visit.Estado))
        && currentGroup.visits.every((visit) => clean(visit.PDFURL || visit.PDF_Url || visit.PDFUrl));
      const emailAlreadySent = currentGroup.visits.every(
        (visit) => clean(visit.EstadoNotificacion).toUpperCase() === 'ENVIADO',
      );

      if (reportsReady && emailAlreadySent) {
        const archived = await archiveExistingTicket(requestedCurrent);
        const pdfUrl = clean(requestedCurrent.PDFURL || requestedCurrent.PDF_Url || requestedCurrent.PDFUrl);
        return {
          boleta: requestedCurrent,
          grupoVisitas: groupSummary(currentGroup),
          alreadyFinalized: true,
          maintenanceArchiveOnly: true,
          pdfUrl,
          archive: archived,
          delivery: {
            report: { pdfUrl },
            notifications: [],
            notificationState: 'ENVIADO',
            errors: [],
            maintenanceArchiveOnly: true,
          },
        };
      }

      // Para boletas automáticas de mantenimiento Apps Script genera el PDF y
      // envía el correo, pero sigue omitiendo encuesta, solicitud de firma y
      // Chat individual. Si una boleta histórica quedó con correo OMITIDO,
      // volver a finalizarla entra aquí y recupera el envío pendiente.
      const report = await generateTicketWithAppsScript({
        ticketId: currentGroup.rootId,
        testMode: false,
        sendEmail: true,
        survey: null,
        signatureRequest: null,
        deliveryType: 'MAINTENANCE_ARCHIVE',
      });
      const emailDelivery = emailDeliveryState(report);

      const timestamp = nowIso();
      const actor = ctx.user?.UsuarioID || 'SISTEMA';
      const archives = [];
      for (const visit of currentGroup.visits) {
        const ownReport = reportForTicket(report.reports, visit) || report;
        await updateRow('Boletas', visit.BoletaUID, {
          Estado: 'FINALIZADA',
          FinalizadaEn: timestamp,
          EstadoNotificacion: emailDelivery.state,
          UltimoErrorNotificacion: emailDelivery.error,
          DocumentoURL: ownReport.documentUrl || report.documentUrl || '',
          PDFURL: ownReport.pdfUrl || report.pdfUrl || '',
          CarpetaURL: ownReport.folderUrl || report.folderUrl || '',
          ActualizadoPor: actor,
          FechaActualizacion: timestamp,
        });

        archives.push(await archiveMaintenanceTicketPdf({
          maintenanceId: clean(visit.OrigenMantenimientoID || maintenanceId),
          ticketId: visit.BoletaUID,
          ticketNumber: visit.BoletaID || visit.BoletaUID,
          title: visit.Titulo || requestedTicket.Titulo || 'Boleta de mantenimiento',
          pdfId: ownReport.pdfId || report.pdfId || '',
          pdfUrl: ownReport.pdfUrl || report.pdfUrl || '',
        }));
      }

      const updatedGroup = await ensureVisitGroupForTicket(currentGroup.rootId, actor);
      const updatedRequested = updatedGroup.visits.find(
        (visit) => clean(visit.BoletaUID) === clean(requestedTicket.BoletaUID),
      ) || updatedGroup.root;
      const requestedReport = reportForTicket(report.reports, updatedRequested) || report;
      const requestedArchive = archives.find(
        (item) => clean(item.ticketId) === clean(updatedRequested.BoletaUID),
      ) || archives[0] || null;

      await audit(ctx, 'FINALIZAR_BOLETA_MANTENIMIENTO_ARCHIVO', 'Boletas', updatedGroup.rootId, null, {
        MantenimientoID: maintenanceId,
        CantidadBoletas: updatedGroup.visits.length,
        CorreoEnviado: emailDelivery.sent,
        CorreoDestino: emailDelivery.destination,
        EstadoCorreo: emailDelivery.state,
        ErrorCorreo: emailDelivery.error,
        ChatEnviado: false,
        EncuestaCreada: false,
        FirmaSolicitada: false,
        CarpetaBoletas: requestedArchive?.boletasFolderUrl || '',
      }).catch(() => {});

      const emailNotification = {
        entityId: updatedGroup.rootId,
        channel: 'CORREO_APPS_SCRIPT',
        destination: emailDelivery.destination || 'Sin destinatarios válidos',
        type: 'FINALIZACION_MANTENIMIENTO',
        ok: emailDelivery.sent,
        skipped: emailDelivery.skipped,
        result: report.email || {},
        error: emailDelivery.error,
      };
      const summary = {
        report: {
          documentId: requestedReport.documentId || report.documentId || '',
          documentUrl: requestedReport.documentUrl || report.documentUrl || '',
          pdfId: requestedReport.pdfId || report.pdfId || '',
          pdfUrl: requestedReport.pdfUrl || report.pdfUrl || '',
          folderId: requestedReport.folderId || report.folderId || '',
          folderUrl: requestedReport.folderUrl || report.folderUrl || '',
          reports: Array.isArray(report.reports) ? report.reports : [],
          evidenceCount: report.evidences?.length || 0,
          visitCount: updatedGroup.visits.length,
        },
        notifications: [emailNotification],
        notificationState: emailDelivery.state,
        errors: emailDelivery.error ? [`CORREO_APPS_SCRIPT: ${emailDelivery.error}`] : [],
        maintenanceArchiveOnly: true,
      };

      return {
        boleta: updatedRequested,
        grupoVisitas: groupSummary(updatedGroup),
        delivery: summary,
        surveyUrl: '',
        maintenanceArchiveOnly: true,
        pdfId: summary.report.pdfId,
        pdfUrl: summary.report.pdfUrl,
        archive: requestedArchive,
      };
    });
  };

  ticketDeliveryHandlers[INSTALL_FLAG] = true;
}
