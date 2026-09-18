import { query } from '../infra/postgres.js';
export { materializeMaintenanceDeltaFromRows } from '../core/sync-maintenance-delta.js';

function clean(value) { return String(value ?? '').trim(); }
function payload(row) { return row?.__payload && typeof row.__payload === 'object' ? { ...row.__payload } : null; }
function normalizeStatus(value) { const text=clean(value).toUpperCase(); return text === 'FINALIZADA' ? 'FINALIZADO' : text; }

export async function materializeMaintenanceDelta(_ctx = {}, events = []) {
  const changedIds = [...new Set((events || []).map((event) => clean(event?.EntityID)).filter(Boolean))];
  const countsResult = await query(
    `SELECT
       COUNT(*) FILTER (WHERE UPPER(COALESCE("Estado",''))='PENDIENTE')::bigint AS pending,
       COUNT(*) FILTER (WHERE UPPER(COALESCE("Estado",'')) IN ('FINALIZADO','FINALIZADA'))::bigint AS finished
     FROM "Mantenimiento"
     WHERE "__valid"=TRUE AND LOWER(COALESCE("Activo",'true')) <> 'false'`,
    [], { label: 'sync.maintenance.counts' },
  );

  const byId = new Map();
  const deviceCounts = new Map();
  if (changedIds.length) {
    const [maintenances, devices] = await Promise.all([
      query(
        `SELECT "MantenimientoID","Estado","__payload" FROM "Mantenimiento"
         WHERE "__valid"=TRUE AND LOWER(COALESCE("Activo",'true')) <> 'false' AND "MantenimientoID"=ANY($1::text[])`,
        [changedIds], { label: 'sync.maintenance.changed' },
      ),
      query(
        `SELECT "MantenimientoRef",COUNT(*)::bigint AS total FROM "Evidencia_Mantenimientos"
         WHERE "__valid"=TRUE AND LOWER(COALESCE("Activo",'true')) <> 'false' AND "MantenimientoRef"=ANY($1::text[])
         GROUP BY "MantenimientoRef"`,
        [changedIds], { label: 'sync.maintenance.devices' },
      ),
    ]);
    for (const row of maintenances.rows) {
      const item = payload(row);
      if (item) byId.set(clean(row.MantenimientoID), { ...item, Estado: normalizeStatus(row.Estado || item.Estado) });
    }
    for (const row of devices.rows) deviceCounts.set(clean(row.MantenimientoRef), Number(row.total || 0));
  }

  const upserts=[]; const removed=[]; const seen=new Set();
  for (const event of events || []) {
    const id=clean(event?.EntityID); if(!id||seen.has(id)) continue; seen.add(id);
    if(String(event?.Operation||'').toUpperCase()==='DELETE'){removed.push(id);continue;}
    const item=byId.get(id); if(!item){removed.push(id);continue;}
    upserts.push({...item,DispositivosRegistrados:deviceCounts.get(id)||0});
  }
  const counts=countsResult.rows[0]||{};
  return {upserts,removed,invalidated:[],counts:{pending:Number(counts.pending||0),finished:Number(counts.finished||0)}};
}
