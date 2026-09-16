import { readTables } from '../infra/sheets.repository.js';
import { materializeMaintenanceDeltaFromRows } from '../core/sync-maintenance-delta.js';

export { materializeMaintenanceDeltaFromRows } from '../core/sync-maintenance-delta.js';

export async function materializeMaintenanceDelta(_ctx = {}, events = []) {
  const tables = await readTables(['Mantenimiento', 'Evidencia_Mantenimientos']);
  return materializeMaintenanceDeltaFromRows({
    events,
    maintenances: tables.Mantenimiento || [],
    devices: tables.Evidencia_Mantenimientos || [],
  });
}
