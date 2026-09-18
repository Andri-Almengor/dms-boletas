import { pick } from '../core/utils.js';
import { maintenancePlannedCountsChanged } from '../core/maintenance-progress.js';
import { findById, findRows, queryMaintenanceHomeSummary, queryPage } from '../infra/sheets.repository.js';
import {
  maintenanceDynamicQuestionHandlers as baseMaintenanceHandlers,
  maintenanceQuestionHandlers,
} from './maintenance-question-ready.module.js';
import { queueMaintenanceProgressNotification } from '../services/maintenance-progress-chat.service.js';
import { addVisibleMaintenanceDeviceCounts } from '../services/maintenance-list-domain.js';

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
  if (canUseHomeSummary(ctx.payload)) return queryMaintenanceHomeSummary(ctx.payload);

  const page = await queryPage('Mantenimiento', ctx.payload || {}, {
    searchFields: ['TituloMantenimiento', 'Cliente', 'Responsables', 'DescripcionGeneral', 'Ubicacion'],
    excludeInactive: true,
  });
  if (!page.items.length) return page;
  const ids = page.items.map((row) => clean(row.MantenimientoID)).filter(Boolean);
  const devices = await findRows('Evidencia_Mantenimientos', { MantenimientoRef: ids }, { limit: 50_000 });
  return { ...page, items: addVisibleMaintenanceDeviceCounts(page.items, devices) };
}

async function requestedMaintenanceAlreadyExists(ctx) {
  const requestedId = clean(pick(ctx.payload, ['maintenanceId', 'MantenimientoID'], ''));
  if (!requestedId) return false;
  return Boolean(await findById('Mantenimiento', requestedId).catch(() => null));
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
