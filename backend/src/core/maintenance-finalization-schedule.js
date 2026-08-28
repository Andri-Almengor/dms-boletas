export const MAINTENANCE_FINALIZATION_TIME_ZONE = 'America/Costa_Rica';
export const MAINTENANCE_FINALIZATION_HOUR = 17;

const COSTA_RICA_UTC_OFFSET_HOURS = -6;

function asDate(value) {
  if (value instanceof Date) return new Date(value.getTime());
  const date = new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) throw new Error('Fecha inválida para programar la finalización.');
  return date;
}

function localParts(date) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: MAINTENANCE_FINALIZATION_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const values = Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function scheduledUtcForLocalDay(parts) {
  // Costa Rica usa UTC-6 durante todo el año y no aplica horario de verano.
  const utcHour = MAINTENANCE_FINALIZATION_HOUR - COSTA_RICA_UTC_OFFSET_HOURS;
  return Date.UTC(parts.year, parts.month - 1, parts.day, utcHour, 0, 0, 0);
}

export function maintenanceFinalizationSchedule(value = new Date()) {
  const now = asDate(value);
  const parts = localParts(now);
  const scheduledMs = scheduledUtcForLocalDay(parts);
  return {
    timeZone: MAINTENANCE_FINALIZATION_TIME_ZONE,
    hour: MAINTENANCE_FINALIZATION_HOUR,
    scheduledAt: new Date(scheduledMs).toISOString(),
    dueNow: now.getTime() >= scheduledMs,
    localDate: `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`,
  };
}

export function isMaintenanceFinalizationDue(scheduledAt, value = new Date()) {
  const scheduledMs = new Date(scheduledAt || 0).getTime();
  if (!Number.isFinite(scheduledMs) || scheduledMs <= 0) return false;
  return asDate(value).getTime() >= scheduledMs;
}
