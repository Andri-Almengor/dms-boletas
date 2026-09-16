import {
  collectOfflineLocalReferences,
  isOfflineLocalId,
  replaceOfflineReferences,
} from './offlineCatalogDomain';

const DB_NAME = 'dms-boletas-offline';
const DB_VERSION = 3;
const CACHE_STORE = 'responses';
const QUEUE_STORE = 'operations';
const META_STORE = 'meta';
const ID_MAP_STORE = 'idMap';
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const OFFLINE_SECTIONS = Object.freeze([
  { id: 'clients', label: 'Clientes' },
  { id: 'locations', label: 'Ubicaciones' },
  { id: 'equipmentLocations', label: 'Ubicaciones de dispositivos' },
  { id: 'contacts', label: 'Supervisores y contactos' },
  { id: 'categories', label: 'Categorías' },
  { id: 'failures', label: 'Tipos de falla' },
  { id: 'devices', label: 'Tipos de dispositivo' },
  { id: 'manufacturers', label: 'Fabricantes' },
  { id: 'models', label: 'Modelos' },
  { id: 'relations', label: 'Relaciones de dispositivos' },
  { id: 'users', label: 'Técnicos y usuarios' },
]);

const OPERATION_PRIORITY = Object.freeze({
  clientLocationCreate: 12,
  manufacturerCreate: 12,
  deviceTypeCreate: 12,
  equipmentLocationCreate: 16,
  modelCreate: 17,
  deviceManufacturerCreate: 18,
  clientLocationUpdate: 21,
  manufacturerUpdate: 21,
  deviceTypeUpdate: 21,
  equipmentLocationUpdate: 22,
  modelUpdate: 22,
  deviceManufacturerUpdate: 23,
  ticketCreate: 10,
  maintenanceCreate: 10,
  ticketUpdate: 20,
  ticketAutosave: 20,
  maintenanceUpdate: 20,
  maintenanceDeviceCreate: 30,
  maintenanceDeviceUpdate: 31,
  maintenanceDeviceAutosave: 31,
  ticketSignature: 40,
  ticketEvidence: 41,
  ticketEvidenceUpdate: 42,
  ticketEvidenceDelete: 43,
  maintenanceImage: 41,
  maintenanceImageUpdate: 42,
  maintenanceImageDelete: 43,
  ticketPdf: 50,
  ticketTest: 50,
});

let databasePromise = null;

function supportsIndexedDb() {
  return typeof window !== 'undefined' && 'indexedDB' in window;
}

function ensureQueueIndexes(store) {
  if (!store.indexNames.contains('createdAt')) store.createIndex('createdAt', 'createdAt');
  if (!store.indexNames.contains('status')) store.createIndex('status', 'status');
  if (!store.indexNames.contains('entityId')) store.createIndex('entityId', 'entityId');
  if (!store.indexNames.contains('kind')) store.createIndex('kind', 'kind');
}

function openDatabase() {
  if (!supportsIndexedDb()) return Promise.resolve(null);
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const transaction = request.transaction;
      if (!db.objectStoreNames.contains(CACHE_STORE)) db.createObjectStore(CACHE_STORE, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        const store = db.createObjectStore(QUEUE_STORE, { keyPath: 'id' });
        ensureQueueIndexes(store);
      } else if (transaction) {
        ensureQueueIndexes(transaction.objectStore(QUEUE_STORE));
      }
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(ID_MAP_STORE)) {
        const mappingStore = db.createObjectStore(ID_MAP_STORE, { keyPath: 'localId' });
        mappingStore.createIndex('entityType', 'entityType');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('No fue posible abrir el almacenamiento sin conexión.'));
  });

  return databasePromise;
}

async function run(storeName, mode, operation) {
  const db = await openDatabase();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let result;
    try {
      result = operation(store);
    } catch (error) {
      reject(error);
      return;
    }
    transaction.oncomplete = () => resolve(result?.result ?? result ?? null);
    transaction.onerror = () => reject(transaction.error || new Error('No fue posible guardar la información sin conexión.'));
    transaction.onabort = () => reject(transaction.error || new Error('La operación local fue cancelada.'));
  });
}

async function readAll(storeName) {
  const db = await openDatabase();
  if (!db) return [];
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error || new Error('No fue posible leer el contenido sin conexión.'));
  });
}

async function readByIndex(storeName, indexName, key) {
  const db = await openDatabase();
  if (!db) return [];
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).index(indexName).getAll(key);
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error || new Error('No fue posible leer el contenido sin conexión.'));
  });
}

async function scanStore(storeName, visitor) {
  const db = await openDatabase();
  if (!db) return 0;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).openCursor();
    let count = 0;
    let failed = false;
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || failed) return;
      try {
        count += 1;
        visitor(cursor.value);
        cursor.continue();
      } catch (error) {
        failed = true;
        try { transaction.abort(); } catch { /* noop */ }
        reject(error);
      }
    };
    request.onerror = () => reject(request.error || new Error('No fue posible leer el contenido sin conexión.'));
    transaction.oncomplete = () => { if (!failed) resolve(count); };
    transaction.onerror = () => { if (!failed) reject(transaction.error || new Error('No fue posible leer el contenido sin conexión.')); };
    transaction.onabort = () => { if (!failed) reject(transaction.error || new Error('La lectura local fue cancelada.')); };
  });
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

function operationPriority(operation) {
  return Number(operation?.priority || OPERATION_PRIORITY[operation?.kind] || 35);
}

function compareQueuedOperations(a, b) {
  const byPriority = operationPriority(a) - operationPriority(b);
  if (byPriority) return byPriority;
  return Number(a.createdAt || 0) - Number(b.createdAt || 0);
}

function sortQueuedOperations(operations = []) {
  return operations.sort(compareQueuedOperations);
}

async function findQueuedOperationByDedupeKey(dedupeKey) {
  const key = String(dedupeKey || '');
  if (!key) return null;
  const db = await openDatabase();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(QUEUE_STORE, 'readonly');
    const request = transaction.objectStore(QUEUE_STORE).openCursor();
    let best = null;
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(best);
        return;
      }
      const candidate = cursor.value;
      if (candidate?.dedupeKey === key && (!best || compareQueuedOperations(candidate, best) < 0)) best = candidate;
      cursor.continue();
    };
    request.onerror = () => reject(request.error || new Error('No fue posible revisar la cola sin conexión.'));
  });
}

export function responseCacheKey(routes, payload = {}, sessionToken = '') {
  const route = Array.isArray(routes) ? routes[0] : routes;
  return `${sessionScope(sessionToken)}|${String(route || '')}|${JSON.stringify(stable(payload || {}))}`;
}

export async function cacheResponse(key, data) {
  if (!key) return;
  await run(CACHE_STORE, 'readwrite', (store) => store.put({ key, data, savedAt: Date.now() }));
}

export async function readCachedResponse(key, maxAgeMs = CACHE_MAX_AGE_MS) {
  if (!key) return null;
  const db = await openDatabase();
  if (!db) return null;
  const entry = await new Promise((resolve, reject) => {
    const transaction = db.transaction(CACHE_STORE, 'readonly');
    const request = transaction.objectStore(CACHE_STORE).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
  if (!entry) return null;
  if (maxAgeMs > 0 && Date.now() - Number(entry.savedAt || 0) > maxAgeMs) return null;
  return entry.data;
}

export async function updateCachedResponses(predicate, updater) {
  const db = await openDatabase();
  if (!db) return 0;
  let selectedCount = 0;
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(CACHE_STORE, 'readwrite');
    const store = transaction.objectStore(CACHE_STORE);
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const entry = cursor.value;
      let selected = false;
      try { selected = Boolean(predicate(entry)); } catch { selected = false; }
      if (selected) {
        selectedCount += 1;
        try {
          const nextData = updater(entry.data, entry);
          if (nextData !== undefined) cursor.update({ ...entry, data: nextData, savedAt: Date.now() });
        } catch {
          // Una entrada dañada no debe impedir actualizar las demás.
        }
      }
      cursor.continue();
    };
    request.onerror = () => reject(request.error || new Error('No fue posible actualizar la caché local.'));
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error('No fue posible actualizar la caché local.'));
    transaction.onabort = () => reject(transaction.error || new Error('La actualización local fue cancelada.'));
  });
  return selectedCount;
}

function emitQueueChange() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('dms-offline-queue-change'));
}

export function createOfflineId(prefix = 'local') {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}

export async function listQueuedOperations() {
  return sortQueuedOperations(await readAll(QUEUE_STORE));
}

export async function enqueueOperation({ routes, payload, description = '', entityId = '', dedupeKey = '', kind = '', dependsOnLocalIds = [], priority = 0 }) {
  const existing = dedupeKey ? await findQueuedOperationByDedupeKey(dedupeKey) : null;
  const operation = {
    id: existing?.id || createOfflineId('op'),
    routes: Array.isArray(routes) ? [...routes] : [routes],
    payload,
    description,
    entityId: String(entityId || payload?.boletaUid || payload?.BoletaUID || payload?.maintenanceId || payload?.MantenimientoID || ''),
    dedupeKey,
    kind: kind || existing?.kind || '',
    dependsOnLocalIds: [...new Set((dependsOnLocalIds || existing?.dependsOnLocalIds || []).map(String).filter(Boolean))],
    priority: Number(priority || existing?.priority || OPERATION_PRIORITY[kind] || 35),
    status: 'PENDING',
    attempts: existing?.attempts || 0,
    lastError: '',
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  await run(QUEUE_STORE, 'readwrite', (store) => store.put(operation));
  emitQueueChange();
  return operation;
}

export async function queuedOperationCount() {
  const db = await openDatabase();
  if (!db) return 0;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(QUEUE_STORE, 'readonly');
    const request = transaction.objectStore(QUEUE_STORE).count();
    request.onsuccess = () => resolve(Number(request.result || 0));
    request.onerror = () => reject(request.error);
  });
}

export async function getEntityQueueState(entityId) {
  const id = String(entityId || '');
  if (!id) return { entityId: '', pending: 0, errors: 0, syncing: 0, operations: [], readyToFinalize: true };
  const operations = sortQueuedOperations(await readByIndex(QUEUE_STORE, 'entityId', id));
  return {
    entityId: id,
    pending: operations.length,
    errors: operations.filter((item) => String(item.status).toUpperCase() === 'ERROR').length,
    syncing: operations.filter((item) => String(item.status).toUpperCase() === 'SYNCING').length,
    operations,
    readyToFinalize: operations.length === 0,
  };
}

export async function removeQueuedOperation(id) {
  await run(QUEUE_STORE, 'readwrite', (store) => store.delete(id));
  emitQueueChange();
}

export async function updateQueuedOperation(id, patch) {
  const db = await openDatabase();
  if (!db) return;
  let updated = false;
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(QUEUE_STORE, 'readwrite');
    const store = transaction.objectStore(QUEUE_STORE);
    const request = store.get(id);
    request.onsuccess = () => {
      const current = request.result || null;
      if (!current) return;
      updated = true;
      store.put({ ...current, ...patch, updatedAt: Date.now() });
    };
    request.onerror = () => reject(request.error || new Error('No fue posible actualizar la operación sin conexión.'));
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error('No fue posible actualizar la operación sin conexión.'));
    transaction.onabort = () => reject(transaction.error || new Error('La actualización local fue cancelada.'));
  });
  if (updated) emitQueueChange();
}

export async function listOfflineIdMappings() {
  return readAll(ID_MAP_STORE);
}

export async function saveOfflineIdMapping(localId, serverId, entityType = '') {
  const local = String(localId || '').trim();
  const server = String(serverId || '').trim();
  if (!local || !server) return null;
  const mapping = {
    localId: local,
    serverId: server,
    entityType: String(entityType || ''),
    savedAt: Date.now(),
  };
  await run(ID_MAP_STORE, 'readwrite', (store) => store.put(mapping));
  emitQueueChange();
  return mapping;
}

export async function resolveOfflineOperationPayload(payload = {}, requiredLocalIds = []) {
  const entries = await listOfflineIdMappings();
  const mappings = new Map(entries.map((entry) => [String(entry.localId), String(entry.serverId)]));
  const dependencies = [...new Set((requiredLocalIds || []).map(String).filter(Boolean))];
  const unresolved = dependencies.filter((localId) => isOfflineLocalId(localId) && !mappings.has(localId));
  return {
    payload: replaceOfflineReferences(payload, mappings),
    unresolved,
    mappings: Object.fromEntries(mappings),
  };
}

export async function setOfflineMeta(key, value) {
  await run(META_STORE, 'readwrite', (store) => store.put({ key, value, savedAt: Date.now() }));
}

export async function getOfflineMeta(key) {
  const db = await openDatabase();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(META_STORE, 'readonly');
    const request = transaction.objectStore(META_STORE).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

function cachedRecordCount(data) {
  if (Array.isArray(data)) return data.length;
  if (Array.isArray(data?.items)) return data.items.length;
  if (Array.isArray(data?.rows)) return data.rows.length;
  if (Array.isArray(data?.data)) return data.data.length;
  return data == null ? 0 : 1;
}

function routeFromCacheKey(key) {
  const parts = String(key || '').split('|');
  return String(parts[1] || '').toLowerCase();
}

function classifyOfflineRoute(route) {
  if (!route) return '';
  if (route.includes('equipmentlocations') || route.includes('ubicacionesequipo')) return 'equipmentLocations';
  if (route.includes('clientlocations') || route.includes('clients.locations') || route.includes('ubicacionescliente')) return 'locations';
  if (route.includes('contacts.list') || route.includes('clients.contacts') || route.includes('contactoscliente')) return 'contacts';
  if (route.includes('devicemanufacturers') || route.includes('tipodispositivofabricantes')) return 'relations';
  if (route.includes('failuretypes') || route.includes('tiposfalla')) return 'failures';
  if (route.includes('devicetypes') || route.includes('tiposdispositivo')) return 'devices';
  if (route.includes('manufacturers') || route.includes('fabricantes')) return 'manufacturers';
  if (route.includes('models.list') || route.includes('modelos.list')) return 'models';
  if (route.includes('catalog.categories') || route.includes('categories.list') || route.includes('categorias.list')) return 'categories';
  if (route.includes('users.assignment') || route === 'users.list') return 'users';
  if (route.includes('clients.list') || route.includes('clientes.list')) return 'clients';
  return '';
}

function approximateValueBytes(value, seen = new WeakSet()) {
  if (value == null) return 4;
  const type = typeof value;
  if (type === 'string') return value.length * 2;
  if (type === 'number' || type === 'bigint') return 8;
  if (type === 'boolean') return 4;
  if (type === 'undefined' || type === 'function' || type === 'symbol') return 0;
  if (typeof Blob !== 'undefined' && value instanceof Blob) return Number(value.size || 0);
  if (typeof ArrayBuffer !== 'undefined') {
    if (value instanceof ArrayBuffer) return Number(value.byteLength || 0);
    if (ArrayBuffer.isView?.(value)) return Number(value.byteLength || 0);
  }
  if (value instanceof Date) return 8;
  if (!value || type !== 'object') return 0;
  if (seen.has(value)) return 0;
  seen.add(value);

  if (Array.isArray(value)) {
    return 8 + value.reduce((total, item) => total + approximateValueBytes(item, seen), 0);
  }
  if (value instanceof Map) {
    let total = 8;
    value.forEach((itemValue, itemKey) => {
      total += approximateValueBytes(itemKey, seen) + approximateValueBytes(itemValue, seen);
    });
    return total;
  }
  if (value instanceof Set) {
    let total = 8;
    value.forEach((item) => { total += approximateValueBytes(item, seen); });
    return total;
  }

  let total = 8;
  for (const [key, item] of Object.entries(value)) {
    total += key.length * 2;
    total += approximateValueBytes(item, seen);
  }
  return total;
}

export async function getOfflineStorageStats() {
  const sectionMap = new Map(OFFLINE_SECTIONS.map((section) => [section.id, {
    ...section,
    records: 0,
    savedAt: 0,
    available: false,
    stale: false,
    cacheEntries: 0,
  }]));

  let lastDownloadAt = 0;
  let cacheEntries = 0;
  let approximateIndexedDbBytes = 0;
  let idMappingCount = 0;
  const mappedIds = new Set();
  const pendingOperations = [];
  let errorCount = 0;

  await Promise.all([
    scanStore(CACHE_STORE, (entry) => {
      cacheEntries += 1;
      approximateIndexedDbBytes += approximateValueBytes(entry);
      const sectionId = classifyOfflineRoute(routeFromCacheKey(entry.key));
      const savedAt = Number(entry.savedAt || 0);
      lastDownloadAt = Math.max(lastDownloadAt, savedAt);
      if (!sectionId || !sectionMap.has(sectionId)) return;
      const current = sectionMap.get(sectionId);
      current.records = Math.max(current.records, cachedRecordCount(entry.data));
      current.savedAt = Math.max(current.savedAt, savedAt);
      current.available = true;
      current.cacheEntries += 1;
    }),
    scanStore(QUEUE_STORE, (item) => {
      approximateIndexedDbBytes += approximateValueBytes(item);
      const status = String(item.status || 'PENDING').toUpperCase();
      if (status === 'SYNCED') return;
      if (status === 'ERROR') errorCount += 1;
      pendingOperations.push({
        id: item.id,
        entityId: item.entityId || '',
        kind: item.kind || '',
        description: item.description || 'Cambio pendiente',
        status,
        createdAt: Number(item.createdAt || 0),
        attempts: Number(item.attempts || 0),
        lastError: item.lastError || '',
        dependsOnLocalIds: item.dependsOnLocalIds || [],
      });
    }),
    scanStore(META_STORE, (entry) => {
      approximateIndexedDbBytes += approximateValueBytes(entry);
    }),
    scanStore(ID_MAP_STORE, (entry) => {
      approximateIndexedDbBytes += approximateValueBytes(entry);
      idMappingCount += 1;
      mappedIds.add(String(entry.localId || ''));
    }),
  ]);

  const now = Date.now();
  const sections = OFFLINE_SECTIONS.map(({ id }) => {
    const section = sectionMap.get(id);
    section.stale = section.available && now - section.savedAt > CACHE_MAX_AGE_MS;
    return section;
  });
  const readySections = sections.filter((section) => section.available && !section.stale).length;
  const downloadedSections = sections.filter((section) => section.available).length;
  const totalRecords = sections.reduce((sum, section) => sum + Number(section.records || 0), 0);

  const blockedIds = new Set();
  pendingOperations.forEach((item) => {
    if ((item.dependsOnLocalIds || []).some((localId) => isOfflineLocalId(localId) && !mappedIds.has(String(localId)))) {
      blockedIds.add(item.id);
    }
  });

  let usage = 0;
  let quota = 0;
  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    const estimate = await navigator.storage.estimate().catch(() => ({}));
    usage = Number(estimate.usage || 0);
    quota = Number(estimate.quota || 0);
  }

  let shellCaches = 0;
  if (typeof caches !== 'undefined') {
    shellCaches = (await caches.keys().catch(() => [])).length;
  }

  return {
    supported: supportsIndexedDb(),
    online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
    percent: Math.round((readySections / OFFLINE_SECTIONS.length) * 100),
    downloadedSections,
    readySections,
    totalSections: OFFLINE_SECTIONS.length,
    staleSections: sections.filter((section) => section.stale).length,
    totalRecords,
    cacheEntries,
    sections,
    lastDownloadAt,
    pendingCount: pendingOperations.length,
    blockedCount: blockedIds.size,
    idMappingCount,
    errorCount,
    pendingOperations: pendingOperations.map((item) => ({
      ...item,
      blocked: blockedIds.has(item.id),
    })),
    usage,
    quota,
    approximateIndexedDbBytes,
    shellCaches,
  };
}

// The cursor and the response patches form one durable unit. Compare inside the
// readwrite transaction so tabs and out-of-order requests cannot race the check.
export async function commitSyncCacheUpdate({
  stateKey, expectedState, nextState, cachePrefix, predicate = () => false,
  updater, snapshotKey, snapshotData, replaceResource = false,
}) {
  const db = await openDatabase();
  if (!db) return { committed: false, state: null, writes: 0 };
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CACHE_STORE, META_STORE], 'readwrite');
    const responses = transaction.objectStore(CACHE_STORE);
    const meta = transaction.objectStore(META_STORE);
    let result = { committed: false, state: null, writes: 0, reconcileRequired: false };
    let failure;
    const request = meta.get(stateKey);
    request.onsuccess = () => {
      const current = request.result?.value || null;
      result.state = current;
      const matches = !current && !expectedState || current && expectedState
        && current.generation === expectedState.generation
        && current.cacheScope === expectedState.cacheScope
        && Number(current.cursor) === Number(expectedState.cursor)
        && Number(current.revision || 0) === Number(expectedState.revision || 0);
      if (!matches) return;
      if (current?.generation === nextState.generation && Number(nextState.cursor) < Number(current.cursor)) return;
      const savedAt = Date.now();
      const state = { ...nextState, revision: Number(current?.revision || 0) + 1, savedAt };
      const finish = () => {
        if (snapshotKey) {
          responses.put({ key: snapshotKey, data: snapshotData, savedAt });
          result.writes += 1;
        }
        meta.put({ key: stateKey, value: state, savedAt });
        result = { ...result, committed: true, state };
      };
      if (!cachePrefix || (!updater && !replaceResource)) { finish(); return; }
      // Responses are keyed scope|route|payload; inspect only this user's scope,
      // one row at a time, without materializing every cached response in RAM.
      const range = IDBKeyRange.bound(cachePrefix, `${cachePrefix}\uffff`);
      const scan = responses.openCursor(range);
      scan.onsuccess = () => {
        const cursor = scan.result;
        if (!cursor) { finish(); return; }
        try {
          const entry = cursor.value;
          if (predicate(entry)) {
            if (replaceResource) cursor.delete();
            else {
              const data = updater(entry.data, entry);
              if (data?.syncIntegrityPending) result.reconcileRequired = true;
              if (data !== undefined && data !== entry.data) cursor.update({ ...entry, data, savedAt });
            }
            result.writes += 1;
          }
          cursor.continue();
        } catch (error) {
          failure = error;
          transaction.abort();
        }
      };
    };
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(failure || transaction.error || new Error('No fue posible aplicar el delta.'));
    transaction.onabort = () => reject(failure || transaction.error || new Error('El delta local fue cancelado.'));
  });
}
