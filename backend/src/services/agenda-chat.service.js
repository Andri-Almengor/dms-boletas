import { badRequest } from '../core/errors.js';
import {
  appendRows,
  readTable,
  updateRows,
} from '../infra/sheets.repository.js';
import {
  isValidWebhook,
  normalizeWebhook,
  redactWebhook,
  sendChatMessage,
} from './chat.service.js';

const CONFIG_KEY = 'AGENDA_CHAT_WEBHOOK';
const MAX_MESSAGE_LENGTH = 3600;

function clean(value, maxLength = 12000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function rowsMap(rows = []) {
  return new Map(rows
    .filter((row) => clean(row.Clave))
    .map((row) => [clean(row.Clave), clean(row.Valor, 20000)]));
}

function personName(user = {}) {
  return clean(user.NombreCompleto || user.Nombre || user.NombreUsuario || user.Correo, 180) || 'Usuario';
}

function agendaLink(appUrl, agenda = {}) {
  const base = clean(appUrl, 1000).replace(/\/+$/, '');
  if (!base || !agenda.AgendaID) return '';
  const month = clean(agenda.Fecha, 10).slice(0, 7);
  return `${base}/agenda?agendaId=${encodeURIComponent(agenda.AgendaID)}&month=${encodeURIComponent(month)}`;
}

function agendaBlock(agenda = {}, appUrl = '') {
  const people = Array.isArray(agenda.asignados)
    ? agenda.asignados.map(personName).filter(Boolean).join(', ')
    : '';
  const link = agendaLink(appUrl, agenda);
  return [
    `📅 ${clean(agenda.Fecha, 20) || 'Sin fecha'} · ${clean(agenda.HoraInicio, 10) || '—'}–${clean(agenda.HoraFin, 10) || '—'}`,
    `Detalle: ${clean(agenda.Detalle, 900) || 'Sin detalle'}`,
    `Asignados: ${people || 'Sin asignación'}`,
    link ? `Abrir agenda: ${link}` : '',
  ].filter(Boolean).join('\n');
}

function providerDiagnostics(error = {}) {
  return {
    status: Number(error?.details?.status || error?.status || 0),
    providerResponse: clean(error?.details?.response, 500),
  };
}

function deliveryError(error, fallback) {
  const diagnostics = providerDiagnostics(error);
  return {
    configured: true,
    sent: false,
    error: error?.message || fallback,
    code: error?.code || '',
    status: diagnostics.status,
    providerResponse: diagnostics.providerResponse,
  };
}

export function buildAgendaChatMessage({ views = [], mode = 'CREATED', appUrl = '' } = {}) {
  const agendas = Array.isArray(views) ? views : [];
  const updated = clean(mode, 30).toUpperCase() === 'UPDATED';
  const heading = updated ? '🔁 AGENDA DMS · ACTUALIZADA' : '✅ AGENDA DMS · NUEVA';
  if (!agendas.length) return heading;

  const lines = [heading, ''];
  let included = 0;

  for (const agenda of agendas) {
    const block = agendaBlock(agenda, appUrl);
    const candidate = [...lines, block, ''].join('\n');
    if (candidate.length > MAX_MESSAGE_LENGTH && included > 0) break;
    lines.push(block, '');
    included += 1;
  }

  const remaining = agendas.length - included;
  if (remaining > 0) {
    lines.push(`… y ${remaining} agenda${remaining === 1 ? '' : 's'} más en el mismo envío.`);
  }

  return lines.join('\n').trim().slice(0, MAX_MESSAGE_LENGTH);
}

async function getWebhook() {
  const rows = await readTable('Configuracion');
  return normalizeWebhook(rowsMap(rows).get(CONFIG_KEY));
}

export async function getAgendaChatSettings() {
  const webhook = await getWebhook();
  return {
    configured: isValidWebhook(webhook),
    redactedWebhook: redactWebhook(webhook),
  };
}

export async function updateAgendaChatSettings(payload = {}) {
  const webhook = normalizeWebhook(payload.webhook ?? payload.url ?? payload.chatWebhook);
  if (webhook && !isValidWebhook(webhook)) {
    throw badRequest('El webhook de Agenda debe ser una URL válida de Google Chat. Use el webhook del espacio, no el enlace normal para abrir el chat.');
  }

  const rows = await readTable('Configuracion', { force: true });
  const existing = rowsMap(rows);
  const record = { Clave: CONFIG_KEY, Valor: webhook };
  if (existing.has(CONFIG_KEY)) {
    await updateRows('Configuracion', [{ idValue: CONFIG_KEY, patch: record }], 'Clave');
  } else {
    await appendRows('Configuracion', [record]);
  }

  return {
    configured: Boolean(webhook),
    redactedWebhook: redactWebhook(webhook),
  };
}

export async function testAgendaChatNotification(payload = {}) {
  let webhook = normalizeWebhook(payload.webhook ?? payload.url ?? payload.chatWebhook);
  if (!webhook) webhook = await getWebhook();
  if (!webhook || !isValidWebhook(webhook)) {
    return {
      configured: false,
      sent: false,
      skipped: true,
      code: 'CHAT_NOT_CONFIGURED',
      error: 'No hay un webhook válido de Google Chat configurado para Agenda.',
      status: 0,
    };
  }

  const now = new Intl.DateTimeFormat('es-CR', {
    timeZone: 'America/Costa_Rica',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date());
  const text = [
    '✅ DMS BOLETAS · PRUEBA DE CHAT DE AGENDA',
    '',
    'El webhook de Google Chat está recibiendo mensajes correctamente.',
    `Prueba realizada: ${now}`,
  ].join('\n');

  try {
    const result = await sendChatMessage(webhook, text, { attempts: 2 });
    return {
      configured: true,
      sent: true,
      status: Number(result?.status || 0),
      attempts: Number(result?.attempts || 1),
    };
  } catch (error) {
    console.warn(`[agenda-chat] Falló la prueba del webhook: ${error?.message || error}`);
    return deliveryError(error, 'Google Chat no pudo recibir el mensaje de prueba.');
  }
}

export async function sendAgendaChatNotification({ views = [], mode = 'CREATED', appUrl = '' } = {}) {
  let webhook = '';
  try {
    webhook = await getWebhook();
  } catch (error) {
    console.warn(`[agenda-chat] No se pudo leer la configuración: ${error?.message || error}`);
    return {
      configured: true,
      sent: false,
      error: error?.message || 'No se pudo consultar la configuración del chat de Agenda.',
      code: error?.code || 'AGENDA_CHAT_CONFIG_READ_FAILED',
      status: Number(error?.status || 0),
    };
  }

  if (!webhook || !isValidWebhook(webhook)) {
    return { configured: false, sent: false, skipped: true };
  }

  const text = buildAgendaChatMessage({ views, mode, appUrl });
  try {
    const result = await sendChatMessage(webhook, text, { attempts: 2 });
    return {
      configured: true,
      sent: Boolean(result?.sent),
      status: Number(result?.status || 0),
      attempts: Number(result?.attempts || 1),
    };
  } catch (error) {
    console.warn(`[agenda-chat] No se pudo enviar la notificación: ${error?.message || error}`);
    return deliveryError(error, 'No se pudo enviar la agenda a Google Chat.');
  }
}

export const AGENDA_CHAT_CONFIG_KEY = CONFIG_KEY;