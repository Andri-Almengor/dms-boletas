import { AsyncLocalStorage } from 'node:async_hooks';

const context = new AsyncLocalStorage();
// These tables do not represent any synchronized response. Unknown writes are
// conservatively treated as operational, including structural batchUpdate.
const EXCLUDED = new Set([
  'SyncChanges', 'Configuracion', 'Sesiones', 'Auditoria', 'Consecutivos',
  'Notificaciones', 'MaintenanceFinalizationJobs', 'MaintenanceFinalizationItems',
]);
let unloggedRevision = 0;

export function syncUnloggedRevision() { return unloggedRevision; }

export function observeSyncWrite(sheetNames) {
  if (sheetNames && [...sheetNames].every((name) => EXCLUDED.has(name))) return;
  const current = context.getStore();
  if (current && !current.closed) current.changed = true;
  else unloggedRevision += 1;
}

export function confirmObservedSyncWrites() {
  const current = context.getStore();
  if (current) current.recorded = true;
}

export function trackSyncWrites(callback) {
  const state = { changed: false, recorded: false, closed: false };
  return context.run(state, async () => {
    try { return await callback(); }
    finally {
      state.closed = true;
      // Includes failed/partially persisted actions and read-time data repairs.
      // A detached worker retaining the context is observed separately once closed.
      if (state.changed && !state.recorded) unloggedRevision += 1;
    }
  });
}
