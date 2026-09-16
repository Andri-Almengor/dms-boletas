import { summarizeMaintenanceHomeRows } from '../core/home-summary.js';
import { countRowsBy } from '../core/row-index.js';
import { readTables } from '../infra/sheets.repository.js';

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
  const activeRows = maintenances.filter(active);
  const counts = summarizeMaintenanceHomeRows(activeRows.map((row) => ({
    ...row,
    Estado: normalizeStatus(row.Estado),
  })));
  const changedIds = new Set(events.map((event) => clean(event.EntityID)).filter(Boolean));
  const deviceCounts = countRowsBy(
    devices,
    (device) => device.MantenimientoRef,
    { predicate: (device) => active(device) && changedIds.has(clean(device.MantenimientoRef)) },
  );
  const byId = new Map(activeRows.map((row) => [clean(row.MantenimientoID), row]));
  const upserts = [];
  const removed = [];

  for (const event of events) {
    const entityId = clean(event.EntityID);
    if (!entityId) continue;
    if (String(event.Operation || '').toUpperCase() === 'DELETE') {
      removed.push(entityId);
      continue;
    }
    const maintenance = byId.get(entityId);
    if (!maintenance) {
      removed.push(entityId);
      continue;
    }
    upserts.push({
      ...maintenance,
      Estado: normalizeStatus(maintenance.Estado),
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

export async function materializeMaintenanceDelta(_ctx = {}, events = []) {
  const tables = await readTables(['Mantenimiento', 'Evidencia_Mantenimientos']);
  return materializeMaintenanceDeltaFromRows({
    events,
    maintenances: tables.Mantenimiento || [],
    devices: tables.Evidencia_Mantenimientos || [],
  });
}
