const MAINTENANCE_TICKET_NUMBER_PATTERN = /^M(\d+)$/i;
const MAINTENANCE_TICKET_UID_PATTERN = /^mnt-[a-f0-9]{12}-[a-f0-9]{20}$/i;

export function isMaintenanceGeneratedTicketUid(value = '') {
  return MAINTENANCE_TICKET_UID_PATTERN.test(String(value || '').trim());
}

export function formatMaintenanceTicketNumber(sequence) {
  const value = Number.parseInt(String(sequence ?? ''), 10);
  if (!Number.isInteger(value) || value < 1) return '';
  return `M${String(value).padStart(2, '0')}`;
}

export function maintenanceTicketSequence(value = '') {
  const match = String(value || '').trim().match(MAINTENANCE_TICKET_NUMBER_PATTERN);
  if (!match) return 0;
  const sequence = Number.parseInt(match[1], 10);
  return Number.isInteger(sequence) && sequence > 0 ? sequence : 0;
}

export function nextMaintenanceTicketNumber(rows = []) {
  const used = rows
    .map((row) => maintenanceTicketSequence(row?.BoletaID))
    .filter((value) => value > 0);
  const next = (used.length ? Math.max(...used) : 0) + 1;
  return formatMaintenanceTicketNumber(next);
}
