import { AppError } from '../core/errors.js';
import { pick } from '../core/utils.js';
import { findById } from '../infra/sheets.repository.js';

const GUARDED_ROUTES = new Set([
  'maintenance.update',
  'mantenimientos.update',
  'maintenance.update.locations',
  'mantenimientos.update.ubicaciones',
  'maintenance.locations.update',
  'mantenimientos.ubicaciones.actualizar',
  'maintenance.devices.create',
  'mantenimientos.dispositivos.create',
  'maintenance.devices.update',
  'mantenimientos.dispositivos.update',
  'maintenance.devices.autosave',
  'mantenimientos.dispositivos.autosave',
  'maintenance.devices.delete',
  'mantenimientos.dispositivos.delete',
  'maintenance.images.upload',
  'mantenimientos.imagenes.upload',
  'maintenance.images.uploadBatch',
  'mantenimientos.imagenes.subirLote',
  'maintenance.images.update',
  'mantenimientos.imagenes.update',
  'maintenance.images.updateBatch',
  'mantenimientos.imagenes.actualizarLote',
  'maintenance.images.delete',
  'mantenimientos.imagenes.delete',
  'maintenance.images.large.init',
  'mantenimientos.imagenes.grande.iniciar',
  'maintenance.images.large.chunk',
  'mantenimientos.imagenes.grande.bloque',
]);

function clean(value) {
  return String(value ?? '').trim();
}

function maintenanceId(payload = {}) {
  return clean(pick(payload, [
    'maintenanceId',
    'MantenimientoID',
    'MantenimientoRef',
    'mantenimientoId',
  ]));
}

export function isMaintenanceEditGuardedRoute(route) {
  return GUARDED_ROUTES.has(clean(route));
}

export async function assertMaintenanceNotScheduledForEditing(route, payload = {}) {
  if (!isMaintenanceEditGuardedRoute(route)) return;
  const id = maintenanceId(payload);
  if (!id) return;

  const row = await findById('Mantenimiento', id);
  if (clean(row.EstadoFinalizacion).toUpperCase() !== 'PROGRAMADO') return;

  throw new AppError(
    'MAINTENANCE_FINALIZATION_SCHEDULED_LOCKED',
    'Este mantenimiento está programado para finalizarse a las 5:00 p. m. Cancele la finalización programada antes de modificar datos, dispositivos o evidencias.',
    409,
    {
      maintenanceId: id,
      scheduledAt: clean(row.FinalizacionProgramadaPara),
    },
  );
}
