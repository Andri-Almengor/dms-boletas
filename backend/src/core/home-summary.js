function normalizedStatus(value) {
  return String(value ?? '').trim().toUpperCase();
}

function countStatuses(rows, pendingStatus, finishedStatus) {
  let pending = 0;
  let finished = 0;
  for (const row of rows || []) {
    const status = normalizedStatus(row?.Estado);
    if (status === pendingStatus) pending += 1;
    else if (status === finishedStatus) finished += 1;
  }
  return { pending, finished };
}

export function summarizeTicketHomeRows(rows = []) {
  return countStatuses(rows, 'PENDIENTE', 'FINALIZADA');
}

export function summarizeMaintenanceHomeRows(rows = []) {
  return countStatuses(rows, 'PENDIENTE', 'FINALIZADO');
}
