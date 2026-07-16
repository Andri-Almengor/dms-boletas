import { appendRow, findById } from '../infra/sheets.repository.js';
import { nowIso, uuid } from '../core/utils.js';
import { getConfig } from '../modules/config.module.js';
import { sendChatMessage } from './chat.service.js';
import { generateTicketWithAppsScript } from './apps-script-ticket-group.service.js';
import {
  ensureSignatureRequestForTicket,
  visitGroupHasSignature,
} from './ticket-group-signature-request.service.js';
import {
  ensureSurveyForVisitGroup,
  ensureTestSurveyForVisitGroup,
} from './ticket-group-survey.service.js';
import {
  ensureVisitGroupForTicket,
  ticketVisitNumber,
  updateVisitGroup,
} from './ticket-visit-group.service.js';

function clean(value) {
  return String(value || '').trim();
}

function splitEmails(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[;,]/);
  return [...new Set(source
    .flatMap((item) => Array.isArray(item) ? item : [item])
    .map((item) => clean(item).toLowerCase())
    .filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item)))];
}

function chatWebhook(...values) {
  return values.map((value) => clean(value)).find((value) => value.startsWith('https://chat.googleapis.com/')) || '';
}

function mainChatWebhook(config) {
  return chatWebhook(process.env.GOOGLE_CHAT_BOLETAS_WEBHOOK, process.env.GOOGLE_CHAT_WEBHOOK, config.CHAT_BOLETAS_WEBHOOK, config.CHAT_WEBHOOK_BOLETAS);
}

function testChatWebhook(config) {
  return chatWebhook(process.env.GOOGLE_CHAT_TEST_WEBHOOK, config.CHAT_TEST_WEBHOOK, config.CHAT_WEBHOOK_PRUEBAS, config.CHAT_TEST_MODE);
}

function clientChatWebhook(client) {
  return chatWebhook(client?.ChatWebhook, client?.ChatWebhookURL);
}

function visitLines(report) {
  return report.visitGroup.visits.flatMap((visit, index) => {
    const ticket = visit.ticket;
    const assigned = visit.assigned.map((item) => item.Nombre).filter(Boolean).join(', ');
    return [
      `Visita ${ticketVisitNumber(ticket)} · Boleta #${ticket.BoletaID || ticket.BoletaUID}`,
      `  Fecha: ${ticket.Fecha || ''} · ${ticket.HoraInicio || ''} - ${ticket.HoraFinal || ''} · ${ticket.HorasTotales || 0} h`,
      `  Ubicación: ${[ticket.Ubicacion, ticket.UbicacionEquipo].filter(Boolean).join(' · ') || 'Sin especificar'}`,
      `  Técnicos: ${assigned || 'Sin especificar'}`,
      `  Resultado: ${ticket.Resultado || 'Sin especificar'}`,
      `  Evidencias: ${visit.evidences.length}`,
      ...(index < report.visitGroup.visits.length - 1 ? [''] : []),
    ];
  });
}

function internalChatText(report, { testMode = false, resendMode = false } = {}) {
  const ticket = report.ticket;
  const heading = testMode
    ? '🧪 PRUEBA DE SEGUIMIENTO TÉCNICO'
    : resendMode
      ? '🔁 SEGUIMIENTO ACTUALIZADO Y REENVIADO'
      : report.visitGroup.count > 1
        ? '✅ SEGUIMIENTO DE VISITAS FINALIZADO'
        : '✅ BOLETA FINALIZADA';
  return [
    heading,
    `Cliente: ${ticket.Cliente || 'Sin cliente'}`,
    `Boletas: ${report.visitGroup.numbers.map((number) => `#${number}`).join(', ')}`,
    `Visitas: ${report.visitGroup.count}`,
    `Asunto: ${ticket.Titulo || 'Reporte de visita'}`,
    '',
    ...visitLines(report),
    `PDF conjunto: ${report.pdfUrl}`,
    `Carpeta: ${report.folderUrl}`,
    ...(report.survey?.url ? [`Encuesta única${testMode ? ' de prueba' : ''}: ${report.survey.url}`] : []),
    ...(report.signatureRequest?.url ? [`Firma única pendiente para todas las visitas: ${report.signatureRequest.url}`] : []),
    `Evidencias totales: ${report.evidences.length}`,
    ...(testMode ? ['Esta prueba no cambió el estado de las boletas ni notificó al cliente.'] : []),
    ...(resendMode ? ['Este reenvío fue enviado únicamente a Google Chat. No se envió correo electrónico.'] : []),
  ].filter(Boolean).join('\n');
}

function clientChatText(report, { resendMode = false } = {}) {
  const ticket = report.ticket;
  return [
    resendMode ? '🔁 REPORTE DE SEGUIMIENTO ACTUALIZADO' : '✅ REPORTE DE SEGUIMIENTO FINALIZADO',
    `Cliente: ${ticket.Cliente || ''}`,
    `Boletas: ${report.visitGroup.numbers.map((number) => `#${number}`).join(', ')}`,
    `Visitas realizadas: ${report.visitGroup.count}`,
    `Asunto: ${ticket.Titulo || 'Reporte de visita'}`,
    '',
    ...report.visitGroup.visits.map((visit) => {
      const item = visit.ticket;
      return `Visita ${ticketVisitNumber(item)}: ${item.Fecha || ''} · ${item.Resultado || 'Sin resultado especificado'}`;
    }),
    `PDF conjunto: ${report.pdfUrl}`,
    ...(report.survey?.url ? [`Califique todo el seguimiento en una sola encuesta: ${report.survey.url}`] : []),
    ...(report.signatureRequest?.url ? [`Firma única para todas las visitas: ${report.signatureRequest.url}`] : []),
  ].filter(Boolean).join('\n');
}

function signedInternalChatText(report) {
  return [
    '✍️ SEGUIMIENTO FIRMADO POR EL CLIENTE',
    `Cliente: ${report.ticket.Cliente || 'Sin cliente'}`,
    `Boletas: ${report.visitGroup.numbers.map((number) => `#${number}`).join(', ')}`,
    `Visitas cubiertas por la firma: ${report.visitGroup.count}`,
    'Firma: registrada una sola vez y aplicada a todas las visitas relacionadas',
    `PDF firmado: ${report.pdfUrl}`,
    `Carpeta: ${report.folderUrl}`,
  ].filter(Boolean).join('\n');
}

async function recordNotification(ctx, { entityId, channel, destination, type, result, error }) {
  const sent = !error;
  await appendRow('Notificaciones', {
    NotificacionID: uuid(),
    Entidad: 'BOLETA',
    EntidadID: entityId,
    Canal: channel,
    Destino: destination,
    Tipo: type,
    Estado: sent ? 'ENVIADO' : 'ERROR',
    Intentos: 1,
    Respuesta: result ? JSON.stringify(result).slice(0, 1500) : '',
    Error: error ? String(error.message || error).slice(0, 1500) : '',
    FechaCreacion: nowIso(),
    FechaEnvio: sent ? nowIso() : '',
    CreadoPor: ctx.user?.UsuarioID || 'SISTEMA',
  });
}

async function executeNotification(ctx, metadata, operation) {
  try {
    const result = await operation();
    await recordNotification(ctx, { ...metadata, result }).catch(() => {});
    return { ...metadata, ok: true, result };
  } catch (error) {
    console.error(`[ticket-group-delivery] ${metadata.channel} falló para ${metadata.destination}:`, error);
    await recordNotification(ctx, { ...metadata, error }).catch(() => {});
    return { ...metadata, ok: false, error: String(error.message || error) };
  }
}

function emailDestination(report) {
  return [...new Set([...(report.recipients?.to || []), ...(report.recipients?.cc || [])])].join(', ') || 'Sin destinatarios válidos';
}

function deliverySummary(report, results, extra = {}) {
  const failed = results.filter((item) => !item.ok && !item.skipped);
  return {
    report: {
      documentId: report.documentId,
      documentUrl: report.documentUrl,
      pdfId: report.pdfId,
      pdfUrl: report.pdfUrl,
      folderId: report.folderId,
      folderUrl: report.folderUrl,
      evidenceCount: report.evidences.length,
      visitCount: report.visitGroup.count,
      ticketNumbers: report.visitGroup.numbers,
      templateId: report.templateId,
      survey: report.survey || null,
      signatureRequest: report.signatureRequest || null,
    },
    notifications: results,
    notificationState: failed.length ? (failed.length === results.filter((item) => !item.skipped).length ? 'ERROR' : 'PARCIAL') : 'ENVIADO',
    errors: failed.map((item) => `${item.channel}: ${item.error}`),
    ...extra,
  };
}

async function appendEmailResult(ctx, report, results, type) {
  const error = report.email?.sent === false && !report.email?.skipped
    ? new Error(report.email.error || 'Apps Script no pudo enviar el correo.')
    : null;
  const metadata = {
    entityId: report.visitGroup.rootId,
    channel: 'CORREO_APPS_SCRIPT',
    destination: emailDestination(report),
    type,
  };
  await recordNotification(ctx, error
    ? { ...metadata, error }
    : { ...metadata, result: { ...(report.email || { sent: true }), surveyUrl: report.survey?.url || '', signatureUrl: report.signatureRequest?.url || '' } }).catch(() => {});
  results.push(error
    ? { ...metadata, ok: false, error: error.message }
    : { ...metadata, ok: true, result: report.email || { sent: true } });
}

export async function deliverTicket(ctx, { ticketId, testMode = false }) {
  const [config, group] = await Promise.all([
    getConfig(),
    ensureVisitGroupForTicket(ticketId, ctx.user?.UsuarioID || 'SISTEMA'),
  ]);
  const survey = testMode
    ? await ensureTestSurveyForVisitGroup({ ticketId: group.rootId, origin: ctx.origin, actor: ctx.user.UsuarioID })
    : await ensureSurveyForVisitGroup({ ticketId: group.rootId, origin: ctx.origin, actor: ctx.user.UsuarioID });
  const signatureRequest = !testMode && !(await visitGroupHasSignature(group.rootId))
    ? await ensureSignatureRequestForTicket({ ticketId: group.rootId, origin: ctx.origin, actor: ctx.user.UsuarioID })
    : null;
  const report = await generateTicketWithAppsScript({
    ticketId: group.rootId,
    testMode,
    sendEmail: true,
    survey,
    signatureRequest,
  });
  const results = [];
  await appendEmailResult(ctx, report, results, testMode ? 'PRUEBA_GRUPO' : 'FINALIZACION_GRUPO');

  if (testMode) {
    results.push(await executeNotification(ctx, {
      entityId: group.rootId,
      channel: 'CHAT',
      destination: 'Chat de pruebas',
      type: 'PRUEBA_GRUPO',
    }, () => sendChatMessage(testChatWebhook(config), internalChatText(report, { testMode: true }))));
  } else {
    results.push(await executeNotification(ctx, {
      entityId: group.rootId,
      channel: 'CHAT',
      destination: 'Chat operativo de boletas',
      type: 'FINALIZACION_GRUPO',
    }, () => sendChatMessage(mainChatWebhook(config), internalChatText(report))));

    const clientWebhook = clientChatWebhook(report.client);
    if (clientWebhook) {
      results.push(await executeNotification(ctx, {
        entityId: group.rootId,
        channel: 'CHAT_CLIENTE',
        destination: `Chat del cliente: ${report.ticket.Cliente || report.ticket.ClienteID}`,
        type: 'FINALIZACION_GRUPO',
      }, () => sendChatMessage(clientWebhook, clientChatText(report))));
    }
  }

  return deliverySummary(report, results, { testMode, signatureRequest });
}

export async function deliverSignedTicket(ctx, { ticketId, signatureRequest = null }) {
  const [config, group] = await Promise.all([
    getConfig(),
    ensureVisitGroupForTicket(ticketId, 'CLIENTE'),
  ]);
  const clientEmails = splitEmails(group.visits.map((ticket) => ticket.CorreoCliente));
  if (!clientEmails.length) {
    throw new Error('La firma fue guardada, pero las boletas no tienen un correo de cliente válido para reenviar el reporte firmado.');
  }
  const surveyUrl = clean(group.root.EncuestaURL || group.root.SurveyURL);
  const survey = surveyUrl ? { url: surveyUrl, type: 'REAL' } : null;
  const report = await generateTicketWithAppsScript({
    ticketId: group.rootId,
    testMode: false,
    sendEmail: true,
    survey,
    signatureRequest: null,
    recipientsOverride: { to: clientEmails, cc: [] },
    deliveryType: 'SIGNED',
  });
  const results = [];
  await appendEmailResult(ctx, report, results, 'FIRMA_CLIENTE_GRUPO');
  results.push(await executeNotification(ctx, {
    entityId: group.rootId,
    channel: 'CHAT',
    destination: 'Chat operativo de boletas',
    type: 'FIRMA_CLIENTE_GRUPO',
  }, () => sendChatMessage(mainChatWebhook(config), signedInternalChatText(report))));

  const summary = deliverySummary(report, results, { signedDelivery: true, signatureRequest });
  await updateVisitGroup(group.rootId, {
    DocumentoURL: report.documentUrl,
    PDFURL: report.pdfUrl,
    CarpetaURL: report.folderUrl,
    EstadoEntregaFirma: summary.notificationState,
    UltimoErrorEntregaFirma: summary.errors.join(' | '),
    FirmaReenviadaEn: nowIso(),
  }, 'CLIENTE');
  return summary;
}

export async function resendTicketChats(ctx, { ticketId }) {
  const [config, group] = await Promise.all([
    getConfig(),
    ensureVisitGroupForTicket(ticketId, ctx.user.UsuarioID),
  ]);
  const existingSurveyUrl = clean(group.root.EncuestaURL || group.root.SurveyURL);
  const survey = existingSurveyUrl ? { url: existingSurveyUrl, type: 'REAL' } : null;
  const report = await generateTicketWithAppsScript({
    ticketId: group.rootId,
    testMode: false,
    sendEmail: false,
    survey,
  });
  const results = [];
  results.push(await executeNotification(ctx, {
    entityId: group.rootId,
    channel: 'CHAT',
    destination: 'Chat operativo de boletas',
    type: 'REENVIO_CHAT_GRUPO',
  }, () => sendChatMessage(mainChatWebhook(config), internalChatText(report, { resendMode: true }))));

  const clientWebhook = clientChatWebhook(report.client);
  if (clientWebhook) {
    results.push(await executeNotification(ctx, {
      entityId: group.rootId,
      channel: 'CHAT_CLIENTE',
      destination: `Chat del cliente: ${report.ticket.Cliente || report.ticket.ClienteID}`,
      type: 'REENVIO_CHAT_GRUPO',
    }, () => sendChatMessage(clientWebhook, clientChatText(report, { resendMode: true }))));
  } else {
    results.push({
      entityId: group.rootId,
      channel: 'CHAT_CLIENTE',
      destination: `Chat del cliente: ${report.ticket.Cliente || report.ticket.ClienteID}`,
      type: 'REENVIO_CHAT_GRUPO',
      ok: true,
      skipped: true,
      reason: 'El cliente no tiene un webhook de Google Chat configurado.',
    });
  }

  const summary = deliverySummary(report, results, { testMode: false, resendMode: true, emailSent: false });
  await updateVisitGroup(group.rootId, {
    DocumentoURL: report.documentUrl,
    PDFURL: report.pdfUrl,
    CarpetaURL: report.folderUrl,
    UltimoReenvioChatEn: nowIso(),
    EstadoReenvioChat: summary.notificationState,
    UltimoErrorReenvioChat: summary.errors.join(' | '),
  }, ctx.user.UsuarioID);
  return summary;
}
