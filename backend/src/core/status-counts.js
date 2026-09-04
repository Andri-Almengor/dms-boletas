function normalizedStatus(value) {
  return String(value ?? '').trim().toUpperCase();
}

export function countStatuses(rows = [], statusKey = 'Estado') {
  const counts = {};
  for (const row of rows || []) {
    const status = normalizedStatus(row?.[statusKey]);
    if (!status) continue;
    counts[status] = Number(counts[status] || 0) + 1;
  }
  return counts;
}
