import { appendRow, findById, updateRow } from '../infra/sheets.repository.js';
import { nowIso, uuid } from '../core/utils.js';
import { getConfig } from '../modules/config.module.js';
import { ensureSurveyForTicket } from '../modules/survey.module.js';
import { sendChatMessage } from './chat.service.js';
import { generateTicketWithAppsScript } from './apps-script-ticket.service.js';
import { ensureTestSurveyForTicket } from './test-survey.service.js';

function chatWebhook(...values) {
  return values.map((value) => String(value || '').trim()).find((value) => value.startsWith('https://chat.googleapis.com/')) || '';
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

function evidenceLines(report, limit = 12) {
  const lines = report.evidences.slice(0, limit).map((item, index) => {
    const name = item.Nombre || item.NombreArchivo || `Evidencia ${index + 1}`;
    return `• ${name}${item.ArchivoURL ? `: ${item.ArchivoURL}` : ''}`;
  });
  if (report.evidences.length > limit) lines.push(`• ${report.evidences.length - limit} evidencia(s) adicional(es) en la carpeta de Drive.`);
  return lines;
}

function internalChatText(report, { testMode = false, resendMode = false } = {}) {
  const ticket = report.ticket;
  const assigned = report.assigned.map((item) => item.Nombre).filter(Boolean).join(', ');
  const heading = testMode
    ? '🧪 PRUEBA DE REPORTE TÉCNICO'
    : resendMode
      ? '🔁 BOLETA ACTUALIZADA Y REENVIADA'
      : '✅ BOLETA FINALIZADA';
  return [
    heading,
    `Cliente: ${ticket.Cliente || 'Sin cliente'}`,
    `Boleta: #${ticket.BoletaID || ticket.BoletaUID}`,
    `Título: ${ticket.Titulo || 'Reporte de visita'}`,
    `Fecha: ${ticket.Fecha || ''}`,
    `Ubicación: ${[ticket.Ubicacion, ticket.UbicacionEquipo].filter(Boolean).join(' · ')}`,
    `Supervisor: ${ticket.Supervisor || 'Sin especificar'}`,
    `Técnicos: ${assigned || 'Sin especificar'}`,
    `Resultado: ${ticket.Resultado || 'Sin especificar'}`,
    `PDF: ${report.pdfUrl}`,
    `Carpeta: ${report.folderUrl}`,
    ...(report.survey?.url ? [`Encuesta${testMode ? ' de prueba' : ''}: ${report.survey.url}`] : []),
    `Evidencias: ${report.evidences.length}`,
    ...evidenceLines(report),
    ...(testMode ? ['Esta prueba no cambió el estado ni notificó al cliente. La encuesta incluida es únicamente para validación administrativa.'] : []),
    ...(resendMode ? ['Este reenvío fue enviado únicamente a Google Chat. No se envió correo electrónico.'] : []),
  ].filter(Boolean).join('\n');
}

function clientChatText(report, { resendMode = false } = {}) {
  const ticket = report.ticket;
  return [
    resendMode ? '🔁 REPORTE TÉCNICO ACTUALIZADO' : '✅ REPORTE TÉCNICO FINALIZADO',
    `Cliente: ${ticket.Cliente || ''}`,
    `Boleta: #${ticket.BoletaID || ticket.BoletaUID}`,
    `Asunto: ${ticket.Titulo || 'Reporte de visita'}`,
    `Fecha: ${ticket.Fecha || ''}`,
    `Ubicación: ${[ticket.Ubicacion, ticket.UbicacionEquipo].filter(Boolean).join(' · ')}`,
    `Razón de visita: ${ticket.RazonVisita || 'Sin especificar'}`,
    `Resultado: ${ticket.Resultado || 'Sin especificar'}`,
    `Recomendaciones: ${ticket.Recomendaciones || 'Sin recomendaciones adicionales'}`,
    `PDF: ${report.pdfUrl}`,
    ...(report.survey?.url ? [`Califique nuestro servicio: ${report.survey.url}`] : []),
  ].join('\n');
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
    CreadoPor: ctx.user.UsuarioID,
  });
}

async function executeNotification(ctx, metadata, operation) {
  try {
    const result = await operation();
    await recordNotification(ctx, { ...metadata, result }).catch(() => {});
    return { ...metadata, ok: true, result };
  } catch (error) {
    console.error(`[ticket-delivery] ${metadata.channel} falló para ${metadata.destination}:`, error);
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
      templateId: report.templateId,
      survey: report.survey || null,
    },
    notifications: results,
    notificationState: failed.length ? (failed.length === results.filter((item) => !item.skipped).length ? 'ERROR' : 'PARCIAL') : 'ENVIADO',
    errors: failed.map((item) => `${item.channel}: ${item.error}`),
    ...extra,
  };
}

export async function deliverTicket(ctx, { ticketId, testMode = false }) {
  const config = await getConfig();
  const survey = testMode
    ? await ensureTestSurveyForTicket({ ticketId, origin: ctx.origin, actor: ctx.user.UsuarioID })
    : await ensureSurveyForTicket({ ticketId, origin: ctx.origin, actor: ctx.user.UsuarioID });
  const report = await generateTicketWithAppsScript({ ticketId, testMode, sendEmail: true, survey });
  const ticket = report.ticket;
  const results = [];

  const emailError = report.email?.sent === false && !report.email?.skipped
    ? new Error(report.email.error || 'Apps Script no pudo enviar el correo.')
    : null;
  const emailMetadata = {
    entityId: ticket.BoletaUID,
    channel: 'CORREO_APPS_SCRIPT',
    destination: emailDestination(report),
    type: testMode ? 'PRUEBA' : 'FINALIZACION',
  };
  await recordNotification(ctx, emailError
    ? { ...emailMetadata, error: emailError }
    : { ...emailMetadata, result: { ...(report.email || { sent: true }), surveyUrl: report.survey?.url || '' } }).catch(() => {});
  results.push(emailError
    ? { ...emailMetadata, ok: false, error: emailError.message }
    : { ...emailMetadata, ok: true, result: report.email || { sent: true } });

  if (testMode) {
    results.push(await executeNotification(ctx, {
      entityId: ticket.BoletaUID,
      channel: 'CHAT',
      destination: 'Chat de pruebas',
      type: 'PRUEBA',
    }, () => sendChatMessage(testChatWebhook(config), internalChatText(report, { testMode: true }))));
  } else {
    results.push(await executeNotification(ctx, {
      entityId: ticket.BoletaUID,
      channel: 'CHAT',
      destination: 'Chat operativo de boletas',
      type: 'FINALIZACION',
    }, () => sendChatMessage(mainChatWebhook(config), internalChatText(report))));

    const clientWebhook = clientChatWebhook(report.client);
    if (clientWebhook) {
      results.push(await executeNotification(ctx, {
        entityId: ticket.BoletaUID,
        channel: 'CHAT_CLIENTE',
        destination: `Chat del cliente: ${ticket.Cliente || ticket.ClienteID}`,
        type: 'FINALIZACION',
      }, () => sendChatMessage(clientWebhook, clientChatText(report))));
    }
  }

  return deliverySummary(report, results, { testMode });
}

export async function resendTicketChats(ctx, { ticketId }) {
  const [config, ticket] = await Promise.all([
    getConfig(),
    findById('Boletas', ticketId),
  ]);
  const existingSurveyUrl = String(ticket.EncuestaURL || ticket.SurveyURL || '').trim();
  const survey = existingSurveyUrl ? { url: existingSurveyUrl, type: 'REAL' } : null;

  const report = await generateTicketWithAppsScript({
    ticketId,
    testMode: false,
    sendEmail: false,
    survey,
  });
  const results = [];

  results.push(await executeNotification(ctx, {
    entityId: report.ticket.BoletaUID,
    channel: 'CHAT',
    destination: 'Chat operativo de boletas',
    type: 'REENVIO_CHAT',
  }, () => sendChatMessage(mainChatWebhook(config), internalChatText(report, { resendMode: true }))));

  const clientWebhook = clientChatWebhook(report.client);
  if (clientWebhook) {
    results.push(await executeNotification(ctx, {
      entityId: report.ticket.BoletaUID,
      channel: 'CHAT_CLIENTE',
      destination: `Chat del cliente: ${report.ticket.Cliente || report.ticket.ClienteID}`,
      type: 'REENVIO_CHAT',
    }, () => sendChatMessage(clientWebhook, clientChatText(report, { resendMode: true }))));
  } else {
    results.push({
      entityId: report.ticket.BoletaUID,
      channel: 'CHAT_CLIENTE',
      destination: `Chat del cliente: ${report.ticket.Cliente || report.ticket.ClienteID}`,
      type: 'REENVIO_CHAT',
      ok: true,
      skipped: true,
      reason: 'El cliente no tiene un webhook de Google Chat configurado.',
    });
  }

  const summary = deliverySummary(report, results, {
    testMode: false,
    resendMode: true,
    emailSent: false,
  });

  await updateRow('Boletas', ticketId, {
    DocumentoURL: report.documentUrl,
    PDFURL: report.pdfUrl,
    CarpetaURL: report.folderUrl,
    UltimoReenvioChatEn: nowIso(),
    EstadoReenvioChat: summary.notificationState,
    UltimoErrorReenvioChat: summary.errors.join(' | '),
    ActualizadoPor: ctx.user.UsuarioID,
    FechaActualizacion: nowIso(),
  });

  return summary;
}
