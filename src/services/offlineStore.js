const DB_NAME = 'dms-boletas-offline';
const DB_VERSION = 1;
const CACHE_STORE = 'responses';
const QUEUE_STORE = 'operations';
const META_STORE = 'meta';
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

export async function listQueuedOperations() {
  return (await readAll(QUEUE_STORE)).sort((a, b) => Number(a.createdAt) - Number(b.createdAt));
}

export async function enqueueOperation({ routes, payload, description = '', entityId = '', dedupeKey = '' }) {
  const existing = dedupeKey
    ? (await listQueuedOperations()).find((item) => item.dedupeKey === dedupeKey)
    : null;
  const operation = {
    id: existing?.id || createOfflineId('op'),
    routes: Array.isArray(routes) ? [...routes] : [routes],
    payload,
    description,
    entityId: String(entityId || payload?.boletaUid || payload?.BoletaUID || ''),
    dedupeKey,
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

function approximateBytes(value) {
  try {
    return new Blob([JSON.stringify(value)]).size;
  } catch {
    return 0;
  }
}

export async function getOfflineStorageStats() {
  const [responses, operations, metadata] = await Promise.all([
    readAll(CACHE_STORE),
    readAll(QUEUE_STORE),
    readAll(META_STORE),
  ]);

  const sectionMap = new Map(OFFLINE_SECTIONS.map((section) => [section.id, {
    ...section,
    records: 0,
    savedAt: 0,
    available: false,
    stale: false,
    cacheEntries: 0,
  }]));

  let lastDownloadAt = 0;
  responses.forEach((entry) => {
    const sectionId = classifyOfflineRoute(routeFromCacheKey(entry.key));
    const savedAt = Number(entry.savedAt || 0);
    lastDownloadAt = Math.max(lastDownloadAt, savedAt);
    if (!sectionId || !sectionMap.has(sectionId)) return;
    const current = sectionMap.get(sectionId);
    current.records = Math.max(current.records, cachedRecordCount(entry.data));
    current.savedAt = Math.max(current.savedAt, savedAt);
    current.available = true;
    current.cacheEntries += 1;
  });

  const now = Date.now();
  const sections = OFFLINE_SECTIONS.map(({ id }) => {
    const section = sectionMap.get(id);
    section.stale = section.available && now - section.savedAt > CACHE_MAX_AGE_MS;
    return section;
  });
  const readySections = sections.filter((section) => section.available && !section.stale).length;
  const downloadedSections = sections.filter((section) => section.available).length;
  const totalRecords = sections.reduce((sum, section) => sum + Number(section.records || 0), 0);

  let usage = 0;
  let quota = 0;
  if (navigator.storage?.estimate) {
    const estimate = await navigator.storage.estimate().catch(() => ({}));
    usage = Number(estimate.usage || 0);
    quota = Number(estimate.quota || 0);
  }

  let shellCaches = 0;
  if (typeof caches !== 'undefined') {
    shellCaches = (await caches.keys().catch(() => [])).length;
  }

  const approximateIndexedDbBytes = approximateBytes(responses)
    + approximateBytes(operations)
    + approximateBytes(metadata);
  const pendingOperations = operations.filter((item) => String(item.status || 'PENDING').toUpperCase() !== 'SYNCED');

  return {
    supported: supportsIndexedDb(),
    online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
    percent: Math.round((readySections / OFFLINE_SECTIONS.length) * 100),
    downloadedSections,
    readySections,
    totalSections: OFFLINE_SECTIONS.length,
    staleSections: sections.filter((section) => section.stale).length,
    totalRecords,
    cacheEntries: responses.length,
    sections,
    lastDownloadAt,
    pendingCount: pendingOperations.length,
    errorCount: pendingOperations.filter((item) => String(item.status).toUpperCase() === 'ERROR').length,
    pendingOperations: pendingOperations.map((item) => ({
      id: item.id,
      description: item.description || 'Cambio pendiente',
      status: String(item.status || 'PENDING').toUpperCase(),
      createdAt: Number(item.createdAt || 0),
      attempts: Number(item.attempts || 0),
      lastError: item.lastError || '',
    })),
    usage,
    quota,
    approximateIndexedDbBytes,
    shellCaches,
  };
}
