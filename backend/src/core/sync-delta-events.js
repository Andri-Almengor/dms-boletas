function clean(value) {
  return String(value ?? '').trim();
}

export function dedupeSyncEvents(events = [], resource = '') {
  const latest = new Map();
  for (const event of events) {
    if (resource && clean(event.Resource) !== clean(resource)) continue;
    const entityId = clean(event.EntityID);
    if (!entityId) continue;
    latest.set(entityId, event);
  }
  return [...latest.values()].sort(
    (left, right) => Number(left.__rowNumber || 0) - Number(right.__rowNumber || 0),
  );
}

export function selectSyncResourceEvents(events = [], resource = '', entityId = '') {
  const deduped = dedupeSyncEvents(events, resource);
  const target = clean(entityId);
  if (!target) {
    return {
      targeted: false,
      notModified: deduped.length === 0,
      events: deduped,
    };
  }
  const selected = deduped.filter((event) => clean(event.EntityID) === target);
  return {
    targeted: true,
    notModified: selected.length === 0,
    events: selected,
  };
}
