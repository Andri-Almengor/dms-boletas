import { createLocalId } from '../utils/localId';
import { isOfflineModeEnabled } from './offlineMode';

let corePromise = null;

function loadCore() {
  if (!corePromise) corePromise = import('./offlineStoreCore');
  return corePromise;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stable(value[key]);
      return result;
    }, {});
  }
  return value;
}

function sessionScope(sessionToken = '') {
  const text = String(sessionToken || 'public');
  return text.length > 18 ? text.slice(-18) : text;
}

function disabledError() {
  const error = new Error('El modo sin conexión está desactivado en este dispositivo. Conéctese a internet o actívelo desde Más opciones.');
  error.code = 'OFFLINE_MODE_DISABLED';
  error.status = 0;
  return error;
}

export function responseCacheKey(routes, payload = {}, sessionToken = '') {
  const route = Array.isArray(routes) ? routes[0] : routes;
  return `${sessionScope(sessionToken)}|${String(route || '')}|${JSON.stringify(stable(payload || {}))}`;
}

export function createOfflineId(prefix = 'local') {
  return createLocalId(prefix);
}

export async function cacheResponse(key, data) {
  if (!isOfflineModeEnabled()) return null;
  const core = await loadCore();
  return core.cacheResponse(key, data);
}

export async function readCachedResponse(key, maxAgeMs) {
  if (!isOfflineModeEnabled()) return null;
  const core = await loadCore();
  return core.readCachedResponse(key, maxAgeMs);
}

export async function updateCachedResponses(predicate, updater) {
  if (!isOfflineModeEnabled()) return 0;
  const core = await loadCore();
  return core.updateCachedResponses(predicate, updater);
}

export async function listQueuedOperations() {
  if (!isOfflineModeEnabled()) return [];
  const core = await loadCore();
  return core.listQueuedOperations();
}

export async function enqueueOperation(operation) {
  if (!isOfflineModeEnabled()) throw disabledError();
  const core = await loadCore();
  return core.enqueueOperation(operation);
}

export async function queuedOperationCount() {
  const core = await loadCore();
  return core.queuedOperationCount();
}

export async function getEntityQueueState(entityId) {
  if (!isOfflineModeEnabled()) {
    return {
      entityId: String(entityId || ''),
      pending: 0,
      errors: 0,
      syncing: 0,
      operations: [],
      readyToFinalize: true,
    };
  }
  const core = await loadCore();
  return core.getEntityQueueState(entityId);
}

export async function removeQueuedOperation(id) {
  if (!isOfflineModeEnabled()) return null;
  const core = await loadCore();
  return core.removeQueuedOperation(id);
}

export async function updateQueuedOperation(id, patch) {
  if (!isOfflineModeEnabled()) return null;
  const core = await loadCore();
  return core.updateQueuedOperation(id, patch);
}

export async function listOfflineIdMappings() {
  const core = await loadCore();
  return core.listOfflineIdMappings();
}

export async function saveOfflineIdMapping(localId, serverId, entityType = '') {
  if (!isOfflineModeEnabled()) return null;
  const core = await loadCore();
  return core.saveOfflineIdMapping(localId, serverId, entityType);
}

export async function resolveOfflineOperationPayload(payload = {}, requiredLocalIds = []) {
  const core = await loadCore();
  return core.resolveOfflineOperationPayload(payload, requiredLocalIds);
}

export async function setOfflineMeta(key, value) {
  if (!isOfflineModeEnabled()) return null;
  const core = await loadCore();
  return core.setOfflineMeta(key, value);
}

export async function getOfflineMeta(key) {
  if (!isOfflineModeEnabled()) return null;
  const core = await loadCore();
  return core.getOfflineMeta(key);
}

export async function getOfflineStorageStats() {
  const core = await loadCore();
  return core.getOfflineStorageStats();
}
