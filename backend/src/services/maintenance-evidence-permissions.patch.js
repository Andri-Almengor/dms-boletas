import { findById, softDelete } from '../infra/sheets.repository.js';
import { trashFile } from '../infra/drive.repository.js';
import { pick } from '../core/utils.js';
import { maintenanceHandlers } from '../modules/maintenance.module.js';

// La ruta ya exige permisos de edición de mantenimientos en action-router.
// Se reemplaza únicamente la restricción adicional que limitaba esta acción
// a administradores, para que los técnicos autorizados también puedan borrar
// fotografías desde la aplicación.
maintenanceHandlers.imageDelete = async (ctx) => {
  const imageId = pick(ctx.payload, ['imageId', 'FotoDispositivoID']);
  const row = await findById('Mantenimiento imagenes', imageId);
  if (row.DriveFileID) await trashFile(row.DriveFileID).catch(() => {});
  return softDelete('Mantenimiento imagenes', row.FotoDispositivoID, ctx.user.UsuarioID);
};
