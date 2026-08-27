import { readTables } from '../infra/sheets.repository.js';
import {
  buildAgendaViews,
  costaRicaDate,
  normalizeAgendaText,
} from '../services/agenda-domain.service.js';
import { ensureAgendaSchema } from '../services/agenda-schema.service.js';
import { assistantDynamicMaintenanceQuestionHandlers } from './assistant-dynamic-maintenance-questions.module.js';

function clean(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function admin(ctx = {}) {
  return Array.isArray(ctx.permissions) && ctx.permissions.includes('USUARIOS_GESTIONAR');
}

function agendaIntent(question) {
  const text = normalizeAgendaText(question);
  if (!text) return false;
  if (/\bagendas?\b/.test(text) || /\bprogramacion(?:es)?\b/.test(text)) return true;
  if (/\bdonde\s+(?:fue|fui|estuvo|estuve|anduvo)\b/.test(text)) return true;
  if (/\bdetalle\b/.test(text) && /\bpalabra\b/.test(text)) return true;
  return /\bvisitas?\b/.test(text) && /\bmes(?:es)?\b/.test(text) && /\bultimo|ultimos|ultima|ultimas\b/.test(text);
}

const NUMBER_WORDS = Object.freeze({
  un: 1, uno: 1, una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
});

function dateUtc(value) {
  const [year, month, day] = String(value).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function monthsAgo(dateText, months) {
  const date = dateUtc(dateText);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - Math.max(0, months));
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return isoDate(date);
}

function monthStart(dateText, offset = 0) {
  const date = dateUtc(dateText);
  return isoDate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1)));
}

function monthEnd(dateText, offset = 0) {
  const date = dateUtc(dateText);
  return isoDate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset + 1, 0)));
}

function parseMonths(question) {
  const text = normalizeAgendaText(question);
  const numeric = text.match(/\b(?:ultimos?|ultimas?|de los|de las)?\s*(\d{1,2})\s+mes(?:es)?\b/);
  if (numeric) return Math.max(1, Math.min(24, Number(numeric[1])));
  for (const [word, number] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\s+mes(?:es)?\\b`).test(text)) return number;
  }
  if (/\bultimo mes\b|\bultima mes\b|\bun mes\b/.test(text)) return 1;
  return 1;
}

function requestedPeriod(question) {
  const text = normalizeAgendaText(question);
  const today = costaRicaDate();
  if (/\bmes pasado\b|\bmes anterior\b/.test(text)) {
    return { from: monthStart(today, -1), to: monthEnd(today, -1), label: 'el mes pasado' };
  }
  if (/\beste mes\b|\bmes actual\b/.test(text)) {
    return { from: monthStart(today), to: today, label: 'este mes' };
  }
  const months = parseMonths(question);
  return {
    from: monthsAgo(today, months),
    to: today,
    label: months === 1 ? 'el último mes' : `los últimos ${months} meses`,
  };
}

function extractKeyword(question) {
  const raw = clean(question);
  const quoted = raw.match(/["“”']([^"“”']{2,80})["“”']/);
  if (quoted) return clean(quoted[1]);
  const text = normalizeAgendaText(raw);
  const match = text.match(/\bpalabra(?:\s+clave)?\s+([a-z0-9][a-z0-9_-]{1,60})\b/);
  if (match) return match[1];
  const detail = text.match(/\bdetalle\b.{0,40}\b(?:contenga|contengan|con)\s+([a-z0-9][a-z0-9_-]{1,60})\b/);
  return detail ? detail[1] : '';
}

function activeUser(user = {}) {
  return normalizeAgendaText(user.Estado || 'ACTIVO') === 'activo' && Boolean(clean(user.UsuarioID));
}

function displayName(user = {}) {
  return clean(user.NombreCompleto || user.Nombre || user.NombreUsuario || user.Correo, 'Usuario');
}

function uniqueFirstNameMatch(users, question) {
  const text = normalizeAgendaText(question);
  const byToken = new Map();
  users.forEach((user) => {
    const first = normalizeAgendaText(displayName(user)).split(' ')[0];
    if (!first || first.length < 3) return;
    if (!byToken.has(first)) byToken.set(first, []);
    byToken.get(first).push(user);
  });
  for (const [token, matches] of byToken.entries()) {
    if (matches.length === 1 && new RegExp(`\\b${token}\\b`).test(text)) return matches[0];
  }
  return null;
}

function requestedUser(ctx, users, question) {
  if (!admin(ctx)) return users.find((user) => clean(user.UsuarioID) === clean(ctx.user?.UsuarioID)) || null;
  const text = normalizeAgendaText(question);
  if (/\bdonde fui\b|\bdonde estuve\b|\bmis agendas\b|\bmi agenda\b/.test(text)) {
    return users.find((user) => clean(user.UsuarioID) === clean(ctx.user?.UsuarioID)) || null;
  }

  const sorted = [...users].sort((left, right) => displayName(right).length - displayName(left).length);
  const exact = sorted.find((user) => {
    const candidates = [displayName(user), user.NombreUsuario, user.Correo]
      .map(normalizeAgendaText)
      .filter((value) => value.length >= 3);
    return candidates.some((candidate) => text.includes(candidate));
  });
  return exact || uniqueFirstNameMatch(users, question);
}

function statusLabel(item) {
  if (item.status === 'COMPLETA') return item.boleta?.BoletaNumero
    ? `boleta #${item.boleta.BoletaNumero}`
    : 'boleta realizada';
  if (item.status === 'NO_REQUIERE') return 'no requiere boleta';
  if (item.status === 'CANCELADA') return 'cancelada';
  if (item.status === 'FUTURA') return 'programada';
  return 'boleta pendiente';
}

function agendaLine(item, index) {
  const people = item.asignados.map((user) => user.NombreCompleto).filter(Boolean).join(', ');
  return `${index + 1}. ${item.Fecha} · ${item.HoraInicio}-${item.HoraFin} · ${item.Detalle}${people ? ` · ${people}` : ''} · ${statusLabel(item)}`;
}

function agendaSources(items) {
  const sources = [];
  items.slice(0, 10).forEach((item) => {
    sources.push({
      type: 'agenda',
      id: item.AgendaID,
      label: `${item.Fecha} · ${item.Detalle.slice(0, 70)}`,
      url: `/agenda?agendaId=${encodeURIComponent(item.AgendaID)}`,
    });
    if (item.boleta?.BoletaUID && sources.length < 10) {
      sources.push({
        type: 'ticket',
        id: item.boleta.BoletaUID,
        label: item.boleta.BoletaNumero ? `Boleta #${item.boleta.BoletaNumero}` : 'Boleta relacionada',
        url: `/boletas/${encodeURIComponent(item.boleta.BoletaUID)}`,
      });
    }
  });
  return sources.slice(0, 10);
}

async function answerAgendaQuestion(ctx, question) {
  await ensureAgendaSchema();
  const tables = await readTables(['Agendas', 'AgendaAsignados', 'Usuarios', 'Boletas', 'BoletaAsignados']);
  const users = (tables.Usuarios || []).filter(activeUser);
  const period = requestedPeriod(question);
  const keyword = extractKeyword(question);
  const user = requestedUser(ctx, users, question);

  let views = buildAgendaViews({
    agendas: tables.Agendas || [],
    agendaAssignments: tables.AgendaAsignados || [],
    users,
    tickets: tables.Boletas || [],
    ticketAssignments: tables.BoletaAsignados || [],
  }).filter((item) => item.Fecha >= period.from && item.Fecha <= period.to);

  if (!admin(ctx)) {
    const ownId = clean(ctx.user?.UsuarioID);
    views = views.filter((item) => item.asignados.some((assigned) => clean(assigned.UsuarioID) === ownId));
  } else if (user) {
    views = views.filter((item) => item.asignados.some((assigned) => clean(assigned.UsuarioID) === clean(user.UsuarioID)));
  }

  if (keyword) {
    const normalizedKeyword = normalizeAgendaText(keyword);
    views = views.filter((item) => normalizeAgendaText(item.Detalle).includes(normalizedKeyword));
  }

  views.sort((left, right) => right.Fecha.localeCompare(left.Fecha) || right.HoraInicio.localeCompare(left.HoraInicio));

  const scope = [
    user ? `para ${displayName(user)}` : '',
    keyword ? `con la palabra “${keyword}” en el detalle` : '',
    `durante ${period.label}`,
  ].filter(Boolean).join(' ');

  const answer = views.length
    ? [`Encontré ${views.length} agenda${views.length === 1 ? '' : 's'} ${scope}:`, ...views.slice(0, 40).map(agendaLine)]
      .concat(views.length > 40 ? [`Se muestran las 40 más recientes de ${views.length}.`] : [])
      .join('\n')
    : `No encontré agendas ${scope}.`;

  return {
    type: 'answer',
    answer,
    sources: agendaSources(views),
    facts: {
      agendaResults: {
        total: views.length,
        from: period.from,
        to: period.to,
        period: period.label,
        userId: user?.UsuarioID || '',
        userName: user ? displayName(user) : '',
        keyword,
        rows: views.slice(0, 100),
      },
    },
    suggestions: user
      ? [
        `¿Dónde fue ${displayName(user)} los últimos tres meses?`,
        `¿Qué agendas de ${displayName(user)} tenían la palabra mantenimiento?`,
      ]
      : [
        '¿Qué agendas del último mes tenían la palabra mantenimiento?',
        'Dime las agendas de los últimos tres meses',
      ],
    context: {
      ...(ctx.payload?.context || {}),
      lastIntent: 'agenda_history',
      agendaUserId: user?.UsuarioID || '',
      agendaKeyword: keyword,
    },
  };
}

async function chat(ctx) {
  const question = clean(ctx.payload?.message || ctx.payload?.question);
  if (agendaIntent(question)) return answerAgendaQuestion(ctx, question);
  return assistantDynamicMaintenanceQuestionHandlers.chat(ctx);
}

export const assistantAgendaHandlers = {
  ...assistantDynamicMaintenanceQuestionHandlers,
  chat,
};
