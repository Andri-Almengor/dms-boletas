function parseTimeToSeconds(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] || 0);

  if (
    !Number.isInteger(hour)
    || !Number.isInteger(minute)
    || !Number.isInteger(second)
    || hour < 0
    || hour > 23
    || minute < 0
    || minute > 59
    || second < 0
    || second > 59
  ) {
    return null;
  }

  return (hour * 3600) + (minute * 60) + second;
}

/**
 * Aplica una hora mínima únicamente a trabajos de hasta una hora.
 * Después de la primera hora conserva la duración real con dos decimales.
 * También permite visitas que terminan después de medianoche.
 */
export function calculateMinimumOneHourTotalHours(start, end) {
  if (!start || !end) return 0;

  const startSeconds = parseTimeToSeconds(start);
  const endSeconds = parseTimeToSeconds(end);
  if (startSeconds === null || endSeconds === null) return 0;

  let elapsedSeconds = endSeconds - startSeconds;
  if (elapsedSeconds < 0) elapsedSeconds += 24 * 60 * 60;
  if (elapsedSeconds <= 0) return 0;

  const exactHours = elapsedSeconds / 3600;
  if (exactHours <= 1) return 1;
  return Number(exactHours.toFixed(2));
}

// Alias conservado para compatibilidad con código anterior.
export function calculateCeilingTotalHours(start, end) {
  return calculateMinimumOneHourTotalHours(start, end);
}

const TICKET_HOUR_ROUTES = new Set([
  'boletas.create',
  'tickets.create',
  'boletas.update',
  'tickets.update',
  'boletas.autosave',
]);

export function normalizeTicketHoursPayload(route, payload = {}) {
  if (!TICKET_HOUR_ROUTES.has(String(route || ''))) return payload;

  const hasStart = Object.prototype.hasOwnProperty.call(payload, 'HoraInicio')
    || Object.prototype.hasOwnProperty.call(payload, 'horaInicio');
  const hasEnd = Object.prototype.hasOwnProperty.call(payload, 'HoraFinal')
    || Object.prototype.hasOwnProperty.call(payload, 'horaFinal');

  if (!hasStart || !hasEnd) return payload;

  const start = payload.HoraInicio ?? payload.horaInicio;
  const end = payload.HoraFinal ?? payload.horaFinal;
  const total = calculateMinimumOneHourTotalHours(start, end);

  return {
    ...payload,
    HorasTotales: total,
    horasTotales: total,
  };
}
