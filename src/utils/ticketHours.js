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
 * Replica la lógica de AppSheet:
 * CEILING(TOTALHOURS(HoraFinal - HoraInicio)).
 *
 * Cualquier fracción de hora se cobra/contabiliza como la hora completa siguiente
 * y se permite que la visita termine después de medianoche.
 */
export function calculateCeilingTotalHours(start, end) {
  if (!start || !end) return 0;

  const startSeconds = parseTimeToSeconds(start);
  const endSeconds = parseTimeToSeconds(end);
  if (startSeconds === null || endSeconds === null) return 0;

  let elapsedSeconds = endSeconds - startSeconds;
  if (elapsedSeconds < 0) elapsedSeconds += 24 * 60 * 60;

  return Math.ceil(elapsedSeconds / 3600);
}

export function formatCeilingTotalHours(start, end) {
  return calculateCeilingTotalHours(start, end).toFixed(2);
}
