// Shared by chunk failures and service-worker updates. One reload per tab,
// including when a reload fails again. Storage unavailable => manual recovery.
const KEY = 'dms_automatic_recovery_used';
export function claimAutomaticReload(storage = globalThis.sessionStorage) {
  try {
    if (storage.getItem(KEY)) return false;
    storage.setItem(KEY, '1');
    return true;
  } catch { return false; }
}
