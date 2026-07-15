import { appendRow } from '../infra/sheets.repository.js';
import { nowIso, uuid } from '../core/utils.js';
import { getConfig } from '../modules/config.module.js';
import { ensureSurveyForTicket } from '../modules/survey.module.js';
import { sendChatMessage } from './chat.service.js';
import { generateTicketWithAppsScript } from './apps-script-ticket.service.js';

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

function internalChatText(report, testMode) {
  const ticket = report.ticket;
  const assigned = report.assigned.map((item) => item.Nombre).filter(Boolean).join(', ');
  return [
    testMode ? '🧪 PRUEBA DE REPORTE TÉCNICO' : '✅ BOLETA FINALIZADA',
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
    ...(!testMode && report.survey?.url ? [`Encuesta: ${report.survey.url}`] : []),
    `Evidencias: ${report.evidences.length}`,
    ...evidenceLines(report),
    ...(testMode ? ['Esta prueba no cambió el estado ni notificó al cliente.'] : []),
  ].filter(Boolean).join('\n');
}

function clientChatText(report) {
  const ticket = report.ticket;
  return [
    '✅ REPORTE TÉCNICO FINALIZADO',
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

export async function deliverTicket(ctx, { ticketId, testMode = false }) {
  const config = await getConfig();
  const survey = testMode ? null : await ensureSurveyForTicket({
    ticketId,
    origin: ctx.origin,
    actor: ctx.user.UsuarioID,
  });
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
    }, () => sendChatMessage(testChatWebhook(config), internalChatText(report, true))));
  } else {
    results.push(await executeNotification(ctx, {
      entityId: ticket.BoletaUID,
      channel: 'CHAT',
      destination: 'Chat operativo de boletas',
      type: 'FINALIZACION',
    }, () => sendChatMessage(mainChatWebhook(config), internalChatText(report, false))));

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

  const failed = results.filter((item) => !item.ok);
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
    notificationState: failed.length ? (failed.length === results.length ? 'ERROR' : 'PARCIAL') : 'ENVIADO',
    errors: failed.map((item) => `${item.channel}: ${item.error}`),
    testMode,
  };
}
