function normalizedKey(value) {
  return String(value ?? '').trim();
}

function includeRow(row, predicate) {
  return typeof predicate !== 'function' || predicate(row);
}

export function indexRowsBy(rows = [], keySelector, { predicate } = {}) {
  const index = new Map();
  for (const row of rows || []) {
    if (!includeRow(row, predicate)) continue;
    const key = normalizedKey(keySelector(row));
    if (key) index.set(key, row);
  }
  return index;
}

export function groupRowsBy(rows = [], keySelector, { predicate } = {}) {
  const groups = new Map();
  for (const row of rows || []) {
    if (!includeRow(row, predicate)) continue;
    const key = normalizedKey(keySelector(row));
    if (!key) continue;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

export function countRowsBy(rows = [], keySelector, options = {}) {
  const counts = new Map();
  for (const [key, group] of groupRowsBy(rows, keySelector, options)) counts.set(key, group.length);
  return counts;
}
