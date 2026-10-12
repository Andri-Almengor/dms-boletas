// Shared by chunk failures and service-worker updates. One reload per tab,
// including when a reload fails again. Storage unavailable => manual recovery.
const KEY = 'dms_automatic_recovery_used';
// No interrumpir la captura de cámara, evidencias o edición de dispositivos.
// El Service Worker puede activarse mientras Android mantiene abierta una cámara externa.
export function hasActiveMaintenanceEvidenceSurface(doc = globalThis.document) {
  return Boolean(doc?.querySelector?.('.maintenance-evidence-modal, .maintenance-device-editor-open'));
}

export function claimAutomaticReload(storage = globalThis.sessionStorage) {
  try {
    if (storage.getItem(KEY)) return false;
    storage.setItem(KEY, '1');
    return true;
  } catch { return false; }
}
