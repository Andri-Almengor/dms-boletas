import { AppError } from '../core/errors.js';
import { nowIso, pick } from '../core/utils.js';
import { findById, updateRow } from '../infra/sheets.repository.js';

export const MAINTENANCE_FINALIZATION_COLUMNS = Object.freeze([
  'EstadoFinalizacion',
  'PasoFinalizacion',
  'FinalizacionSolicitudID',
  'FinalizacionIntentos',
  'FinalizacionSolicitadaEn',
  'FinalizacionIniciadaEn',
  'FinalizacionActualizadaEn',
  'FinalizacionCompletadaEn',
  'FinalizacionSolicitadaPor',
  'UltimoErrorFinalizacion',
]);

const running = new Map();

function clean(value) {
  return String(value ?? '').trim();
}

function boolean(value) {
  return value === true || ['true', '1', 'si', 'sí', 'yes'].includes(clean(value).toLowerCase());
}

function requestId(ctx, maintenanceId, row = {}) {
  return clean(pick(ctx.payload, ['finalizationRequestId', 'FinalizacionSolicitudID']))
    || clean(row.FinalizacionSolicitudID)
    || `finalize-${maintenanceId}`;
}

/**
 * Compatibilidad con las capas históricas de finalización.
 *
 * Desde la finalización escalonada, el estado durable vive en
 * MaintenanceFinalizationJobs / MaintenanceFinalizationItems. Estas columnas
 * pueden existir en instalaciones antiguas, pero NO son un requisito y no se
 * deben crear dinámicamente en Mantenimiento. updateRow ya ignora cualquier
 * campo cuyo encabezado no exista físicamente.
 */
export async function ensureMaintenanceFinalizationColumns() {
  return MAINTENANCE_FINALIZATION_COLUMNS;
}

export async function markMaintenanceFinalizationStep(maintenanceId, step, patch = {}) {
  const timestamp = nowIso();
  return updateRow('Mantenimiento', maintenanceId, {
    EstadoFinalizacion: step === 'COMPLETADO' ? 'COMPLETADO' : 'EN_PROCESO',
    PasoFinalizacion: step,
    FinalizacionActualizadaEn: timestamp,
    UltimoErrorFinalizacion: '',
    ...patch,
    FechaActualizacion: timestamp,
  });
}

function deliveryUncertain(row = {}) {
  return clean(row.EstadoNotificacion).toUpperCase() === 'ENVIANDO'
    && ['ENTREGANDO', 'ERROR'].includes(clean(row.PasoFinalizacion).toUpperCase());
}

async function execute(ctx, maintenanceId, work) {
  await ensureMaintenanceFinalizationColumns();
  const before = await findById('Mantenimiento', maintenanceId);
  const retry = boolean(pick(ctx.payload, ['retryFinalization', 'reintentarFinalizacion'], false));

  if (clean(before.Estado).toUpperCase() === 'FINALIZADO'
    || clean(before.EstadoFinalizacion).toUpperCase() === 'COMPLETADO') {
    await markMaintenanceFinalizationStep(maintenanceId, 'COMPLETADO', {
      EstadoFinalizacion: 'COMPLETADO',
      FinalizacionCompletadaEn: before.FinalizacionCompletadaEn || nowIso(),
    }).catch(() => {});
    return { alreadyFinalized: true, maintenance: before };
  }

  if (!retry && deliveryUncertain(before)) {
    throw new AppError(
      'MAINTENANCE_FINALIZATION_RETRY_REQUIRED',
      'La entrega anterior quedó en un estado incierto. Use “Reintentar finalización” para continuar sin ejecutar reintentos automáticos que puedan duplicar el mensaje.',
      409,
      {
        maintenanceId,
        step: before.PasoFinalizacion,
        canRetry: true,
      },
    );
  }

  const timestamp = nowIso();
  const attempts = Number(before.FinalizacionIntentos || 0) + 1;
  const finalizationRequestId = requestId(ctx, maintenanceId, before);
  let currentStep = 'VALIDANDO';

  await updateRow('Mantenimiento', maintenanceId, {
    EstadoFinalizacion: 'EN_PROCESO',
    PasoFinalizacion: currentStep,
    FinalizacionSolicitudID: finalizationRequestId,
    FinalizacionIntentos: attempts,
    FinalizacionSolicitadaEn: before.FinalizacionSolicitadaEn || timestamp,
    FinalizacionIniciadaEn: timestamp,
    FinalizacionActualizadaEn: timestamp,
    FinalizacionSolicitadaPor: ctx.user?.UsuarioID || before.FinalizacionSolicitadaPor || 'SISTEMA',
    UltimoErrorFinalizacion: '',
    ActualizadoPor: ctx.user?.UsuarioID || 'SISTEMA',
    FechaActualizacion: timestamp,
  });

  const tracker = {
    requestId: finalizationRequestId,
    attempts,
    get step() { return currentStep; },
    async mark(step, patch = {}) {
      currentStep = step;
      return markMaintenanceFinalizationStep(maintenanceId, step, {
        ActualizadoPor: ctx.user?.UsuarioID || 'SISTEMA',
        ...patch,
      });
    },
  };

  try {
    const result = await work(tracker, before);
    const completedAt = nowIso();
    await updateRow('Mantenimiento', maintenanceId, {
      EstadoFinalizacion: 'COMPLETADO',
      PasoFinalizacion: 'COMPLETADO',
      FinalizacionActualizadaEn: completedAt,
      FinalizacionCompletadaEn: completedAt,
      UltimoErrorFinalizacion: '',
      ActualizadoPor: ctx.user?.UsuarioID || 'SISTEMA',
      FechaActualizacion: completedAt,
    });
    return result;
  } catch (error) {
    const failedAt = nowIso();
    await updateRow('Mantenimiento', maintenanceId, {
      EstadoFinalizacion: 'ERROR',
      PasoFinalizacion: currentStep,
      FinalizacionActualizadaEn: failedAt,
      UltimoErrorFinalizacion: clean(error?.message || error).slice(0, 1500),
      ActualizadoPor: ctx.user?.UsuarioID || 'SISTEMA',
      FechaActualizacion: failedAt,
    }).catch(() => {});
    throw error;
  }
}

export function runResumableMaintenanceFinalization(ctx, maintenanceId, work) {
  const id = clean(maintenanceId);
  if (!id) throw new AppError('VALIDATION_ERROR', 'No se indicó el mantenimiento que se debe finalizar.', 400);
  if (running.has(id)) return running.get(id);
  const promise = execute(ctx, id, work).finally(() => running.delete(id));
  running.set(id, promise);
  return promise;
}
