import { aiConfig } from './agent.config.js';

const SPANISH_MONTHS = Object.freeze({
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
});

function parts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: aiConfig.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const values = Object.fromEntries(formatter.formatToParts(date).map((item) => [item.type, item.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  };
}

function toYmd(value) {
  return `${value.year}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`;
}

function shift(value, days) {
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day + days, 12));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function weekday(value) {
  return new Date(Date.UTC(value.year, value.month - 1, value.day, 12)).getUTCDay();
}

function monthRange(year, month) {
  const start = { year, month, day: 1 };
  const next = month === 12 ? { year: year + 1, month: 1, day: 1 } : { year, month: month + 1, day: 1 };
  return { from: toYmd(start), to: toYmd(shift(next, -1)) };
}

function validYmd(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function parseMonth(value, today) {
  const text = String(value || '').trim().toLowerCase();
  const iso = text.match(/^(\d{4})-(\d{1,2})$/);
  if (iso) {
    const month = Number(iso[2]);
    if (month >= 1 && month <= 12) return { year: Number(iso[1]), month };
  }
  const words = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/\s+/).filter(Boolean);
  const month = SPANISH_MONTHS[words[0]];
  if (!month) return null;
  const explicitYear = words.map(Number).find((item) => Number.isInteger(item) && item >= 2000 && item <= 2100);
  return { year: explicitYear || today.year, month };
}

export function resolveDateRange(input = {}, now = new Date()) {
  const today = parts(now);
  const current = toYmd(today);
  const exactFrom = validYmd(input.dateFrom);
  const exactTo = validYmd(input.dateTo);
  if (exactFrom || exactTo) return { from: exactFrom || '', to: exactTo || current, label: 'rango indicado' };

  const month = parseMonth(input.month, today);
  if (month) return { ...monthRange(month.year, month.month), label: String(input.month) };

  const period = String(input.period || '').trim().toLowerCase();
  if (!period || period === 'all') return { from: '', to: '', label: 'todo el historial' };
  if (period === 'today' || period === 'hoy') return { from: current, to: current, label: 'hoy' };
  if (period === 'yesterday' || period === 'ayer') {
    const value = toYmd(shift(today, -1));
    return { from: value, to: value, label: 'ayer' };
  }
  if (period === 'current_week') {
    const day = weekday(today);
    const mondayOffset = day === 0 ? -6 : 1 - day;
    return { from: toYmd(shift(today, mondayOffset)), to: current, label: 'esta semana' };
  }
  if (period === 'previous_week') {
    const day = weekday(today);
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const currentMonday = shift(today, mondayOffset);
    return { from: toYmd(shift(currentMonday, -7)), to: toYmd(shift(currentMonday, -1)), label: 'la semana pasada' };
  }
  if (period === 'current_month') return { ...monthRange(today.year, today.month), to: current, label: 'este mes' };
  if (period === 'previous_month') {
    const previous = today.month === 1 ? { year: today.year - 1, month: 12 } : { year: today.year, month: today.month - 1 };
    return { ...monthRange(previous.year, previous.month), label: 'el mes pasado' };
  }
  if (period === 'last_7_days') return { from: toYmd(shift(today, -6)), to: current, label: 'últimos 7 días' };
  if (period === 'last_30_days') return { from: toYmd(shift(today, -29)), to: current, label: 'últimos 30 días' };
  if (period === 'year_to_date') return { from: `${today.year}-01-01`, to: current, label: 'desde enero' };
  return { from: '', to: '', label: period };
}

export function costaRicaNowIso(now = new Date()) {
  const date = new Intl.DateTimeFormat('sv-SE', {
    timeZone: aiConfig.timezone,
    dateStyle: 'short',
    timeStyle: 'medium',
    hour12: false,
  }).format(now);
  return date.replace(' ', 'T');
}
