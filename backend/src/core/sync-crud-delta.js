function clean(value) {
  return String(value ?? '').trim();
}

function plainRow(row = {}) {
  const { __rowNumber: _rowNumber, ...plain } = row || {};
  return plain;
}

export function materializeCrudDeltaFromRows({
  events = [],
  rows = [],
  idField = 'id',
  transformRow = (row) => row,
} = {}) {
  const byId = new Map(
    (rows || [])
      .map((row) => [clean(row?.[idField]), row])
      .filter(([id]) => Boolean(id)),
  );
  const upserts = [];
  const removed = [];
  const seenUpserts = new Set();

  for (const event of events || []) {
    const entityId = clean(event?.EntityID);
    if (!entityId) continue;
    if (String(event?.Operation || '').toUpperCase() === 'DELETE') {
      removed.push(entityId);
      continue;
    }

    const row = byId.get(entityId);
    if (!row) {
      removed.push(entityId);
      continue;
    }
    if (seenUpserts.has(entityId)) continue;
    seenUpserts.add(entityId);
    upserts.push(transformRow(plainRow(row)));
  }

  return {
    upserts,
    removed: [...new Set(removed)].filter((id) => !seenUpserts.has(id)),
    invalidated: [],
    counts: null,
  };
}
