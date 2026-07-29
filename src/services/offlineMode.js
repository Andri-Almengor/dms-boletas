const STORAGE_KEY = 'dms_offline_mode_enabled';
const CHANGE_EVENT = 'dms-offline-mode-change';
let initializationPromise = null;

function storageAvailable() {
  return typeof window !== 'undefined' && Boolean(window.localStorage);
}

export function hasOfflineModePreference() {
  if (!storageAvailable()) return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export function isOfflineModeEnabled() {
  if (!storageAvailable()) return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setOfflineModeEnabled(enabled) {
  const next = Boolean(enabled);
  if (storageAvailable()) {
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? 'true' : 'false');
    } catch {
      // El cambio seguirá activo durante esta sesión mediante el evento.
    }
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { enabled: next } }));
  }
  return next;
}

export function subscribeOfflineMode(listener) {
  if (typeof window === 'undefined') return () => {};
  const handleChange = (event) => listener(Boolean(event.detail?.enabled));
  window.addEventListener(CHANGE_EVENT, handleChange);
  return () => window.removeEventListener(CHANGE_EVENT, handleChange);
}

export function preserveExistingOfflineQueue() {
  if (initializationPromise) return initializationPromise;
  initializationPromise = (async () => {
    if (hasOfflineModePreference() || typeof window === 'undefined' || !('indexedDB' in window)) {
      return isOfflineModeEnabled();
    }

    try {
      if (typeof window.indexedDB.databases === 'function') {
        const databases = await window.indexedDB.databases();
        if (!databases.some((database) => database.name === 'dms-boletas-offline')) return false;
      }
      const { queuedOperationCount } = await import('./offlineStoreCore');
      const pending = await queuedOperationCount().catch(() => 0);
      if (pending > 0) return setOfflineModeEnabled(true);
    } catch {
      // En dispositivos sin soporte para inspección de IndexedDB se mantiene el valor por defecto.
    }
    return false;
  })();
  return initializationPromise;
}

export const OFFLINE_MODE_CHANGE_EVENT = CHANGE_EVENT;
