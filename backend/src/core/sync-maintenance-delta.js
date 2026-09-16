function clean(value) {
  return String(value ?? '').trim();
}

function active(row = {}) {
  return row.Activo !== false && String(row.Activo ?? 'true').toLowerCase() !== 'false';
}

function normalizeStatus(value) {
  const text = clean(value).toUpperCase();
  if (text === 'FINALIZADA') return 'FINALIZADO';
  return text;
}

export function materializeMaintenanceDeltaFromRows({
  events = [],
  maintenances = [],
  devices = [],
} = {}) {
  const changedIds = new Set(events.map((event) => clean(event.EntityID)).filter(Boolean));
  const changedRows = new Map();
  const counts = { pending: 0, finished: 0 };

  // Counts and changed authoritative rows are resolved in the same pass. This
  // avoids filter + map + Map copies of the complete maintenance collection.
  for (const maintenance of maintenances) {
    if (!active(maintenance)) continue;
    const entityId = clean(maintenance.MantenimientoID);
    const status = normalizeStatus(maintenance.Estado);
    if (status === 'PENDIENTE') counts.pending += 1;
    else if (status === 'FINALIZADO') counts.finished += 1;
    if (entityId && changedIds.has(entityId)) {
      changedRows.set(entityId, { ...maintenance, Estado: status });
    }
  }

  const deviceCounts = new Map();
  for (const device of devices) {
    if (!active(device)) continue;
    const entityId = clean(device.MantenimientoRef);
    if (!entityId || !changedIds.has(entityId)) continue;
    deviceCounts.set(entityId, (deviceCounts.get(entityId) || 0) + 1);
  }

  const upserts = [];
  const removed = [];
  for (const event of events) {
    const entityId = clean(event.EntityID);
    if (!entityId) continue;
    if (String(event.Operation || '').toUpperCase() === 'DELETE') {
      removed.push(entityId);
      continue;
    }
    const maintenance = changedRows.get(entityId);
    if (!maintenance) {
      removed.push(entityId);
      continue;
    }
    upserts.push({
      ...maintenance,
      DispositivosRegistrados: deviceCounts.get(entityId) || 0,
    });
  }

  return {
    upserts,
    removed: [...new Set(removed)],
    invalidated: [],
    counts,
  };
}
