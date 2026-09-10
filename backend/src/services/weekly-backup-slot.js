const WEEK_SLOT_PREFIX = 'WEEK_SLOT:';
const SHEETS_DATE_EPOCH_UTC = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SERIAL_NUMBER = /^\d+(?:\.\d+)?$/;

function clean(value, maxLength = 80) {
  return String(value ?? '').trim().slice(0, maxLength);
}

export function encodeWeeklyBackupSlot(slot) {
  const normalized = clean(slot, 20);
  return normalized ? `${WEEK_SLOT_PREFIX}${normalized}` : '';
}

export function decodeWeeklyBackupSlot(value) {
  const raw = clean(value, 80);
  if (!raw) return '';

  if (raw.startsWith(WEEK_SLOT_PREFIX)) {
    return clean(raw.slice(WEEK_SLOT_PREFIX.length), 20);
  }

  // Compatibilidad con valores anteriores escritos como USER_ENTERED.
  // Sheets puede almacenar YYYY-MM-DD como un número serial cuando las
  // lecturas usan UNFORMATTED_VALUE. Convertirlo aquí evita repetir el
  // respaldo de una semana ya completada durante el siguiente cold start.
  if (ISO_DATE.test(raw)) return raw;
  if (SERIAL_NUMBER.test(raw)) {
    const serial = Number(raw);
    if (Number.isFinite(serial) && serial >= 1 && serial <= 100_000) {
      const date = new Date(SHEETS_DATE_EPOCH_UTC + (Math.floor(serial) * DAY_MS));
      if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
    }
  }

  return raw;
}

export function shouldRunAutomaticBackup({ slot, lastSlot, lastStatus } = {}) {
  const normalizedSlot = decodeWeeklyBackupSlot(slot);
  const normalizedLastSlot = decodeWeeklyBackupSlot(lastSlot);
  const normalizedStatus = clean(lastStatus, 80).toUpperCase();
  if (!normalizedSlot) return false;
  return !(normalizedLastSlot === normalizedSlot && normalizedStatus === 'COMPLETADO');
}
