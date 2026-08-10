import { forbidden } from '../core/errors.js';
import { pick } from '../core/utils.js';
import { findById, softDelete } from '../infra/sheets.repository.js';
import { maintenanceProgressChatHandlers } from '../modules/maintenance-progress-chat.module.js';
import { audit } from './audit.service.js';

function hasPermission(ctx, code) {
  return Array.isArray(ctx?.permissions) && ctx.permissions.includes(code);
}

function isAdministrator(ctx) {
  return hasPermission(ctx, 'USUARIOS_GESTIONAR')
    || hasPermission(ctx, 'MANTENIMIENTOS_GESTIONAR')
    || hasPermission(ctx, 'MANTENIMIENTOS_ELIMINAR');
}

function canTechnicianDeleteDevice(ctx) {
  return hasPermission(ctx, 'MANTENIMIENTOS_EDITAR')
    || hasPermission(ctx, 'BOLETAS_EDITAR');
}

maintenanceProgressChatHandlers.deviceDelete = async function technicianMaintenanceDeviceDelete(ctx) {
  const id = pick(ctx.payload, ['deviceId', 'EvidenciaMantenimientoID', 'id']);
  const before = await findById('Evidencia_Mantenimientos', id);
  const maintenance = await findById('Mantenimiento', before.MantenimientoRef);
  const administrator = isAdministrator(ctx);

  if (!administrator && !canTechnicianDeleteDevice(ctx)) throw forbidden();
  if (!administrator && String(maintenance.Estado || 'PENDIENTE').toUpperCase() !== 'PENDIENTE') {
    throw forbidden('Los técnicos solo pueden eliminar dispositivos mientras el mantenimiento esté pendiente.');
  }

  const after = await softDelete('Evidencia_Mantenimientos', id, ctx.user.UsuarioID);
  await audit(
    ctx,
    'ELIMINAR_DISPOSITIVO_MANTENIMIENTO',
    'Evidencia_Mantenimientos',
    id,
    before,
    after,
  ).catch(() => {});
  return after;
};
