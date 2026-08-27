import { badRequest } from '../core/errors.js';
import {
  appendRows,
  readTable,
  updateRows,
} from '../infra/sheets.repository.js';
import { isValidWebhook, redactWebhook, sendChatMessage } from './chat.service.js';

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
  return clean(rowsMap(rows).get(CONFIG_KEY), 20000);
}

export async function getAgendaChatSettings() {
  const webhook = await getWebhook();
  return {
    configured: isValidWebhook(webhook),
    redactedWebhook: redactWebhook(webhook),
  };
}

export async function updateAgendaChatSettings(payload = {}) {
  const webhook = clean(payload.webhook ?? payload.url ?? payload.chatWebhook, 20000);
  if (webhook && !isValidWebhook(webhook)) {
    throw badRequest('El webhook de Agenda debe ser una URL válida de Google Chat.');
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

export async function sendAgendaChatNotification({ views = [], mode = 'CREATED', appUrl = '' } = {}) {
  let webhook = '';
  try {
    webhook = await getWebhook();
  } catch (error) {
    console.warn(`[agenda-chat] No se pudo leer la configuración: ${error?.message || error}`);
    return {
      configured: false,
      sent: false,
      error: error?.message || 'No se pudo consultar la configuración del chat de Agenda.',
      code: error?.code || 'AGENDA_CHAT_CONFIG_READ_FAILED',
    };
  }

  if (!webhook || !isValidWebhook(webhook)) {
    return { configured: false, sent: false, skipped: true };
  }

  const text = buildAgendaChatMessage({ views, mode, appUrl });
  try {
    const result = await sendChatMessage(webhook, text);
    return {
      configured: true,
      sent: Boolean(result?.sent),
      status: result?.status || 0,
    };
  } catch (error) {
    console.warn(`[agenda-chat] No se pudo enviar la notificación: ${error?.message || error}`);
    return {
      configured: true,
      sent: false,
      error: error?.message || 'No se pudo enviar la agenda a Google Chat.',
      code: error?.code || '',
    };
  }
}

export const AGENDA_CHAT_CONFIG_KEY = CONFIG_KEY;
