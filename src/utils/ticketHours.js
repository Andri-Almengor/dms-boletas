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
 * Calcula las horas totales de una boleta con una hora mínima:
 * - De 1 segundo a 60 minutos se registra 1.00 hora.
 * - Después de la primera hora se conserva la duración real con dos decimales.
 * - Se permite que la visita termine después de medianoche.
 *
 * Ejemplos: 00:15 -> 1.00, 00:30 -> 1.00, 01:15 -> 1.25, 01:30 -> 1.50.
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

// Se conserva el nombre anterior para no romper componentes ya desplegados o en caché.
export function calculateCeilingTotalHours(start, end) {
  return calculateMinimumOneHourTotalHours(start, end);
}

export function formatCeilingTotalHours(start, end) {
  return calculateMinimumOneHourTotalHours(start, end).toFixed(2);
}
