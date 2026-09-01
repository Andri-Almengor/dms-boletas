import { apiRequest } from '../api';
import { requestFirstAvailable } from './aliasResolver';
import { isOfflineLocalId } from './offlineCatalogDomain';
import { isNetworkError } from './requestErrors';
import {
  enqueueOperation,
  getEntityQueueState,
  updateCachedResponses,
} from './offlineStore';
import { MODULE_ROUTES, normalizeItems, requestAvailable } from './moduleApi';
import {
  MAINTENANCE_FINALIZATION_MODES,
  MAINTENANCE_FINALIZATION_PRIORITY,
  maintenanceFinalizationDedupeKey,
  maintenanceFinalizationPayload,
} from './maintenanceFinalizationDomain';

function clean(value) {
  return String(value ?? '').trim();
}

function rowId(row = {}) {
  return clean(row.MantenimientoID || row.maintenanceId || row.id);
}

function markRow(row, maintenanceId, requestId) {
  if (!row || rowId(row) !== maintenanceId) return row;
  return {
    ...row,
    EstadoFinalizacion: 'PENDIENTE_SINCRONIZACION',
    PasoFinalizacion: 'ESPERANDO_SINCRONIZACION',
    FinalizacionSolicitudID: requestId,
    FinalizacionPendiente: true,
    UltimoErrorFinalizacion: '',
  };
}

function markCachedData(data, maintenanceId, requestId) {
  if (Array.isArray(data)) return data.map((row) => markRow(row, maintenanceId, requestId));
  if (!data || typeof data !== 'object') return data;

  if (data.mantenimiento) {
    return {
      ...data,
      mantenimiento: markRow(data.mantenimiento, maintenanceId, requestId),
      offlineQueued: true,
      finalizationPending: true,
    };
  }

  for (const key of ['items', 'rows', 'data']) {
    if (Array.isArray(data[key])) {
      return {
        ...data,
        [key]: data[key].map((row) => markRow(row, maintenanceId, requestId)),
      };
    }
  }

  return rowId(data) === maintenanceId
    ? markRow(data, maintenanceId, requestId)
    : data;
}

async function markCachedFinalization(maintenanceId, requestId) {
  await updateCachedResponses(
    (entry) => {
      const route = String(entry?.key || '').split('|')[1]?.toLowerCase() || '';
      return route.includes('maintenance.') || route.includes('mantenimientos.');
    },
    (data) => markCachedData(data, maintenanceId, requestId),
  ).catch(() => 0);
}

async function queueFinalization(
  maintenanceId,
  { retry = false, mode = MAINTENANCE_FINALIZATION_MODES.AUTO } = {},
) {
  const payload = maintenanceFinalizationPayload(maintenanceId, { retry, mode });
  const immediate = payload.finalizationMode === MAINTENANCE_FINALIZATION_MODES.NOW;
  const scheduled = payload.finalizationMode === MAINTENANCE_FINALIZATION_MODES.FIVE_PM;
  const operation = await enqueueOperation({
    routes: MODULE_ROUTES.maintenance.finalize,
    payload,
    entityId: maintenanceId,
    description: immediate
      ? 'Finalizar mantenimiento apenas termine la sincronización'
      : scheduled
        ? 'Programar mantenimiento para las 5:00 p. m. después de sincronizar'
        : 'Finalizar mantenimiento cuando termine la sincronización',
    dedupeKey: maintenanceFinalizationDedupeKey(maintenanceId),
    kind: 'maintenanceFinalize',
    dependsOnLocalIds: isOfflineLocalId(maintenanceId) ? [maintenanceId] : [],
    priority: MAINTENANCE_FINALIZATION_PRIORITY,
  });
  await markCachedFinalization(maintenanceId, payload.finalizationRequestId);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('dms-maintenance-finalization-queued', {
      detail: {
        maintenanceId,
        operationId: operation.id,
        retry,
        mode: payload.finalizationMode,
      },
    }));
    if (navigator.onLine !== false) {
      window.dispatchEvent(new CustomEvent('dms-offline-sync-request'));
    }
  }

  return {
    ok: true,
    offlineQueued: true,
    finalizationPending: true,
    maintenanceId,
    operationId: operation.id,
    status: operation.status,
    finalizationMode: payload.finalizationMode,
    message: immediate
      ? 'La finalización quedó guardada y comenzará inmediatamente después de sincronizar los cambios pendientes.'
      : scheduled
        ? 'La solicitud quedó guardada. Después de sincronizar, el servidor la programará para las 5:00 p. m. si esa hora todavía no ha llegado.'
        : 'La finalización quedó guardada y se enviará al servidor después de sincronizar todos los cambios.',
  };
}

export async function requestMaintenanceFinalization({
  maintenanceId,
  sessionToken = '',
  retry = false,
  mode = MAINTENANCE_FINALIZATION_MODES.AUTO,
} = {}) {
  const id = clean(maintenanceId);
  if (!id) throw new Error('No se indicó el mantenimiento que se debe finalizar.');

  const queueState = await getEntityQueueState(id).catch(() => ({ operations: [] }));
  const existingFinalize = (queueState.operations || []).find((operation) => operation.kind === 'maintenanceFinalize');
  const blockers = (queueState.operations || []).filter((operation) => operation.kind !== 'maintenanceFinalize');
  const browserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;

  if (browserOffline || blockers.length || existingFinalize) {
    return queueFinalization(id, { retry, mode });
  }

  const payload = maintenanceFinalizationPayload(id, { retry, mode });
  try {
    return await requestAvailable(MODULE_ROUTES.maintenance.finalize, payload, sessionToken);
  } catch (error) {
    if (!isNetworkError(error)) throw error;
    return queueFinalization(id, { retry, mode });
  }
}

export async function cancelScheduledMaintenanceFinalization({
  maintenanceId,
  sessionToken = '',
} = {}) {
  const id = clean(maintenanceId);
  if (!id) throw new Error('No se indicó el mantenimiento cuya finalización se debe cancelar.');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('Debe tener conexión para cancelar una finalización programada.');
  }
  const queueState = await getEntityQueueState(id).catch(() => ({ operations: [] }));
  const pendingFinalize = (queueState.operations || []).some((operation) => operation.kind === 'maintenanceFinalize');
  if (pendingFinalize) {
    throw new Error('La solicitud todavía está pendiente de sincronización. Espere a que se sincronice antes de cancelarla.');
  }
  return requestAvailable(
    MODULE_ROUTES.maintenance.finalize,
    maintenanceFinalizationPayload(id, { cancel: true }),
    sessionToken,
  );
}

export async function fetchMaintenanceFinalizationStatus(maintenanceId, sessionToken = '') {
  const id = clean(maintenanceId);
  if (!id) return null;
  return requestFirstAvailable(
    MODULE_ROUTES.maintenance.get,
    (route) => apiRequest(route, { maintenanceId: id }, sessionToken),
  );
}

export function pendingMaintenanceFinalizations(operations = []) {
  return normalizeItems(operations).filter((operation) => operation?.kind === 'maintenanceFinalize');
}
