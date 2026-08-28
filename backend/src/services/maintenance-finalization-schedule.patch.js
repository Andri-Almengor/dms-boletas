import { AppError } from '../core/errors.js';
import { nowIso, pick } from '../core/utils.js';
import {
  isMaintenanceFinalizationDue,
  maintenanceFinalizationSchedule,
} from '../core/maintenance-finalization-schedule.js';
import { findById, readTable, updateRow } from '../infra/sheets.repository.js';
import { maintenanceAutomationHandlers } from '../modules/maintenance-automation.module.js';
import { maintenanceProgressChatHandlers } from '../modules/maintenance-progress-chat.module.js';
import { audit } from './audit.service.js';
import { ensureSheetColumns } from './sheet-columns.service.js';

// Garantiza que esta capa envuelva la finalización escalonada y no al revés.
await import('./maintenance-finalization-resume.patch.js');

const INSTALL_FLAG = Symbol.for('dms.maintenanceFinalization5pmSchedule');
const GET_FLAG = Symbol.for('dms.maintenanceFinalization5pmSchedule.get');
const SCHEDULE_COLUMNS = [
  'FinalizacionProgramadaPara',
  'FinalizacionProgramadaEn',
  'FinalizacionCanceladaEn',
];
const SYSTEM_PERMISSIONS = Object.freeze([
  'USUARIOS_GESTIONAR',
  'MANTENIMIENTOS_VER',
  'MANTENIMIENTOS_GESTIONAR',
  'MANTENIMIENTOS_EDITAR',
  'BOLETAS_VER',
  'BOLETAS_EDITAR',
  'BOLETAS_GESTIONAR',
]);

function clean(value) {
  return String(value ?? '').trim();
}

function boolean(value) {
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'si', 'sí', 'yes'].includes(clean(value).toLowerCase());
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function maintenanceId(ctx, row = {}) {
  return clean(
    pick(ctx?.payload || {}, ['maintenanceId', 'MantenimientoID', 'id'])
      || row.MantenimientoID,
  );
}

function stateOf(row = {}) {
  return clean(row.EstadoFinalizacion).toUpperCase();
}

function isScheduled(row = {}) {
  return stateOf(row) === 'PROGRAMADO';
}

function isProcessing(row = {}) {
  return stateOf(row) === 'EN_PROCESO';
}

function isFinalized(row = {}) {
  return clean(row.Estado).toUpperCase() === 'FINALIZADO';
}

function retryRequested(ctx) {
  return boolean(pick(ctx?.payload || {}, ['retryFinalization', 'reintentarFinalizacion'], false));
}

function cancelRequested(ctx) {
  return boolean(pick(ctx?.payload || {}, ['cancelScheduledFinalization', 'cancelarFinalizacionProgramada'], false));
}

function forceRequested(ctx) {
  return boolean(pick(ctx?.payload || {}, ['forceScheduledFinalization', 'forzarFinalizacionProgramada'], false));
}

function testMode(ctx) {
  return Boolean(ctx?.payload?.testMode || ctx?.payload?.prueba);
}

async function ensureScheduleStorage() {
  await ensureSheetColumns('Mantenimiento', SCHEDULE_COLUMNS);
}

function scheduledResponse(row, message = '') {
  return {
    mantenimiento: row,
    scheduled: true,
    completed: false,
    continue: false,
    message: message || row.FinalizacionMensaje || 'La finalización quedó programada para las 5:00 p. m. hora Costa Rica.',
  };
}

function systemContext(id, payload = {}) {
  return {
    route: 'maintenance.finalize',
    payload: {
      maintenanceId: id,
      MantenimientoID: id,
      forceScheduledFinalization: true,
      ...payload,
    },
    sessionToken: '',
    ip: '127.0.0.1',
    userAgent: 'DMS-Maintenance-Finalization-Worker',
    origin: clean(process.env.APP_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL),
    user: {
      UsuarioID: 'SISTEMA_1700',
      Nombre: 'Worker de finalización 17:00',
      Rol: 'SISTEMA',
    },
    permissions: [...SYSTEM_PERMISSIONS],
  };
}

async function scheduleBeforeFive(ctx, baseFinalize) {
  const id = maintenanceId(ctx);
  if (!id) throw new AppError('VALIDATION_ERROR', 'No se indicó el mantenimiento que se debe finalizar.', 400);
  await ensureScheduleStorage();
  const row = await findById('Mantenimiento', id);

  if (isFinalized(row) || retryRequested(ctx) || forceRequested(ctx) || isProcessing(row)) {
    return baseFinalize(ctx);
  }

  if (cancelRequested(ctx)) {
    if (!isScheduled(row)) {
      throw new AppError('FINALIZATION_NOT_SCHEDULED', 'Este mantenimiento no tiene una finalización programada que se pueda cancelar.', 409);
    }
    const timestamp = nowIso();
    const updated = await updateRow('Mantenimiento', id, {
      EstadoFinalizacion: 'NINGUNO',
      PasoFinalizacion: '',
      FinalizacionProgreso: 0,
      FinalizacionMensaje: 'La finalización programada fue cancelada.',
      FinalizacionProgramadaPara: '',
      FinalizacionCanceladaEn: timestamp,
      FinalizacionActualizadaEn: timestamp,
      UltimoErrorFinalizacion: '',
      ActualizadoPor: ctx.user?.UsuarioID || 'SISTEMA',
      FechaActualizacion: timestamp,
    });
    await audit(ctx, 'CANCELAR_FINALIZACION_PROGRAMADA', 'Mantenimiento', id, row, updated).catch(() => {});
    return {
      mantenimiento: updated,
      scheduled: false,
      canceled: true,
      message: 'La finalización programada fue cancelada. El mantenimiento vuelve a quedar disponible para continuar trabajando.',
    };
  }

  const schedule = maintenanceFinalizationSchedule(new Date());
  if (schedule.dueNow) return baseFinalize(ctx);

  if (isScheduled(row)) {
    return scheduledResponse(row, 'Este mantenimiento ya está programado para finalizarse automáticamente a las 5:00 p. m. hora Costa Rica.');
  }

  const timestamp = nowIso();
  const actor = ctx.user?.UsuarioID || 'SISTEMA';
  const updated = await updateRow('Mantenimiento', id, {
    EstadoFinalizacion: 'PROGRAMADO',
    PasoFinalizacion: 'ESPERANDO_1700',
    FinalizacionSolicitudID: clean(ctx.payload?.finalizationRequestId) || `finalize-${id}`,
    FinalizacionSolicitadaEn: row.FinalizacionSolicitadaEn || timestamp,
    FinalizacionSolicitadaPor: actor,
    FinalizacionProgramadaPara: schedule.scheduledAt,
    FinalizacionProgramadaEn: timestamp,
    FinalizacionCanceladaEn: '',
    FinalizacionProgreso: 0,
    FinalizacionMensaje: 'Finalización programada para hoy a las 5:00 p. m. hora Costa Rica. Puede cerrar la aplicación.',
    FinalizacionActualizadaEn: timestamp,
    UltimoErrorFinalizacion: '',
    ActualizadoPor: actor,
    FechaActualizacion: timestamp,
  });

  await audit(ctx, 'PROGRAMAR_FINALIZACION_MANTENIMIENTO', 'Mantenimiento', id, row, updated).catch(() => {});
  return scheduledResponse(updated);
}

function rowFromResult(result = {}) {
  return result?.mantenimiento || result || {};
}

function dueScheduledRows(rows, now = new Date()) {
  return rows.filter((row) => (
    !isFinalized(row)
    && isScheduled(row)
    && isMaintenanceFinalizationDue(row.FinalizacionProgramadaPara, now)
  ));
}

function nextScheduledAt(rows, now = new Date()) {
  const nowMs = now.getTime();
  return rows
    .filter((row) => !isFinalized(row) && isScheduled(row))
    .map((row) => clean(row.FinalizacionProgramadaPara))
    .filter(Boolean)
    .map((value) => ({ value, time: new Date(value).getTime() }))
    .filter((item) => Number.isFinite(item.time) && item.time > nowMs)
    .sort((a, b) => a.time - b.time)[0]?.value || '';
}

let wakePromise = null;
let baseProgressFinalize = null;

export async function wakeScheduledMaintenanceFinalizations({ waitMs = 25_000, source = 'EXTERNAL_WAKE' } = {}) {
  if (wakePromise) return wakePromise;
  wakePromise = (async () => {
    await ensureScheduleStorage();
    const startedAt = nowIso();
    const rows = await readTable('Mantenimiento', { force: true });
    const now = new Date();
    const dueRows = dueScheduledRows(rows, now);
    const processingRows = rows.filter((row) => !isFinalized(row) && isProcessing(row));
    const candidates = [...new Map(
      [...dueRows, ...processingRows].map((row) => [clean(row.MantenimientoID), row]),
    ).values()].filter((row) => clean(row.MantenimientoID));

    const results = [];
    for (const row of candidates) {
      const id = clean(row.MantenimientoID);
      try {
        const result = await baseProgressFinalize(systemContext(id, { workerSource: source }));
        results.push({
          maintenanceId: id,
          ok: true,
          scheduled: isScheduled(row),
          state: clean(result?.mantenimiento?.EstadoFinalizacion || result?.mantenimiento?.Estado || ''),
        });
      } catch (error) {
        results.push({
          maintenanceId: id,
          ok: false,
          scheduled: isScheduled(row),
          error: clean(error?.message || error).slice(0, 500),
        });
      }
    }

    const boundedWait = Math.max(0, Math.min(45_000, Number(waitMs) || 0));
    if (candidates.length && boundedWait) await sleep(boundedWait);

    const refreshed = await readTable('Mantenimiento', { force: true });
    const refreshedNow = new Date();
    const duePending = dueScheduledRows(refreshed, refreshedNow);
    const processing = refreshed.filter((row) => !isFinalized(row) && isProcessing(row));
    const scheduled = refreshed.filter((row) => !isFinalized(row) && isScheduled(row));
    const errors = refreshed.filter((row) => !isFinalized(row) && stateOf(row) === 'ERROR');

    return {
      ok: true,
      source,
      startedAt,
      finishedAt: nowIso(),
      invoked: candidates.length,
      scheduled: scheduled.length,
      dueScheduled: duePending.length,
      processing: processing.length,
      errors: errors.length,
      pending: duePending.length + processing.length,
      nextDueAt: nextScheduledAt(refreshed, refreshedNow),
      results,
    };
  })().finally(() => {
    wakePromise = null;
  });
  return wakePromise;
}

if (!maintenanceProgressChatHandlers[INSTALL_FLAG]) {
  baseProgressFinalize = maintenanceProgressChatHandlers.finalize;
  const baseAutomationFinalize = maintenanceAutomationHandlers.finalize;

  maintenanceProgressChatHandlers.finalize = async (ctx) => {
    if (testMode(ctx)) return baseProgressFinalize(ctx);
    return scheduleBeforeFive(ctx, baseProgressFinalize);
  };

  maintenanceAutomationHandlers.finalize = async (ctx) => {
    if (testMode(ctx)) return baseAutomationFinalize(ctx);
    return scheduleBeforeFive(ctx, baseAutomationFinalize);
  };

  maintenanceProgressChatHandlers[INSTALL_FLAG] = true;
  maintenanceAutomationHandlers[INSTALL_FLAG] = true;
}

if (!maintenanceProgressChatHandlers[GET_FLAG]) {
  const baseGet = maintenanceProgressChatHandlers.get;
  maintenanceProgressChatHandlers.get = async (ctx) => {
    const result = await baseGet(ctx);
    const row = rowFromResult(result);
    const id = maintenanceId(ctx, row);
    if (!id || !isScheduled(row) || !isMaintenanceFinalizationDue(row.FinalizacionProgramadaPara, new Date())) {
      return result;
    }

    if (ctx.payload?.finalizationStatusOnly) {
      try {
        return await baseProgressFinalize(systemContext(id, { workerSource: 'APP_STATUS_POLL' }));
      } catch (error) {
        console.error(`[maintenance-finalization-5pm][${id}]`, error);
        return result;
      }
    }

    Promise.resolve()
      .then(() => baseProgressFinalize(systemContext(id, { workerSource: 'APP_GET' })))
      .catch((error) => console.error(`[maintenance-finalization-5pm][${id}]`, error));
    return result;
  };
  maintenanceProgressChatHandlers[GET_FLAG] = true;
}
