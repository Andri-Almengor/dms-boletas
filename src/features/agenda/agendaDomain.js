const COSTA_RICA_TIME_ZONE = 'America/Costa_Rica';

export function normalizeAgendaText(value) {
  return String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function agendaRequiresTicket(detail) {
  const text = normalizeAgendaText(detail);
  if (!text) return true;
  return !(/\boficina(?:s)?\b/.test(text) || /\boffice\b/.test(text) || /\brn\b/.test(text));
}

export function costaRicaDateKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: COSTA_RICA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function parseDateKey(dateKey) {
  const match = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

export function addDays(dateKey, amount) {
  const date = parseDateKey(dateKey);
  if (!date) return '';
  date.setUTCDate(date.getUTCDate() + Number(amount || 0));
  return date.toISOString().slice(0, 10);
}

export function tomorrowCostaRicaDate() {
  return addDays(costaRicaDateKey(), 1);
}

export function monthKey(dateKey = costaRicaDateKey()) {
  return String(dateKey).slice(0, 7);
}

export function shiftMonth(value, amount) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) return monthKey();
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + Number(amount || 0), 1));
  return date.toISOString().slice(0, 7);
}

export function monthLabel(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) return '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  return new Intl.DateTimeFormat('es-CR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

export function calendarMonthRange(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) return { from: '', to: '' };
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const first = new Date(Date.UTC(year, month, 1));
  const last = new Date(Date.UTC(year, month + 1, 0));
  const mondayOffset = (first.getUTCDay() + 6) % 7;
  const sundayOffset = 6 - ((last.getUTCDay() + 6) % 7);
  first.setUTCDate(first.getUTCDate() - mondayOffset);
  last.setUTCDate(last.getUTCDate() + sundayOffset);
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

export function calendarDays(value) {
  const { from, to } = calendarMonthRange(value);
  if (!from || !to) return [];
  const days = [];
  for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) days.push(cursor);
  return days;
}

export function groupAgendasByDate(items = []) {
  const groups = new Map();
  items.forEach((item) => {
    const date = String(item?.Fecha || '').slice(0, 10);
    if (!date) return;
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(item);
  });
  groups.forEach((rows) => rows.sort((left, right) => (
    String(left.HoraInicio || '').localeCompare(String(right.HoraInicio || ''))
    || String(left.Detalle || '').localeCompare(String(right.Detalle || ''), 'es')
  )));
  return groups;
}

export function statusMeta(status) {
  const key = String(status || '').toUpperCase();
  if (key === 'COMPLETA') return { label: 'Boleta realizada', icon: 'task_alt', tone: 'success' };
  if (key === 'PENDIENTE') return { label: 'Boleta pendiente', icon: 'warning', tone: 'danger' };
  if (key === 'NO_REQUIERE') return { label: 'No requiere boleta', icon: 'remove_done', tone: 'neutral' };
  if (key === 'CANCELADA') return { label: 'Cancelada', icon: 'event_busy', tone: 'muted' };
  return { label: 'Programada', icon: 'schedule', tone: 'info' };
}
