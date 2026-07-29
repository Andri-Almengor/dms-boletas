import * as core from './offlineStoreCore';
import { isOfflineModeEnabled } from './offlineMode';

export * from './offlineStoreCore';

function disabledError() {
  const error = new Error('El modo sin conexión está desactivado en este dispositivo. Conéctese a internet o actívelo desde Más opciones.');
  error.code = 'OFFLINE_MODE_DISABLED';
  error.status = 0;
  return error;
}

export async function cacheResponse(key, data) {
  if (!isOfflineModeEnabled()) return null;
  return core.cacheResponse(key, data);
}

export async function readCachedResponse(key, maxAgeMs) {
  if (!isOfflineModeEnabled()) return null;
  return core.readCachedResponse(key, maxAgeMs);
}

export async function updateCachedResponses(predicate, updater) {
  if (!isOfflineModeEnabled()) return 0;
  return core.updateCachedResponses(predicate, updater);
}

export async function listQueuedOperations() {
  if (!isOfflineModeEnabled()) return [];
  return core.listQueuedOperations();
}

export async function enqueueOperation(operation) {
  if (!isOfflineModeEnabled()) throw disabledError();
  return core.enqueueOperation(operation);
}

export async function queuedOperationCount() {
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
  return core.getEntityQueueState(entityId);
}

export async function removeQueuedOperation(id) {
  if (!isOfflineModeEnabled()) return null;
  return core.removeQueuedOperation(id);
}

export async function updateQueuedOperation(id, patch) {
  if (!isOfflineModeEnabled()) return null;
  return core.updateQueuedOperation(id, patch);
}

export async function setOfflineMeta(key, value) {
  if (!isOfflineModeEnabled()) return null;
  return core.setOfflineMeta(key, value);
}

export async function getOfflineMeta(key) {
  if (!isOfflineModeEnabled()) return null;
  return core.getOfflineMeta(key);
}

export async function getOfflineStorageStats() {
  return core.getOfflineStorageStats();
}
