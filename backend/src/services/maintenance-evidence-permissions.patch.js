import { badRequest, forbidden } from '../core/errors.js';
import { findById, softDelete } from '../infra/sheets.repository.js';
import { trashFile } from '../infra/drive.repository.js';
import { pick } from '../core/utils.js';
import { maintenanceHandlers } from '../modules/maintenance.module.js';
import { maintenanceDynamicQuestionHandlers } from '../modules/maintenance-question-ready.module.js';
import { maintenanceProgressChatHandlers } from '../modules/maintenance-progress-chat.module.js';
import { loadMaintenanceEvidenceContext } from './maintenance-evidence-policy.service.js';
import { audit } from './audit.service.js';

function hasPermission(ctx, code) {
  return Array.isArray(ctx?.permissions) && ctx.permissions.includes(code);
}

function canManageEvidence(ctx) {
  return hasPermission(ctx, 'USUARIOS_GESTIONAR')
    || hasPermission(ctx, 'MANTENIMIENTOS_GESTIONAR')
    || hasPermission(ctx, 'MANTENIMIENTOS_ELIMINAR');
}

async function deleteAuthorizedMaintenanceEvidence(ctx) {
  // action-router exige permiso de edición; validar nuevamente antes de alterar Drive o PostgreSQL.
  const admin = canManageEvidence(ctx);
  if (!admin && !hasPermission(ctx, 'MANTENIMIENTOS_EDITAR') && !hasPermission(ctx, 'BOLETAS_EDITAR')) {
    throw forbidden('No cuenta con permiso para eliminar evidencias del mantenimiento.');
  }

  const imageId = String(pick(ctx.payload, ['imageId', 'FotoDispositivoID'], '')).trim();
  if (!imageId) throw badRequest('Indique la evidencia que desea eliminar.');
  const image = await findById('Mantenimiento imagenes', imageId);
  const deviceId = String(image.DispositivoMantenimientoRef || '');
  const requestedDeviceId = String(pick(ctx.payload, ['deviceId', 'EvidenciaMantenimientoID'], '')).trim();
  if (requestedDeviceId && requestedDeviceId !== deviceId) {
    throw badRequest('La evidencia no pertenece al dispositivo indicado.');
  }
  const context = await loadMaintenanceEvidenceContext({
    deviceId,
    maintenanceId: pick(ctx.payload, ['maintenanceId', 'MantenimientoID'], ''),
  });
  if (!admin && String(context.maintenance.Estado || 'PENDIENTE').toUpperCase() !== 'PENDIENTE') {
    throw forbidden('Los técnicos solo pueden eliminar evidencias mientras el mantenimiento esté pendiente.');
  }

  // Conservar el flujo existente de Drive + borrado lógico/sync, sin crear ruta paralela.
  if (image.DriveFileID) await trashFile(image.DriveFileID).catch(() => {});
  const after = await softDelete('Mantenimiento imagenes', image.FotoDispositivoID, ctx.user.UsuarioID);
  const auditView = (row) => ({
    FotoDispositivoID: row.FotoDispositivoID,
    DispositivoMantenimientoRef: row.DispositivoMantenimientoRef,
    Tipo: row.Tipo,
    Activo: row.Activo,
  });
  await audit(ctx, 'ELIMINAR_EVIDENCIA_MANTENIMIENTO', 'Mantenimiento imagenes', imageId, auditView(image), auditView(after)).catch(() => {});
  return after;
}

// maintenanceProgressChatHandlers es el registro que usa action-router. El parche anterior
// solo modificaba maintenanceHandlers; esa copia ya había sido extendida por otras vistas.
maintenanceHandlers.imageDelete = deleteAuthorizedMaintenanceEvidence;
maintenanceDynamicQuestionHandlers.imageDelete = deleteAuthorizedMaintenanceEvidence;
maintenanceProgressChatHandlers.imageDelete = (ctx) => maintenanceDynamicQuestionHandlers.imageDelete(ctx);

// Aplicar la política de conflictos/sync sobre el handler activo, antes de construir las rutas.
await import('./maintenance-sync-conflict.patch.js');
