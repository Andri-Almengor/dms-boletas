export const COSTA_RICA_TIME_ZONE = 'America/Costa_Rica';

function partsMap(date) {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: COSTA_RICA_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date).map((part) => [part.type, part.value]),
  );
}

export function todayInCostaRica(date = new Date()) {
  const parts = partsMap(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function parseCostaRicaDate(value) {
  if (value instanceof Date) return value;
  const text = String(value || '').trim();
  if (!text) return null;

  // Las fechas de boletas son fechas civiles, no instantes. JavaScript interpreta
  // YYYY-MM-DD como medianoche UTC y en Costa Rica eso se convierte en el día anterior.
  const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T00:00(?::00(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$)/);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12, 0, 0));
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function costaRicaDateKey(value) {
  const parsed = parseCostaRicaDate(value);
  return parsed ? todayInCostaRica(parsed) : '';
}

export function formatCostaRicaDate(value, { long = false } = {}) {
  const parsed = parseCostaRicaDate(value);
  if (!parsed) return value ? String(value) : 'Sin fecha';
  return new Intl.DateTimeFormat('es-CR', {
    timeZone: COSTA_RICA_TIME_ZONE,
    day: '2-digit',
    month: long ? 'long' : 'short',
    year: 'numeric',
  }).format(parsed);
}
