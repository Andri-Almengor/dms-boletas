import { pick } from '../services/moduleApi';
import { costaRicaDateKey, formatCostaRicaDate, parseCostaRicaDate, todayInCostaRica } from './costaRicaDate';

export function normalizeTicketStatus(ticket) {
  const status = String(pick(ticket, ['Estado', 'estado', 'Status', 'status'], '')).trim().toUpperCase();
  if (status.includes('FINAL')) return 'FINALIZADA';
  if (status.includes('PEND')) return 'PENDIENTE';
  return status || 'PENDIENTE';
}

export function getTicketId(ticket, fallback = '') {
  return pick(ticket, ['BoletaID', 'TicketID', 'ID', 'id', 'RowID'], fallback);
}

export function formatDate(value, options = {}) {
  return formatCostaRicaDate(value, options);
}

export function formatTime(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{1,2}:\d{2}/.test(value)) return value.slice(0, 5);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('es-CR', {
    timeZone: 'America/Costa_Rica',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function ticketDateKey(ticket) {
  return String(pick(ticket, ['Fecha', 'fecha', 'FechaCreacion', 'CreatedAt'], '')).slice(0, 10);
}

function ticketNumber(ticket) {
  const value = Number(pick(ticket, ['BoletaID', 'TicketID'], 0));
  return Number.isFinite(value) ? value : 0;
}

function ticketCreatedAt(ticket) {
  const value = Date.parse(pick(ticket, ['FechaCreacion', 'CreatedAt', 'FechaActualizacion'], ''));
  return Number.isNaN(value) ? 0 : value;
}

export function sortTicketsNewestFirst(tickets = []) {
  return [...tickets].sort((left, right) => {
    const byDate = ticketDateKey(right).localeCompare(ticketDateKey(left));
    if (byDate) return byDate;
    const byNumber = ticketNumber(right) - ticketNumber(left);
    if (byNumber) return byNumber;
    return ticketCreatedAt(right) - ticketCreatedAt(left);
  });
}

export function groupTicketsByDate(tickets) {
  const groups = new Map();
  const todayKey = todayInCostaRica();
  const today = parseCostaRicaDate(todayKey);
  const yesterday = new Date(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayKey = costaRicaDateKey(yesterday);

  sortTicketsNewestFirst(tickets).forEach((ticket) => {
    const rawDate = pick(ticket, ['Fecha', 'FechaCreacion', 'CreatedAt', 'fecha']);
    const key = costaRicaDateKey(rawDate);
    let label = 'Sin fecha';

    if (key) {
      if (key === todayKey) label = 'Hoy';
      else if (key === yesterdayKey) label = 'Ayer';
      else label = formatDate(rawDate, { long: true });
    }

    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(ticket);
  });

  return Array.from(groups, ([label, items]) => ({ label, items }));
}

export function getEvidenceList(ticket) {
  const raw = pick(ticket, ['Evidencias', 'evidences', 'Imagenes', 'Fotos', 'Evidencia'], []);
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return raw.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
  }
}
