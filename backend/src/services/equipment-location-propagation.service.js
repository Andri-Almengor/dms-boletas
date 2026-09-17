import {
  findRows,
  getHeaders,
  updateRows,
} from '../infra/sheets.repository.js';

const DEVICE_SHEET = 'Evidencia_Mantenimientos';

function clean(value) {
  return String(value ?? '').trim();
}

export async function propagateEquipmentLocationName({ equipmentLocationId, name, actor = '' }) {
  const id = clean(equipmentLocationId);
  const nextName = clean(name);
  if (!id || !nextName) return { updatedDevices: 0 };

  const [headers, related] = await Promise.all([
    getHeaders(DEVICE_SHEET),
    findRows(DEVICE_SHEET, { UbicacionEquipoID: id }, { limit: 50_000 }),
  ]);
  if (!related.length) return { updatedDevices: 0 };

  const timestamp = new Date().toISOString();
  const valuesByHeader = new Map([
    ['Zona', nextName],
    ['UbicacionEquipoNombre', nextName],
    ['ActualizadoPor', actor],
    ['FechaActualizacion', timestamp],
  ]);
  const patch = Object.fromEntries(
    [...valuesByHeader.entries()].filter(([header]) => headers.includes(header)),
  );
  if (!Object.keys(patch).length) return { updatedDevices: 0 };

  const updates = related
    .filter((row) => clean(row.EvidenciaMantenimientoID))
    .map((row) => ({ idValue: row.EvidenciaMantenimientoID, patch }));

  if (updates.length) {
    await updateRows(DEVICE_SHEET, updates, 'EvidenciaMantenimientoID');
  }
  return { updatedDevices: updates.length };
}
