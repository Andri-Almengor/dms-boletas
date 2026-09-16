const SYNC_META_PREFIX = 'incremental-sync';
let corePromise = null;

function loadCore() {
  if (!corePromise) corePromise = import('./offlineStoreCore');
  return corePromise;
}

function clean(value, maxLength = 220) {
  return String(value ?? '').trim().slice(0, maxLength);
}

export function syncStateKey({ cacheScope, resource, schemaVersion }) {
  return [
    SYNC_META_PREFIX,
    clean(cacheScope, 260) || 'anonymous',
    clean(resource, 80),
    Number(schemaVersion || 1),
  ].join('|');
}

function normalizeState(value = {}) {
  if (!value || typeof value !== 'object') return null;
  const cursor = Number(value.cursor || 0);
  if (!Number.isInteger(cursor) || cursor < 1) return null;
  return {
    cacheScope: clean(value.cacheScope, 260),
    resource: clean(value.resource, 80),
    generation: clean(value.generation, 180),
    schemaVersion: Number(value.schemaVersion || 1),
    cursor,
    savedAt: Number(value.savedAt || 0),
    integrityCheckedAt: Number(value.integrityCheckedAt || 0),
    snapshotSavedAt: Number(value.snapshotSavedAt || 0),
  };
}

export async function readSyncState({ cacheScope, resource, schemaVersion }) {
  if (!cacheScope || !resource) return null;
  const core = await loadCore();
  const entry = await core.getOfflineMeta(syncStateKey({ cacheScope, resource, schemaVersion })).catch(() => null);
  return normalizeState(entry?.value);
}

export async function saveSyncState(nextState = {}) {
  const normalized = normalizeState({ ...nextState, savedAt: Date.now() });
  if (!normalized?.cacheScope || !normalized.resource || !normalized.generation) return null;
  const key = syncStateKey(normalized);
  const core = await loadCore();
  const current = normalizeState((await core.getOfflineMeta(key).catch(() => null))?.value);

  if (
    current
    && current.generation === normalized.generation
    && current.schemaVersion === normalized.schemaVersion
    && normalized.cursor < current.cursor
  ) {
    return current;
  }

  const value = {
    ...current,
    ...normalized,
    cursor: normalized.cursor,
    savedAt: Date.now(),
  };
  await core.setOfflineMeta(key, value);
  return value;
}

export async function markSyncSnapshot({ cacheScope, resource, generation, schemaVersion, cursor }) {
  return saveSyncState({
    cacheScope,
    resource,
    generation,
    schemaVersion,
    cursor,
    snapshotSavedAt: Date.now(),
    integrityCheckedAt: Date.now(),
  });
}

export async function markSyncIntegrityCheck(state = {}) {
  if (!state?.cursor) return null;
  return saveSyncState({ ...state, integrityCheckedAt: Date.now() });
}

export async function clearSyncState({ cacheScope, resource, schemaVersion }) {
  const core = await loadCore();
  const key = syncStateKey({ cacheScope, resource, schemaVersion });
  await core.setOfflineMeta(key, null);
  return null;
}

export function isCompatibleSyncState(state, descriptor = {}) {
  return Boolean(
    state
    && descriptor
    && state.cacheScope === descriptor.cacheScope
    && state.generation === descriptor.generation
    && Number(state.schemaVersion) === Number(descriptor.schemaVersion)
    && Number.isInteger(Number(state.cursor))
    && Number(state.cursor) >= 1
  );
}
