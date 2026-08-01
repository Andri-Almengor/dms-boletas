const DB_NAME = 'dms-boletas-offline-media';
const DB_VERSION = 1;
const MEDIA_STORE = 'media';
const MAX_OFFLINE_MEDIA_BYTES = 25 * 1024 * 1024;
const STORAGE_SAFETY_BYTES = 5 * 1024 * 1024;

let databasePromise = null;

function supportsIndexedDb() {
  return typeof window !== 'undefined' && 'indexedDB' in window;
}

function ensureIndexes(store) {
  if (!store.indexNames.contains('entityId')) store.createIndex('entityId', 'entityId');
  if (!store.indexNames.contains('kind')) store.createIndex('kind', 'kind');
  if (!store.indexNames.contains('status')) store.createIndex('status', 'status');
  if (!store.indexNames.contains('createdAt')) store.createIndex('createdAt', 'createdAt');
}

function openDatabase() {
  if (!supportsIndexedDb()) return Promise.resolve(null);
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const transaction = request.transaction;
      if (!db.objectStoreNames.contains(MEDIA_STORE)) {
        const store = db.createObjectStore(MEDIA_STORE, { keyPath: 'mediaId' });
        ensureIndexes(store);
      } else if (transaction) {
        ensureIndexes(transaction.objectStore(MEDIA_STORE));
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('No fue posible abrir el almacenamiento de fotografías offline.'));
  });

  return databasePromise;
}

async function run(mode, operation) {
  const db = await openDatabase();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(MEDIA_STORE, mode);
    const store = transaction.objectStore(MEDIA_STORE);
    let request;
    try {
      request = operation(store);
    } catch (error) {
      reject(error);
      return;
    }
    transaction.oncomplete = () => resolve(request?.result ?? request ?? null);
    transaction.onerror = () => reject(transaction.error || new Error('No fue posible guardar la fotografía offline.'));
    transaction.onabort = () => reject(transaction.error || new Error('La operación de fotografía offline fue cancelada.'));
  });
}

async function getRecord(mediaId) {
  const id = String(mediaId || '').trim();
  if (!id) return null;
  const db = await openDatabase();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(MEDIA_STORE, 'readonly');
    const request = transaction.objectStore(MEDIA_STORE).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error('No fue posible leer la fotografía offline.'));
  });
}

export async function listOfflineMedia() {
  const db = await openDatabase();
  if (!db) return [];
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(MEDIA_STORE, 'readonly');
    const request = transaction.objectStore(MEDIA_STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error || new Error('No fue posible listar las fotografías offline.'));
  });
}

async function assertStorageCapacity(requiredBytes) {
  const bytes = Math.max(0, Number(requiredBytes || 0));
  if (bytes > MAX_OFFLINE_MEDIA_BYTES) {
    const error = new Error('La fotografía supera el límite offline de 25 MB. Reduzca su tamaño e inténtelo nuevamente.');
    error.code = 'OFFLINE_MEDIA_TOO_LARGE';
    throw error;
  }
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return;
  const estimate = await navigator.storage.estimate().catch(() => ({}));
  const quota = Number(estimate.quota || 0);
  const usage = Number(estimate.usage || 0);
  if (quota > 0 && quota - usage < bytes + STORAGE_SAFETY_BYTES) {
    const error = new Error('No hay suficiente espacio en el dispositivo para guardar esta fotografía sin conexión.');
    error.code = 'OFFLINE_STORAGE_FULL';
    error.details = { quota, usage, requiredBytes: bytes };
    throw error;
  }
}

export async function saveOfflineMedia(record = {}) {
  if (!supportsIndexedDb()) {
    const error = new Error('Este navegador no permite guardar fotografías sin conexión.');
    error.code = 'OFFLINE_MEDIA_UNSUPPORTED';
    throw error;
  }
  const mediaId = String(record.mediaId || '').trim();
  if (!mediaId) throw new Error('La fotografía offline necesita un identificador local.');
  if (!(record.blob instanceof Blob)) throw new TypeError('La fotografía offline debe guardarse como Blob.');

  const existing = await getRecord(mediaId).catch(() => null);
  const deltaBytes = Math.max(0, Number(record.blob.size || 0) - Number(existing?.size || existing?.blob?.size || 0));
  await assertStorageCapacity(deltaBytes);
  const now = Date.now();
  const next = {
    ...existing,
    ...record,
    mediaId,
    size: Number(record.blob.size || record.size || 0),
    mimeType: String(record.mimeType || record.blob.type || existing?.mimeType || 'application/octet-stream'),
    status: String(record.status || existing?.status || 'PENDING').toUpperCase(),
    createdAt: Number(existing?.createdAt || record.createdAt || now),
    updatedAt: now,
  };
  await run('readwrite', (store) => store.put(next));
  return next;
}

export function getOfflineMedia(mediaId) {
  return getRecord(mediaId);
}

export async function findOfflineMediaByEntityId(entityId) {
  const id = String(entityId || '').trim();
  if (!id) return null;
  const db = await openDatabase();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(MEDIA_STORE, 'readonly');
    const index = transaction.objectStore(MEDIA_STORE).index('entityId');
    const request = index.get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error('No fue posible localizar la fotografía offline.'));
  });
}

export async function updateOfflineMedia(mediaId, patch = {}) {
  const current = await getRecord(mediaId);
  if (!current) return null;
  return saveOfflineMedia({ ...current, ...patch, mediaId: current.mediaId, blob: patch.blob || current.blob });
}

export async function removeOfflineMedia(mediaId) {
  const id = String(mediaId || '').trim();
  if (!id) return;
  await run('readwrite', (store) => store.delete(id));
}

export async function requestPersistentOfflineStorage() {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  return navigator.storage.persist().catch(() => false);
}

export async function isPersistentOfflineStorage() {
  if (typeof navigator === 'undefined' || !navigator.storage?.persisted) return false;
  return navigator.storage.persisted().catch(() => false);
}

export async function getOfflineMediaStats() {
  const records = await listOfflineMedia();
  const pending = records.filter((record) => String(record.status || 'PENDING').toUpperCase() !== 'SYNCED');
  return {
    mediaSupported: supportsIndexedDb(),
    mediaCount: records.length,
    pendingMediaCount: pending.length,
    mediaBytes: records.reduce((total, record) => total + Number(record.size || record.blob?.size || 0), 0),
    pendingMediaBytes: pending.reduce((total, record) => total + Number(record.size || record.blob?.size || 0), 0),
    persistentStorage: await isPersistentOfflineStorage(),
  };
}
