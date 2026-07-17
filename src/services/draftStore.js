const DB_NAME = 'dms-boletas-form-drafts';
const DB_VERSION = 1;
const DRAFT_STORE = 'drafts';
const MAX_DRAFT_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_DRAFTS = 60;

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
      if (!db.objectStoreNames.contains(DRAFT_STORE)) {
        const store = db.createObjectStore(DRAFT_STORE, { keyPath: 'key' });
        store.createIndex('updatedAt', 'updatedAt');
        store.createIndex('route', 'route');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('No fue posible abrir el almacenamiento de borradores.'));
    request.onblocked = () => reject(new Error('El almacenamiento de borradores está bloqueado por otra pestaña.'));
  });

  return databasePromise;
}

async function transaction(mode, operation) {
  const db = await openDatabase();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFT_STORE, mode);
    const store = tx.objectStore(DRAFT_STORE);
    let request;
    try {
      request = operation(store);
    } catch (error) {
      reject(error);
      return;
    }
    tx.oncomplete = () => resolve(request?.result ?? request ?? null);
    tx.onerror = () => reject(tx.error || new Error('No fue posible completar la operación del borrador.'));
    tx.onabort = () => reject(tx.error || new Error('La operación del borrador fue cancelada.'));
  });
}

async function getAllDrafts() {
  const db = await openDatabase();
  if (!db) return [];
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFT_STORE, 'readonly');
    const request = tx.objectStore(DRAFT_STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error || new Error('No fue posible leer los borradores.'));
  });
}

function backupKey(key) {
  return `dms_form_draft_backup:${key}`;
}

function scalarBackup(entry) {
  const fields = {};
  Object.entries(entry?.data?.fields || {}).forEach(([key, value]) => {
    if (!value || value.type === 'file') return;
    fields[key] = value;
  });
  return {
    key: entry.key,
    route: entry.route,
    updatedAt: entry.updatedAt,
    data: {
      fields,
      choices: entry?.data?.choices || {},
      step: entry?.data?.step || 0,
      signature: entry?.data?.signature || '',
    },
  };
}

function writeBackup(entry) {
  try {
    localStorage.setItem(backupKey(entry.key), JSON.stringify(scalarBackup(entry)));
  } catch {
    // IndexedDB continúa siendo la fuente principal.
  }
}

function readBackup(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(backupKey(key)) || 'null');
    if (!parsed?.updatedAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted?.()) return true;
    return Boolean(await navigator.storage.persist());
  } catch {
    return false;
  }
}

export async function saveDraft(entry) {
  if (!entry?.key) throw new Error('El borrador no tiene una clave válida.');
  const next = {
    version: 1,
    createdAt: Number(entry.createdAt || Date.now()),
    ...entry,
    updatedAt: Date.now(),
  };
  await transaction('readwrite', (store) => store.put(next));
  writeBackup(next);
  return next;
}

export async function loadDraft(key) {
  if (!key) return null;
  const db = await openDatabase();
  let entry = null;
  if (db) {
    entry = await new Promise((resolve, reject) => {
      const tx = db.transaction(DRAFT_STORE, 'readonly');
      const request = tx.objectStore(DRAFT_STORE).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('No fue posible leer el borrador.'));
    });
  }
  if (!entry) entry = readBackup(key);
  if (!entry) return null;
  if (Date.now() - Number(entry.updatedAt || 0) > MAX_DRAFT_AGE_MS) {
    await deleteDraft(key).catch(() => {});
    return null;
  }
  return entry;
}

export async function deleteDraft(key) {
  if (!key) return;
  await transaction('readwrite', (store) => store.delete(key)).catch(() => {});
  try { localStorage.removeItem(backupKey(key)); } catch { /* Sin efecto. */ }
}

export async function pruneDrafts() {
  const entries = await getAllDrafts();
  const now = Date.now();
  const expired = entries.filter((entry) => now - Number(entry.updatedAt || 0) > MAX_DRAFT_AGE_MS);
  const remaining = entries
    .filter((entry) => !expired.includes(entry))
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  const excess = remaining.slice(MAX_DRAFTS);
  await Promise.all([...expired, ...excess].map((entry) => deleteDraft(entry.key)));
  return expired.length + excess.length;
}

export async function draftStorageStats() {
  const entries = await getAllDrafts();
  let usage = 0;
  let quota = 0;
  if (navigator.storage?.estimate) {
    const estimate = await navigator.storage.estimate().catch(() => ({}));
    usage = Number(estimate.usage || 0);
    quota = Number(estimate.quota || 0);
  }
  return {
    drafts: entries.length,
    latestAt: entries.reduce((latest, entry) => Math.max(latest, Number(entry.updatedAt || 0)), 0),
    usage,
    quota,
  };
}
