import { pick } from '../core/utils.js';
import { maintenancePlannedCountsChanged } from '../core/maintenance-progress.js';
import { summarizeMaintenanceHomeRows } from '../core/home-summary.js';
import { readTable, findById } from '../infra/sheets.repository.js';
import {
  maintenanceDynamicQuestionHandlers as baseMaintenanceHandlers,
  maintenanceQuestionHandlers,
} from './maintenance-question-ready.module.js';
import { queueMaintenanceProgressNotification } from '../services/maintenance-progress-chat.service.js';

function clean(value) {
  return String(value ?? '').trim();
}

function maintenanceFromResult(result = {}) {
  return result?.mantenimiento || result?.maintenance || result || {};
}

function canUseHomeSummary(payload = {}) {
  if (payload.homeSummary !== true) return false;
  const allowed = new Set(['homeSummary', 'page', 'pageSize', 'activo']);
  return Object.keys(payload).every((key) => allowed.has(key));
}

async function list(ctx) {
  if (!canUseHomeSummary(ctx.payload)) return baseMaintenanceHandlers.list(ctx);

  let rows = (await readTable('Mantenimiento'))
    .filter((row) => row.Activo !== false);
  if (ctx.payload.activo !== undefined) {
    rows = rows.filter((row) => (
      String(row.Activo).toLowerCase() === String(ctx.payload.activo).toLowerCase()
    ));
  }

  return {
    items: [],
    total: rows.length,
    page: 1,
    pageSize: 0,
    homeSummary: summarizeMaintenanceHomeRows(rows),
  };
}

async function requestedMaintenanceAlreadyExists(ctx) {
  const requestedId = clean(pick(ctx.payload, ['maintenanceId', 'MantenimientoID'], ''));
  if (!requestedId) return false;
  const rows = await readTable('Mantenimiento');
  return rows.some((row) => clean(row.MantenimientoID) === requestedId);
}

async function create(ctx) {
  // La creación puede reintentarse desde la cola offline usando el mismo ID.
  // Solo el primer alta real debe generar el aviso de "mantenimiento creado".
  const existed = await requestedMaintenanceAlreadyExists(ctx);
  const result = await baseMaintenanceHandlers.create(ctx);
  if (!existed) {
    const maintenance = maintenanceFromResult(result);
    queueMaintenanceProgressNotification({
      maintenance,
      reason: 'CREATED',
      actor: ctx.user?.UsuarioID || 'SYSTEM',
    });
  }
  return result;
}

async function update(ctx) {
  const id = clean(pick(ctx.payload, ['maintenanceId', 'MantenimientoID', 'id']));
  const before = await findById('Mantenimiento', id);
  const result = await baseMaintenanceHandlers.update(ctx);
  const after = maintenanceFromResult(result);

  // Editar título, responsables, fechas o descripción no genera ruido en el Chat.
  // El aviso inmediato se dispara únicamente cuando cambia la planificación de cantidades.
  if (maintenancePlannedCountsChanged(before, after)) {
    queueMaintenanceProgressNotification({
      maintenance: after,
      reason: 'COUNTS_UPDATED',
      actor: ctx.user?.UsuarioID || 'SYSTEM',
    });
  }
  return result;
}

export { maintenanceQuestionHandlers };

export const maintenanceProgressChatHandlers = {
  ...baseMaintenanceHandlers,
  list,
  create,
  update,
};
