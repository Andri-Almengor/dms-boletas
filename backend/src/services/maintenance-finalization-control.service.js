import { AppError } from '../core/errors.js';
import { nowIso, pick } from '../core/utils.js';
import { findById, readTable, updateRow } from '../infra/sheets.repository.js';
import { audit } from './audit.service.js';
import {
  findFinalizationJobForMaintenance,
  getFinalizationJob,
  updateFinalizationJob,
} from './maintenance-finalization-job.storage.js';

const ACTIVE_STATES = new Set(['PROGRAMADO', 'EN_PROCESO']);
const ADMIN_PERMISSION = 'USUARIOS_GESTIONAR';
export const FINALIZATION_STOPPED_CODE = 'FINALIZATION_STOPPED';

function clean(value) {
  return String(value ?? '').trim();
}

function assertAuthorized(ctx) {
  if ((ctx?.permissions || []).includes(ADMIN_PERMISSION)) return;
  throw new AppError('FORBIDDEN', 'No tiene permiso para administrar finalizaciones de mantenimiento.', 403);
}

function maintenanceId(ctx) {
  return clean(pick(ctx?.payload || {}, ['maintenanceId', 'MantenimientoID', 'id']));
}

function stateOf(row = {}) {
  return clean(row.EstadoFinalizacion).toUpperCase();
}

function active(row = {}) {
  return clean(row.Estado).toUpperCase() !== 'FINALIZADO' && ACTIVE_STATES.has(stateOf(row));
}

function compactRow(row = {}) {
  return {
    MantenimientoID: clean(row.MantenimientoID),
    TituloMantenimiento: clean(row.TituloMantenimiento || row.Titulo || row.Descripcion),
    Cliente: clean(row.Cliente || row.ClienteNombre || row.NombreCliente),
    Fecha: clean(row.Fecha || row.FechaInicio),
    Estado: clean(row.Estado),
    EstadoFinalizacion: stateOf(row),
    PasoFinalizacion: clean(row.PasoFinalizacion),
    FinalizacionJobID: clean(row.FinalizacionJobID),
    FinalizacionProgreso: Number(row.FinalizacionProgreso || 0),
    FinalizacionMensaje: clean(row.FinalizacionMensaje),
    FinalizacionSolicitadaEn: clean(row.FinalizacionSolicitadaEn),
    FinalizacionSolicitadaPor: clean(row.FinalizacionSolicitadaPor),
    FinalizacionProgramadaPara: clean(row.FinalizacionProgramadaPara),
    FinalizacionActualizadaEn: clean(row.FinalizacionActualizadaEn),
    FinalizacionTotalBoletas: Number(row.FinalizacionTotalBoletas || 0),
    FinalizacionBoletasCompletadas: Number(row.FinalizacionBoletasCompletadas || 0),
    FinalizacionTotalDispositivos: Number(row.FinalizacionTotalDispositivos || 0),
    FinalizacionDispositivosCompletados: Number(row.FinalizacionDispositivosCompletados || 0),
    FinalizacionTotalEvidencias: Number(row.FinalizacionTotalEvidencias || 0),
    FinalizacionEvidenciasProcesadas: Number(row.FinalizacionEvidenciasProcesadas || 0),
  };
}

export async function assertMaintenanceFinalizationNotStopped(jobId) {
  const id = clean(jobId);
  if (!id) return;
  const job = await getFinalizationJob(id);
  if (clean(job?.Estado).toUpperCase() !== 'DETENIDO') return;
  throw new AppError(
    FINALIZATION_STOPPED_CODE,
    'La finalización fue detenida manualmente. Lo ya completado se conserva.',
    409,
  );
}

async function listActive(ctx) {
  assertAuthorized(ctx);
  const rows = await readTable('Mantenimiento', { force: true });
  const items = rows
    .filter(active)
    .sort((left, right) => clean(right.FinalizacionActualizadaEn).localeCompare(clean(left.FinalizacionActualizadaEn)))
    .map(compactRow);
  return {
    items,
    total: items.length,
    activeStates: [...ACTIVE_STATES],
  };
}

async function stop(ctx) {
  assertAuthorized(ctx);
  const id = maintenanceId(ctx);
  if (!id) throw new AppError('VALIDATION_ERROR', 'No se indicó el mantenimiento cuya finalización se debe detener.', 400);

  const before = await findById('Mantenimiento', id);
  if (clean(before.Estado).toUpperCase() === 'FINALIZADO') {
    throw new AppError('MAINTENANCE_ALREADY_FINALIZED', 'Este mantenimiento ya está finalizado y no puede detenerse.', 409);
  }
  if (!active(before)) {
    throw new AppError('FINALIZATION_NOT_ACTIVE', 'Este mantenimiento no tiene una finalización activa que se pueda detener.', 409);
  }

  const actor = ctx.user?.UsuarioID || 'SISTEMA';
  const timestamp = nowIso();
  const job = await findFinalizationJobForMaintenance(id, before.FinalizacionJobID).catch(() => null);

  if (job && !['COMPLETADO', 'DETENIDO'].includes(clean(job.Estado).toUpperCase())) {
    await updateFinalizationJob(job.JobID, {
      Estado: 'DETENIDO',
      UltimoError: '',
      ActualizadoPor: actor,
    });
  }

  const updated = await updateRow('Mantenimiento', id, {
    EstadoFinalizacion: 'DETENIDO',
    PasoFinalizacion: 'DETENIDO',
    FinalizacionMensaje: 'Finalización detenida manualmente. Lo ya completado se conserva y no se procesarán nuevas unidades.',
    FinalizacionProgramadaPara: '',
    FinalizacionCanceladaEn: timestamp,
    FinalizacionActualizadaEn: timestamp,
    UltimoErrorFinalizacion: '',
    ActualizadoPor: actor,
    FechaActualizacion: timestamp,
  });

  await audit(ctx, 'DETENER_FINALIZACION_MANTENIMIENTO', 'Mantenimiento', id, before, updated).catch(() => {});
  return {
    mantenimiento: compactRow(updated),
    stopped: true,
    completedWorkPreserved: true,
    message: 'La finalización fue detenida. El paso que ya estaba ejecutándose puede terminar, pero no se iniciarán nuevas unidades.',
  };
}

export const maintenanceFinalizationControlHandlers = {
  listActive,
  stop,
};
