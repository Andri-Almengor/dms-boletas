import { forbidden } from '../core/errors.js';
import { nowIso, pick } from '../core/utils.js';
import { findById, updateRow } from '../infra/sheets.repository.js';
import { audit } from '../services/audit.service.js';
import { deliverMaintenance } from '../services/maintenance-delivery.service.js';
import { maintenanceHandlers } from './maintenance.module.js';

function isAdmin(ctx) {
  return ctx.permissions.includes('USUARIOS_GESTIONAR')
    || ctx.permissions.includes('MANTENIMIENTOS_GESTIONAR');
}

async function finalizedMaintenance(ctx) {
  const id = pick(ctx.payload, ['maintenanceId', 'MantenimientoID', 'id']);
  const before = await findById('Mantenimiento', id);
  const delivery = await deliverMaintenance(ctx, id, { testMode: false });
  const timestamp = nowIso();
  await updateRow('Mantenimiento', id, {
    Estado: 'FINALIZADO',
    FechaFinalizacion: timestamp,
    CarpetaDriveID: delivery.folderId,
    CarpetaDriveURL: delivery.folderUrl,
    EstadoNotificacion: 'ENVIADO',
    ChatDestino: delivery.destination,
    ChatEnviadoEn: timestamp,
    ChatFallbackPruebas: delivery.fallbackToTest,
    ImagenesEsperadas: delivery.imagesExpected,
    ImagenesCopiadas: delivery.imagesCopied,
    ImagenesYaExistentes: delivery.imagesAlreadyPresent,
    ErroresCopia: delivery.errors.join(' | '),
    ActualizadoPor: ctx.user.UsuarioID,
    FechaActualizacion: timestamp,
  });
  const result = await maintenanceHandlers.get({ ...ctx, payload: { maintenanceId: id } });
  await audit(ctx, 'FINALIZAR_MANTENIMIENTO_CON_ENTREGA', 'Mantenimiento', id, before, {
    ...result.mantenimiento,
    CarpetaDriveURL: delivery.folderUrl,
    ChatDestino: delivery.destination,
    ImagenesCopiadas: delivery.imagesCopied,
  });
  return { ...result, delivery };
}

async function testMaintenanceDelivery(ctx) {
  if (!isAdmin(ctx)) throw forbidden('Solo los administradores pueden probar el envío de mantenimientos.');
  const id = pick(ctx.payload, ['maintenanceId', 'MantenimientoID', 'id']);
  const before = await findById('Mantenimiento', id);
  const delivery = await deliverMaintenance(ctx, id, { testMode: true });
  await audit(ctx, 'PROBAR_ENVIO_MANTENIMIENTO', 'Mantenimiento', id, before, {
    Estado: before.Estado,
    CarpetaDriveURL: delivery.folderUrl,
    ChatDestino: delivery.destination,
    EstadoCambiado: false,
  });
  return {
    tested: true,
    stateChanged: false,
    maintenanceId: id,
    delivery,
    message: 'La prueba fue enviada al Chat de pruebas sin cambiar el estado del mantenimiento.',
  };
}

export const maintenanceDeliveryHandlers = {
  ...maintenanceHandlers,
  finalize: finalizedMaintenance,
  testFinalize: testMaintenanceDelivery,
};
