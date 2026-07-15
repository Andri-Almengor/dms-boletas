const DB_NAME = 'dms-boletas-offline';
const DB_VERSION = 1;
const CACHE_STORE = 'responses';
const QUEUE_STORE = 'operations';
const META_STORE = 'meta';
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

let databasePromise = null;

function supportsIndexedDb() {
  return typeof window !== 'undefined' && 'indexedDB' in window;
}

function openDatabase() {
  if (!supportsIndexedDb()) return Promise.resolve(null);
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CACHE_STORE)) db.createObjectStore(CACHE_STORE, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        const store = db.createObjectStore(QUEUE_STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
        store.createIndex('status', 'status');
      }
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'key' });
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

function emitQueueChange() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('dms-offline-queue-change'));
}

export function createOfflineId(prefix = 'local') {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}

export async function enqueueOperation({ routes, payload, description = '', entityId = '' }) {
  const operation = {
    id: createOfflineId('op'),
    routes: Array.isArray(routes) ? [...routes] : [routes],
    payload,
    description,
    entityId: String(entityId || payload?.boletaUid || payload?.BoletaUID || ''),
    status: 'PENDING',
    attempts: 0,
    lastError: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await run(QUEUE_STORE, 'readwrite', (store) => store.put(operation));
  emitQueueChange();
  return operation;
}

export async function listQueuedOperations() {
  const db = await openDatabase();
  if (!db) return [];
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(QUEUE_STORE, 'readonly');
    const request = transaction.objectStore(QUEUE_STORE).getAll();
    request.onsuccess = () => resolve((request.result || []).sort((a, b) => Number(a.createdAt) - Number(b.createdAt)));
    request.onerror = () => reject(request.error);
  });
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

export async function removeQueuedOperation(id) {
  await run(QUEUE_STORE, 'readwrite', (store) => store.delete(id));
  emitQueueChange();
}

export async function updateQueuedOperation(id, patch) {
  const db = await openDatabase();
  if (!db) return;
  const current = await new Promise((resolve, reject) => {
    const transaction = db.transaction(QUEUE_STORE, 'readonly');
    const request = transaction.objectStore(QUEUE_STORE).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
  if (!current) return;
  await run(QUEUE_STORE, 'readwrite', (store) => store.put({ ...current, ...patch, updatedAt: Date.now() }));
  emitQueueChange();
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
