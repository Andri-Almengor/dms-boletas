import { createLocalId } from '../utils/localId';
import {
  base64ToBlob,
  createOfflineMediaRecord,
  hydrateMediaPayload,
  isBlobBackedOfflineKind,
  isInlineBase64,
  isOfflineMediaReference,
  offlineMediaEntityId,
  offlineMediaId,
  offlineMediaIdFromReference,
  offlineMediaReference,
  optimizeOfflineImageBlob,
  stripInlineMediaPayload,
} from './offlineMediaDomain';
import {
  findOfflineMediaByEntityId,
  getOfflineMedia,
  getOfflineMediaStats,
  listOfflineMedia,
  removeOfflineMedia,
  requestPersistentOfflineStorage,
  saveOfflineMedia,
  updateOfflineMedia,
} from './offlineMediaStore';
import { isOfflineModeEnabled } from './offlineMode';

let corePromise = null;
const objectUrlCache = new Map();

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

function cachedMediaKind(record = {}) {
  if (record.FotoDispositivoID || record.DispositivoMantenimientoRef) return 'maintenanceImage';
  if (record.EvidenciaID || record.BoletaUID && record.ArchivoURL) return 'ticketEvidence';
  if (record.BoletaUID && record.FirmaURL) return 'ticketSignature';
  return '';
}

function cachedMediaEntityId(kind, record = {}) {
  if (kind === 'maintenanceImage') return String(record.FotoDispositivoID || record.imageId || record.id || '');
  if (kind === 'ticketEvidence') return String(record.EvidenciaID || record.evidenciaId || record.id || '');
  if (kind === 'ticketSignature') return String(record.BoletaUID || record.boletaUid || record.id || '');
  return '';
}

function cachedMediaFields(kind) {
  if (kind === 'maintenanceImage') return ['DriveURL', 'PreviewURL'];
  if (kind === 'ticketEvidence') return ['ArchivoURL'];
  if (kind === 'ticketSignature') return ['FirmaURL'];
  return [];
}

function revokeMediaObjectUrl(mediaId) {
  const id = String(mediaId || '');
  const url = objectUrlCache.get(id);
  if (url && globalThis.URL?.revokeObjectURL) globalThis.URL.revokeObjectURL(url);
  objectUrlCache.delete(id);
}

async function mediaObjectUrl(mediaId) {
  const id = String(mediaId || '');
  if (!id) return '';
  if (objectUrlCache.has(id)) return objectUrlCache.get(id);
  const record = await getOfflineMedia(id);
  if (!record?.blob) return '';
  if (globalThis.URL?.createObjectURL) {
    const url = globalThis.URL.createObjectURL(record.blob);
    objectUrlCache.set(id, url);
    return url;
  }
  const hydrated = await hydrateMediaPayload({}, record);
  return `data:${record.mimeType || record.blob.type || 'application/octet-stream'};base64,${hydrated.base64}`;
}

async function dehydrateCachedMedia(value) {
  if (Array.isArray(value)) return Promise.all(value.map(dehydrateCachedMedia));
  if (!value || typeof value !== 'object' || value instanceof Blob || value instanceof Date) return value;

  const next = {};
  for (const [key, child] of Object.entries(value)) next[key] = await dehydrateCachedMedia(child);

  const kind = cachedMediaKind(next);
  const entityId = cachedMediaEntityId(kind, next);
  const fields = cachedMediaFields(kind);
  if (!kind || !entityId || !fields.length) return next;

  let media = offlineMediaId(next) ? await getOfflineMedia(offlineMediaId(next)).catch(() => null) : null;
  if (!media) media = await findOfflineMediaByEntityId(entityId).catch(() => null);

  for (const field of fields) {
    const source = next[field];
    if (!isInlineBase64(source)) continue;
    if (!media) {
      const mediaId = createLocalId('media');
      const sourceBlob = base64ToBlob(source, next.MimeType || next.mimeType || 'application/octet-stream');
      const blob = await optimizeOfflineImageBlob(sourceBlob);
      media = await saveOfflineMedia(createOfflineMediaRecord(kind, {
        ...next,
        imageId: next.FotoDispositivoID,
        evidenciaId: next.EvidenciaID,
        boletaUid: next.BoletaUID,
        fileName: next.NombreArchivo || next.Nombre,
        mimeType: next.MimeType,
      }, blob, mediaId));
    }
    next[field] = offlineMediaReference(media.mediaId);
    next.OfflineMediaID = media.mediaId;
    next.offlineMediaId = media.mediaId;
  }
  return next;
}

async function hydrateCachedMedia(value) {
  if (typeof value === 'string' && isOfflineMediaReference(value)) {
    return mediaObjectUrl(offlineMediaIdFromReference(value));
  }
  if (Array.isArray(value)) return Promise.all(value.map(hydrateCachedMedia));
  if (!value || typeof value !== 'object' || value instanceof Blob || value instanceof Date) return value;
  const next = {};
  for (const [key, child] of Object.entries(value)) next[key] = await hydrateCachedMedia(child);
  return next;
}

async function persistOperationMedia(core, operation = {}) {
  const kind = String(operation.kind || '');
  const payload = operation.payload || {};
  if (!isBlobBackedOfflineKind(kind) || !payload.base64) return operation;

  const existingOperation = operation.dedupeKey
    ? (await core.listQueuedOperations()).find((item) => item.dedupeKey === operation.dedupeKey)
    : null;
  const mediaId = offlineMediaId(payload)
    || offlineMediaId(existingOperation?.payload)
    || createLocalId('media');
  const sourceBlob = base64ToBlob(payload.base64, payload.mimeType || payload.MimeType || 'application/octet-stream');
  const blob = await optimizeOfflineImageBlob(sourceBlob);
  const record = createOfflineMediaRecord(kind, payload, blob, mediaId);
  revokeMediaObjectUrl(mediaId);
  await saveOfflineMedia(record);
  requestPersistentOfflineStorage().catch(() => false);

  return {
    ...operation,
    payload: stripInlineMediaPayload(payload, mediaId),
  };
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
  return core.cacheResponse(key, await dehydrateCachedMedia(data));
}

export async function readCachedResponse(key, maxAgeMs) {
  if (!isOfflineModeEnabled()) return null;
  const core = await loadCore();
  const cached = await core.readCachedResponse(key, maxAgeMs);
  return cached === null ? null : hydrateCachedMedia(cached);
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
  return core.enqueueOperation(await persistOperationMedia(core, operation));
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
  const operation = (await core.listQueuedOperations()).find((item) => item.id === id);
  await core.removeQueuedOperation(id);
  const mediaId = offlineMediaId(operation?.payload);
  if (mediaId) {
    await removeOfflineMedia(mediaId).catch(() => {});
    revokeMediaObjectUrl(mediaId);
  }
  return null;
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
  const resolved = await core.resolveOfflineOperationPayload(payload, requiredLocalIds);
  const mediaId = offlineMediaId(resolved.payload);
  if (!mediaId) return resolved;
  const media = await getOfflineMedia(mediaId);
  if (!media?.blob) {
    const error = new Error('La fotografía guardada en este dispositivo ya no está disponible. Debe volver a seleccionarla antes de sincronizar.');
    error.code = 'OFFLINE_MEDIA_MISSING';
    error.details = { mediaId, entityId: offlineMediaEntityId('', resolved.payload) };
    throw error;
  }
  return {
    ...resolved,
    payload: await hydrateMediaPayload(resolved.payload, media),
  };
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
  const [stats, mediaStats] = await Promise.all([
    core.getOfflineStorageStats(),
    getOfflineMediaStats(),
  ]);
  return {
    ...stats,
    ...mediaStats,
    approximateIndexedDbBytes: Number(stats.approximateIndexedDbBytes || 0) + Number(mediaStats.mediaBytes || 0),
  };
}

export {
  getOfflineMedia,
  listOfflineMedia,
  removeOfflineMedia,
  requestPersistentOfflineStorage,
  saveOfflineMedia,
  updateOfflineMedia,
};
