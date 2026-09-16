import { apiRequest } from '../api';
import { requestFirstAvailable } from './aliasResolver';
import { normalizeItems, requestAvailable } from './moduleApi';
import { crudSyncListRoutes, patchCrudCollection } from './crudSyncDomain';
import { isMediaUploadActive } from './mediaActivity';
import { patchMaintenanceCollection } from './maintenanceSyncDomain';

export const CLIENT_SYNC_SCHEMA_VERSION = 1;

const BACKGROUND_SYNC_INTERVAL_MS = Math.max(30_000, Number(import.meta.env.VITE_INCREMENTAL_SYNC_INTERVAL_MS || 60_000));
let corePromise = null;
const syncInflight = new Map();
const detailInflight = new Map();
const listeners = new Map();
const entityListeners = new Map();
const knownResourceSync = new Map();
let backgroundSchedulerStarted = false;

function loadCore() {
  if (!corePromise) corePromise = import('./offlineStoreCore');
  return corePromise;
}

function clean(value) {
  return String(value ?? '').trim();
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

function hashText(value = '') {
  let hash = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function primaryRoute(routes) {
  return String((Array.isArray(routes) ? routes[0] : routes) || '');
}

function permissionFingerprint(permissions = []) {
  return [...new Set((permissions || []).map(String).filter(Boolean))].sort().join(',');
}

function scopeFingerprint(userId, permissions = []) {
  return `${clean(userId) || 'anonymous'}:${hashText(permissionFingerprint(permissions))}`;
}

function stateMetaKey(resource, userId, permissions = [], entityId = '') {
  const entity = clean(entityId);
  const suffix = entity ? `:entity:${hashText(entity)}` : '';
  return `incremental-sync:${clean(resource)}:${scopeFingerprint(userId, permissions)}${suffix}`;
}

function securityMetaKey(userId, permissions = []) {
  return `incremental-sync-security:${scopeFingerprint(userId, permissions)}`;
}

export function synchronizedResponseCacheKey(cacheScope, routes, payload = {}) {
  return `${clean(cacheScope)}|${primaryRoute(routes)}|${JSON.stringify(stable(payload || {}))}`;
}

function cacheRoute(entry = {}) {
  return String(entry.key || '').split('|')[1]?.toLowerCase() || '';
}

function cachePayload(entry = {}) {
  const parts = String(entry.key || '').split('|');
  try { return JSON.parse(parts.slice(2).join('|') || '{}'); } catch { return {}; }
}

function normalizeTicketStatus(value) {
  const text = String(value || '').trim().toUpperCase();
  if (text.includes('FINAL')) return 'FINALIZADA';
  if (text.includes('PEND')) return 'PENDIENTE';
  if (text.includes('ANUL')) return 'ANULADA';
  return text;
}

function ticketId(ticket = {}) {
  return clean(ticket.BoletaUID || ticket.boletaUid || ticket.id);
}

function activeTicket(ticket = {}) {
  return ticket.Activo !== false
    && String(ticket.Activo ?? 'true').toLowerCase() !== 'false'
    && normalizeTicketStatus(ticket.Estado) !== 'ANULADA';
}

function ticketSearchMatches(ticket, search) {
  if (!search) return true;
  const fields = ['Titulo', 'Cliente', 'Ubicacion', 'Categoria', 'TipoDispositivo', 'Fabricante', 'Modelo', 'BoletaID'];
  const needle = String(search).trim().toLowerCase();
  return fields.some((field) => String(ticket?.[field] || '').toLowerCase().includes(needle));
}

export function ticketMatchesSyncQuery(ticket = {}, request = {}) {
  if (!activeTicket(ticket)) return false;
  const requestedStatus = normalizeTicketStatus(request.status || request.estado);
  if (requestedStatus && normalizeTicketStatus(ticket.Estado) !== requestedStatus) return false;
  if (request.dateFrom && String(ticket.Fecha || '').slice(0, 10) < String(request.dateFrom)) return false;
  if (request.dateTo && String(ticket.Fecha || '').slice(0, 10) > String(request.dateTo)) return false;

  const filters = [
    ['clienteId', 'ClienteID'],
    ['categoriaId', 'CategoriaID'],
    ['tipoDispositivoId', 'TipoDispositivoID'],
    ['fabricanteId', 'FabricanteID'],
    ['modeloId', 'ModeloID'],
  ];
  for (const [payloadKey, rowKey] of filters) {
    const expected = clean(request[payloadKey]);
    if (expected && clean(ticket[rowKey]) !== expected) return false;
  }
  if (request.clienteId && String(ticket.ClienteID || ticket.ClienteRef || '') !== String(request.clienteId)) return false;
  if (request.activo !== undefined && String(ticket.Activo).toLowerCase() !== String(request.activo).toLowerCase()) return false;
  if (!ticketSearchMatches(ticket, request.search || request.q)) return false;

  const assignedUserId = clean(request.asignadoUsuarioId);
  if (assignedUserId) {
    const assigned = Array.isArray(ticket.__sync?.assignedUserIds) ? ticket.__sync.assignedUserIds.map(String) : [];
    if (!assigned.includes(assignedUserId)) return false;
  }
  return true;
}

function ticketDateKey(row) {
  return String(row?.Fecha || row?.FechaCreacion || '').slice(0, 10);
}

function ticketNumber(row) {
  const value = Number(row?.BoletaID);
  return Number.isFinite(value) ? value : 0;
}

function ticketCreatedAt(row) {
  const value = Date.parse(row?.FechaCreacion || row?.FechaActualizacion || '');
  return Number.isNaN(value) ? 0 : value;
}

function compareTickets(left, right) {
  return ticketDateKey(right).localeCompare(ticketDateKey(left))
    || ticketNumber(right) - ticketNumber(left)
    || ticketCreatedAt(right) - ticketCreatedAt(left);
}

export function patchTicketItemsForQuery(items = [], request = {}, delta = {}, limit = 0) {
  const removed = new Set((delta.removed || []).map(String));
  const next = (items || []).filter((item) => !removed.has(ticketId(item)));
  const byId = new Map(next.map((item, index) => [ticketId(item), index]));

  for (const incoming of delta.upserts || []) {
    const id = ticketId(incoming);
    if (!id) continue;
    const index = byId.has(id) ? byId.get(id) : -1;
    if (!ticketMatchesSyncQuery(incoming, request)) {
      if (index >= 0) {
        next.splice(index, 1);
        byId.clear();
        next.forEach((item, currentIndex) => byId.set(ticketId(item), currentIndex));
      }
      continue;
    }
    if (index >= 0) next[index] = { ...next[index], ...incoming };
    else next.push(incoming);
    byId.clear();
    next.forEach((item, currentIndex) => byId.set(ticketId(item), currentIndex));
  }

  next.sort(compareTickets);
  return limit > 0 ? next.slice(0, limit) : next;
}

function authoritativeTicketTotal(request = {}, delta = {}) {
  const status = normalizeTicketStatus(request.status || request.estado);
  if (request.search || request.q || request.dateFrom || request.dateTo || request.clienteId
    || request.categoriaId || request.tipoDispositivoId || request.fabricanteId || request.modeloId
    || request.asignadoUsuarioId) return null;
  if (status === 'PENDIENTE') return Number.isFinite(Number(delta.counts?.pending)) ? Number(delta.counts.pending) : null;
  if (status === 'FINALIZADA') return Number.isFinite(Number(delta.counts?.finished)) ? Number(delta.counts.finished) : null;
  return null;
}

function rebuildCollection(original, items, total, request, delta, integrityPending = false) {
  if (Array.isArray(original)) return items;
  const nextTotal = Number.isFinite(Number(total)) ? Number(total) : items.length;
  const shared = {
    ...original,
    total: nextTotal,
    syncIntegrityPending: Boolean(integrityPending),
  };
  if (delta.counts && original?.homeSummary) {
    shared.homeSummary = {
      pending: Number(delta.counts.pending || 0),
      finished: Number(delta.counts.finished || 0),
    };
  }
  if (Array.isArray(original?.items)) return { ...shared, items };
  if (Array.isArray(original?.rows)) return { ...shared, rows: items };
  if (Array.isArray(original?.data)) return { ...shared, data: items };
  return {
    ...shared,
    items,
    page: Number(request.page || 1),
    pageSize: Number(request.pageSize || items.length || 1),
  };
}

export function patchTicketCollection(data, request = {}, delta = {}) {
  const beforeItems = normalizeItems(data);
  const beforeIds = new Set(beforeItems.map(ticketId).filter(Boolean));
  const page = Math.max(1, Number(request.page || data?.page || 1));
  const pageSize = Math.max(1, Number(request.pageSize || data?.pageSize || beforeItems.length || 100));
  const workingLimit = Math.max(beforeItems.length, page === 1 ? pageSize : beforeItems.length);
  const items = patchTicketItemsForQuery(beforeItems, request, delta, workingLimit);
  const authoritativeTotal = authoritativeTicketTotal(request, delta);
  let total = Number(data?.total);
  if (!Number.isFinite(total)) total = beforeItems.length;
  const completeCollection = page === 1 && total <= beforeItems.length;
  let integrityPending = Boolean(data?.syncIntegrityPending)
    || !completeCollection && Boolean(delta.upserts?.length || delta.removed?.length);

  if (authoritativeTotal !== null) {
    total = authoritativeTotal;
  } else {
    const afterIds = new Set(items.map(ticketId).filter(Boolean));
    for (const id of beforeIds) if (!afterIds.has(id)) total = Math.max(0, total - 1);
    for (const incoming of delta.upserts || []) {
      const id = ticketId(incoming);
      if (!id || beforeIds.has(id) || !ticketMatchesSyncQuery(incoming, request)) continue;
      if (total <= beforeItems.length && page === 1) total += 1;
      else integrityPending = true;
    }
  }

  if (completeCollection && authoritativeTotal === null) {
    total = patchTicketItemsForQuery(beforeItems, request, delta).length;
  }
  return rebuildCollection(data, items, total, request, delta, integrityPending);
}

async function readState(resource, userId, permissions, entityId = '') {
  const core = await loadCore();
  const entry = await core.getOfflineMeta(stateMetaKey(resource, userId, permissions, entityId));
  return entry?.value || null;
}

async function saveState(resource, userId, permissions, nextState = {}, entityId = '') {
  const core = await loadCore();
  const key = stateMetaKey(resource, userId, permissions, entityId);
  const current = (await core.getOfflineMeta(key))?.value || null;
  if (current && current.generation === nextState.generation
    && Number(nextState.cursor || 0) < Number(current.cursor || 0)) return current;
  const value = {
    ...(current || {}),
    ...nextState,
    resource,
    entityId: clean(entityId),
    userId: clean(userId),
    savedAt: Date.now(),
  };
  await core.setOfflineMeta(key, value);
  return value;
}

async function securityBlocked(userId, permissions) {
  const core = await loadCore();
  const entry = await core.getOfflineMeta(securityMetaKey(userId, permissions));
  return Boolean(entry?.value?.blocked);
}

async function markSecurityBlocked(userId, permissions, delta = {}) {
  const core = await loadCore();
  await core.setOfflineMeta(securityMetaKey(userId, permissions), {
    blocked: true,
    generation: clean(delta.generation),
    cursor: Number(delta.cursor || 0),
    reason: clean(delta.reason || 'security_changed'),
    savedAt: Date.now(),
  });
}

export async function clearSyncSecurityBlock(userId, permissions = []) {
  const core = await loadCore();
  await core.setOfflineMeta(securityMetaKey(userId, permissions), {
    blocked: false,
    savedAt: Date.now(),
  });
}

async function readScopedCache(state, routes, payload) {
  if (!state?.cacheScope) return null;
  const core = await loadCore();
  return core.readCachedResponse(synchronizedResponseCacheKey(state.cacheScope, routes, payload), 0);
}

async function writeScopedCache(state, routes, payload, data) {
  if (!state?.cacheScope) return null;
  const core = await loadCore();
  await core.cacheResponse(synchronizedResponseCacheKey(state.cacheScope, routes, payload), data);
  return data;
}

function emit(resource, detail) {
  const callbacks = listeners.get(resource);
  if (callbacks) {
    for (const callback of [...callbacks]) {
      try { callback(detail); } catch { /* one view must not break the others */ }
    }
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(`dms-sync-${resource}`, { detail }));
}

function entityListenerKey(resource, entityId) {
  return `${clean(resource)}:${clean(entityId)}`;
}

function emitEntity(resource, entityId, detail) {
  const key = entityListenerKey(resource, entityId);
  const callbacks = entityListeners.get(key);
  if (callbacks) {
    for (const callback of [...callbacks]) {
      try { callback(detail); } catch { /* one detail view must not break others */ }
    }
  }
}

export function subscribeSyncResource(resource, callback) {
  const key = clean(resource);
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(callback);
  return () => {
    const callbacks = listeners.get(key);
    callbacks?.delete(callback);
    if (callbacks && callbacks.size === 0) listeners.delete(key);
  };
}

export function subscribeSyncEntity(resource, entityId, callback) {
  const key = entityListenerKey(resource, entityId);
  if (!entityListeners.has(key)) entityListeners.set(key, new Set());
  entityListeners.get(key).add(callback);
  return () => {
    const callbacks = entityListeners.get(key);
    callbacks?.delete(callback);
    if (callbacks && callbacks.size === 0) entityListeners.delete(key);
  };
}

function resourceCacheRoutes(resource) {
  if (resource === 'ticket') return new Set(['boletas.list', 'tickets.list']);
  if (resource === 'maintenance') return new Set(['maintenance.list', 'mantenimientos.list']);
  return new Set(crudSyncListRoutes(resource));
}

function patchResourceCollection(resource, data, payload, delta, permissions) {
  if (resource === 'ticket') return patchTicketCollection(data, payload, delta);
  if (resource === 'maintenance') return patchMaintenanceCollection(data, payload, delta);
  return patchCrudCollection(resource, data, payload, delta, permissions);
}

function hasDeltaChanges(delta) {
  return Boolean(delta.upserts?.length || delta.removed?.length || delta.invalidated?.length || delta.counts);
}

async function commitDelta({ resource, userId, permissions, current, delta, entityId = '', routes, payload }) {
  const core = await loadCore();
  const listRoutes = resourceCacheRoutes(resource);
  const changed = hasDeltaChanges(delta);
  const removed = entityId && (delta.removed || []).map(String).includes(String(entityId));
  const detailChanged = entityId && (removed || !delta.notModified && delta.detail);
  if (!changed && !detailChanged && Number(current.cursor) === Number(delta.cursor)) {
    return { committed: true, state: current, writes: 0 };
  }
  return core.commitSyncCacheUpdate({
    stateKey: stateMetaKey(resource, userId, permissions, entityId),
    expectedState: current,
    nextState: { ...current, cursor: Number(delta.cursor), lastSyncAt: Date.now() },
    cachePrefix: !entityId && changed ? `${current.cacheScope}|` : '',
    predicate: (entry) => listRoutes.has(cacheRoute(entry)),
    updater: (data, entry) => patchResourceCollection(resource, data, cachePayload(entry), delta, permissions),
    snapshotKey: detailChanged ? synchronizedResponseCacheKey(current.cacheScope, routes, payload) : undefined,
    snapshotData: removed ? null : delta.detail,
  });
}

async function authoritativeRequest(routes, payload, sessionToken, signal) {
  const candidates = Array.isArray(routes) ? routes : [routes];
  return requestFirstAvailable(
    candidates,
    (route) => apiRequest(route, payload, sessionToken, { signal, cache: 'no-store' }),
    { signal },
  );
}

function onlineNow() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function currentSessionToken() {
  if (typeof localStorage === 'undefined') return '';
  try {
    return clean(JSON.parse(localStorage.getItem('dms_session') || '{}')?.sessionToken);
  } catch {
    return '';
  }
}

function canRunBackgroundSync() {
  if (!onlineNow() || isMediaUploadActive()) return false;
  if (typeof document !== 'undefined' && document.hidden) return false;
  return Boolean(currentSessionToken());
}

function knownResourceKey({ resource, userId, permissions = [] }) {
  return `${scopeFingerprint(userId, permissions)}|${clean(resource)}`;
}

function ensureBackgroundScheduler() {
  if (backgroundSchedulerStarted || typeof window === 'undefined') return;
  backgroundSchedulerStarted = true;

  const run = (reason) => {
    if (!canRunBackgroundSync()) return;
    Promise.resolve().then(() => syncKnownResourcesInBackground(reason)).catch(() => {});
  };

  window.addEventListener('focus', () => run('focus'));
  window.addEventListener('online', () => run('online'));
  window.addEventListener('dms-media-upload-idle', () => run('media-idle'));
  window.addEventListener('dms-offline-replay-complete', () => run('offline-replay'));
  window.setInterval(() => run('timer'), BACKGROUND_SYNC_INTERVAL_MS);
}

function rememberResourceSync(options = {}) {
  if (!options.sessionToken || !options.resource) return;
  const key = knownResourceKey(options);
  knownResourceSync.set(key, {
    resource: clean(options.resource),
    routes: Array.isArray(options.routes) ? [...options.routes] : options.routes,
    payload: stable(options.payload || {}),
    sessionToken: clean(options.sessionToken),
    userId: clean(options.userId),
    permissions: [...new Set((options.permissions || []).map(String).filter(Boolean))],
  });
  ensureBackgroundScheduler();
}

export async function syncKnownResourcesInBackground(reason = 'timer') {
  if (!canRunBackgroundSync()) return { reason, synced: 0, skipped: 'not-eligible' };
  const activeToken = currentSessionToken();
  let synced = 0;

  for (const [key, options] of knownResourceSync.entries()) {
    if (options.sessionToken !== activeToken) {
      knownResourceSync.delete(key);
      continue;
    }
    if (!canRunBackgroundSync()) break;
    try {
      await synchronizeResource({ ...options, signal: undefined });
      synced += 1;
    } catch {
      // Background sync is best-effort. Foreground/cache fallback remains authoritative.
    }
  }

  try {
    globalThis.dispatchEvent?.(new CustomEvent('dms-sync-background-complete', { detail: { reason, synced } }));
  } catch {
    // Observability only.
  }
  return { reason, synced };
}

async function repairScopedCollectionIfNeeded({ resource, userId, permissions, state, routes, payload, sessionToken, signal, cached }) {
  if (!cached?.syncIntegrityPending || !onlineNow()) return cached;
  try {
    const data = await authoritativeRequest(routes, payload, sessionToken, signal);
    const core = await loadCore();
    await core.commitSyncCacheUpdate({
      stateKey: stateMetaKey(resource, userId, permissions), expectedState: state, nextState: state,
      snapshotKey: synchronizedResponseCacheKey(state.cacheScope, routes, payload), snapshotData: data,
    });
    return data;
  } catch {
    return cached;
  }
}

async function probeSnapshot(resource, sessionToken, signal, entityId = '') {
  return apiRequest('sync.delta', {
    resource,
    entityId: clean(entityId),
    cursor: 1,
    generation: '',
    schemaVersion: CLIENT_SYNC_SCHEMA_VERSION,
  }, sessionToken, { signal });
}

function stateFromDelta(delta = {}, cursor = null) {
  return {
    enabled: delta.enabled !== false,
    generation: clean(delta.generation),
    schemaVersion: Number(delta.schemaVersion || CLIENT_SYNC_SCHEMA_VERSION),
    cacheScope: clean(delta.cacheScope),
    cursor: Number(cursor ?? delta.snapshotCursor ?? delta.cursor ?? 1),
    fullSnapshotRequired: false,
    securityInvalidated: false,
  };
}

function notifySecurityInvalidation(resource, entityId, delta) {
  const detail = { type: 'security-invalidated', resource, entityId: clean(entityId), delta };
  emit(resource, detail);
  if (entityId) emitEntity(resource, entityId, detail);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('dms-sync-security-invalidated', { detail: delta }));
  }
}

async function handleSecurityInvalidation({ resource, entityId = '', userId, permissions, state, delta }) {
  await markSecurityBlocked(userId, permissions, delta);
  const blockedState = await saveState(resource, userId, permissions, {
    ...(state || {}),
    securityInvalidated: true,
    lastSyncAt: Date.now(),
  }, entityId);
  notifySecurityInvalidation(resource, entityId, delta);
  return blockedState;
}

async function replaceSnapshot({
  resource,
  routes,
  payload,
  sessionToken,
  userId,
  permissions,
  delta,
  signal,
  entityId = '',
}) {
  const expectedState = await readState(resource, userId, permissions, entityId);
  const snapshotCursor = Number(delta.snapshotCursor ?? delta.cursor ?? 1);
  const snapshotState = stateFromDelta(delta, snapshotCursor);
  // Reconciliation must come from the authoritative online endpoint. If this
  // request fails, keep the previous compatible cache instead of replacing it
  // with an offline fallback that may predate the requested cursor.
  const data = await authoritativeRequest(routes, payload, sessionToken, signal);
  const core = await loadCore();
  const listRoutes = resourceCacheRoutes(resource);
  const committed = await core.commitSyncCacheUpdate({
    stateKey: stateMetaKey(resource, userId, permissions, entityId),
    expectedState,
    nextState: { ...snapshotState, resource, entityId, userId, snapshotSavedAt: Date.now() },
    cachePrefix: `${snapshotState.cacheScope}|`,
    predicate: (entry) => listRoutes.has(cacheRoute(entry)),
    replaceResource: !entityId,
    snapshotKey: synchronizedResponseCacheKey(snapshotState.cacheScope, routes, payload),
    snapshotData: data,
  });
  if (!committed.committed) return { data, state: committed.state || expectedState };
  const saved = committed.state;
  if (entityId) emitEntity(resource, entityId, { type: 'snapshot', resource, entityId, data, state: saved, reason: delta.reason || 'reconcile' });
  else emit(resource, { type: 'snapshot', resource, data, state: saved, reason: delta.reason || 'reconcile' });
  return { data, state: saved };
}

async function synchronizeResourceInternal({
  resource,
  routes,
  payload,
  sessionToken,
  userId,
  permissions,
  signal,
}) {
  let state = await readState(resource, userId, permissions);
  if (!state?.generation || !state?.cacheScope || state.enabled === false) return null;
  if (await securityBlocked(userId, permissions)) return state;

  for (let page = 0; page < 20; page += 1) {
    const delta = await apiRequest('sync.delta', {
      resource,
      cursor: Number(state.cursor || 1),
      generation: state.generation,
      cacheScope: state.cacheScope,
      schemaVersion: state.schemaVersion,
    }, sessionToken, { signal });

    if (delta.securityInvalidated) {
      return handleSecurityInvalidation({ resource, userId, permissions, state, delta });
    }

    if (delta.enabled === false || delta.reason === 'sync_unsafe') {
      return saveState(resource, userId, permissions, { ...state, enabled: false });
    }
    if (delta.fullSnapshotRequired) {
      const replacement = await replaceSnapshot({ resource, routes, payload, sessionToken, userId, permissions, delta, signal });
      state = replacement.state;
      continue;
    }

    const current = await readState(resource, userId, permissions);
    if (!current || current.generation !== delta.generation) return null;
    if (Number(delta.cursor || 0) < Number(current.cursor || 0)) return current;

    const idbPatchStartedAt = performance.now();
    const committed = await commitDelta({ resource, userId, permissions, current, delta });
    if (!committed.committed) return committed.state;
    const idbPatchMs = Math.round((performance.now() - idbPatchStartedAt) * 100) / 100;
    state = committed.state;
    if (hasDeltaChanges(delta)) {
      emit(resource, { type: 'delta', resource, delta: { ...delta, idbPatchMs, idbWriteCount: committed.writes, queryReconcileRequired: committed.reconcileRequired }, state });
    }
    if (!delta.hasMore) return state;
  }

  const fallback = await apiRequest('sync.delta', {
    resource,
    cursor: Number(state.cursor || 1),
    generation: '__force_snapshot__',
    schemaVersion: state.schemaVersion,
  }, sessionToken, { signal });
  if (fallback.securityInvalidated) {
    return handleSecurityInvalidation({ resource, userId, permissions, state, delta: fallback });
  }
  if (fallback.fullSnapshotRequired) {
    return (await replaceSnapshot({ resource, routes, payload, sessionToken, userId, permissions, delta: fallback, signal })).state;
  }
  return state;
}

export async function synchronizeResource(options = {}) {
  const state = await readState(options.resource, options.userId, options.permissions);
  if (!state?.cacheScope || state.securityInvalidated) return state || null;
  const key = `${state.cacheScope}|${options.resource}|${Number(state.cursor || 1)}`;
  if (syncInflight.has(key)) return syncInflight.get(key);
  const promise = synchronizeResourceInternal(options).finally(() => {
    if (syncInflight.get(key) === promise) syncInflight.delete(key);
  });
  syncInflight.set(key, promise);
  return promise;
}

async function synchronizeDetailInternal({
  resource,
  entityId,
  routes,
  payload,
  sessionToken,
  userId,
  permissions,
  signal,
}) {
  let state = await readState(resource, userId, permissions, entityId);
  if (!state?.generation || !state?.cacheScope || state.enabled === false) return null;
  if (await securityBlocked(userId, permissions)) return state;

  for (let page = 0; page < 20; page += 1) {
    const delta = await apiRequest('sync.delta', {
      resource,
      entityId,
      cursor: Number(state.cursor || 1),
      generation: state.generation,
      cacheScope: state.cacheScope,
      schemaVersion: state.schemaVersion,
    }, sessionToken, { signal });

    if (delta.securityInvalidated) {
      return handleSecurityInvalidation({ resource, entityId, userId, permissions, state, delta });
    }

    if (delta.enabled === false || delta.reason === 'sync_unsafe') {
      return saveState(resource, userId, permissions, { ...state, enabled: false }, entityId);
    }
    if (delta.fullSnapshotRequired) {
      const replacement = await replaceSnapshot({
        resource, routes, payload, sessionToken, userId, permissions, delta, signal, entityId,
      });
      state = replacement.state;
      continue;
    }

    const current = await readState(resource, userId, permissions, entityId);
    if (!current || current.generation !== delta.generation) return null;
    if (Number(delta.cursor || 0) < Number(current.cursor || 0)) return current;

    const committed = await commitDelta({ resource, userId, permissions, current, delta, entityId, routes, payload });
    if (!committed.committed) return committed.state;
    state = committed.state;
    // Detail has an independent cursor. Never patch lists with a possibly older
    // detail delta; their own resource sync will consume the same events safely.
    if ((delta.removed || []).map(String).includes(String(entityId))) {
      emitEntity(resource, entityId, { type: 'removed', resource, entityId, delta, state });
    } else if (!delta.notModified && delta.detail) {
      emitEntity(resource, entityId, { type: 'detail', resource, entityId, data: delta.detail, delta, state });
    }

    if (!delta.hasMore) return state;
  }

  const fallback = await apiRequest('sync.delta', {
    resource,
    entityId,
    cursor: Number(state.cursor || 1),
    generation: '__force_snapshot__',
    schemaVersion: state.schemaVersion,
  }, sessionToken, { signal });
  if (fallback.securityInvalidated) {
    return handleSecurityInvalidation({ resource, entityId, userId, permissions, state, delta: fallback });
  }
  if (fallback.fullSnapshotRequired) {
    return (await replaceSnapshot({ resource, routes, payload, sessionToken, userId, permissions, delta: fallback, signal, entityId })).state;
  }
  return state;
}

export async function synchronizeDetail(options = {}) {
  const state = await readState(options.resource, options.userId, options.permissions, options.entityId);
  if (!state?.cacheScope || state.securityInvalidated) return state || null;
  const key = `${state.cacheScope}|${options.resource}|${clean(options.entityId)}|${Number(state.cursor || 1)}`;
  if (detailInflight.has(key)) return detailInflight.get(key);
  const promise = synchronizeDetailInternal(options).finally(() => {
    if (detailInflight.get(key) === promise) detailInflight.delete(key);
  });
  detailInflight.set(key, promise);
  return promise;
}

function scheduleSync(options) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  if (isMediaUploadActive()) return;
  Promise.resolve().then(() => synchronizeResource(options)).catch(() => {});
}

function scheduleDetailSync(options) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  if (isMediaUploadActive()) return;
  Promise.resolve().then(() => synchronizeDetail(options)).catch(() => {});
}

function securityRefreshRequiredError() {
  const error = new Error('La seguridad de la sesión cambió. Conéctese a internet para validar nuevamente sus permisos.');
  error.code = 'SYNC_SECURITY_REFRESH_REQUIRED';
  return error;
}

export async function requestSynchronizedCollection(
  routes,
  payload = {},
  sessionToken = '',
  { resource, userId = '', permissions = [], signal, forceSync = false } = {},
) {
  if (!sessionToken || !resource) return requestAvailable(routes, payload, sessionToken, { signal });
  if (await securityBlocked(userId, permissions)) {
    if (!onlineNow()) throw securityRefreshRequiredError();
    return authoritativeRequest(routes, payload, sessionToken, signal);
  }
  rememberResourceSync({ resource, routes, payload, sessionToken, userId, permissions });
  let state = await readState(resource, userId, permissions);

  if (state?.enabled !== false && state?.cacheScope && !state?.securityInvalidated) {
    let cached = await readScopedCache(state, routes, payload);
    if (cached !== null) {
      const options = { resource, routes, payload, sessionToken, userId, permissions, signal };
      if (forceSync && onlineNow()) {
        await synchronizeResource(options);
        state = await readState(resource, userId, permissions);
        if (state?.enabled === false) return requestAvailable(routes, payload, sessionToken, { signal });
        const refreshed = await readScopedCache(state, routes, payload);
        if (refreshed !== null) cached = refreshed;
      } else {
        scheduleSync({ ...options, signal: undefined });
      }
      return repairScopedCollectionIfNeeded({ resource, userId, permissions, state, routes, payload, sessionToken, signal, cached });
    }
  }

  let snapshotBasis = state;
  if (snapshotBasis?.enabled === false || !snapshotBasis?.generation || !snapshotBasis?.cacheScope) {
    try {
      const probe = await probeSnapshot(resource, sessionToken, signal);
      if (probe.enabled === false || probe.reason === 'sync_unsafe') return requestAvailable(routes, payload, sessionToken, { signal });
      snapshotBasis = stateFromDelta(probe);
    } catch {
      return requestAvailable(routes, payload, sessionToken, { signal });
    }
  }

  try {
    const data = await authoritativeRequest(routes, payload, sessionToken, signal);
    const core = await loadCore();
    const committed = await core.commitSyncCacheUpdate({
      stateKey: stateMetaKey(resource, userId, permissions),
      expectedState: state,
      nextState: { ...snapshotBasis, resource, userId, snapshotSavedAt: Date.now() },
      snapshotKey: synchronizedResponseCacheKey(snapshotBasis.cacheScope, routes, payload),
      snapshotData: data,
    });
    state = committed.state || state;
    scheduleSync({ resource, routes, payload, sessionToken, userId, permissions });
    return data;
  } catch {
    return requestAvailable(routes, payload, sessionToken, { signal });
  }
}

export async function requestSynchronizedDetail(
  routes,
  payload = {},
  sessionToken = '',
  { resource, entityId, userId = '', permissions = [], signal, forceSync = false } = {},
) {
  const targetId = clean(entityId || payload.boletaUid || payload.maintenanceId || payload.id);
  if (!sessionToken || !resource || !targetId) return requestAvailable(routes, payload, sessionToken, { signal });
  if (await securityBlocked(userId, permissions)) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw securityRefreshRequiredError();
    return authoritativeRequest(routes, payload, sessionToken, signal);
  }
  let state = await readState(resource, userId, permissions, targetId);

  if (state?.enabled !== false && state?.cacheScope && !state?.securityInvalidated) {
    const cached = await readScopedCache(state, routes, payload);
    if (cached !== null) {
      const options = { resource, entityId: targetId, routes, payload, sessionToken, userId, permissions, signal };
      if (forceSync && typeof navigator !== 'undefined' && navigator.onLine !== false) {
        await synchronizeDetail(options);
        const refreshedState = await readState(resource, userId, permissions, targetId);
        if (refreshedState?.enabled === false) return requestAvailable(routes, payload, sessionToken, { signal });
        const refreshed = await readScopedCache(refreshedState, routes, payload);
        if (refreshed !== null) return refreshed;
        return authoritativeRequest(routes, payload, sessionToken, signal);
      } else {
        scheduleDetailSync({ ...options, signal: undefined });
      }
      return cached;
    }
  }

  let snapshotBasis = state;
  if (snapshotBasis?.enabled === false || !snapshotBasis?.generation || !snapshotBasis?.cacheScope) {
    try {
      const probe = await probeSnapshot(resource, sessionToken, signal, targetId);
      if (probe.enabled === false || probe.reason === 'sync_unsafe') return requestAvailable(routes, payload, sessionToken, { signal });
      snapshotBasis = stateFromDelta(probe);
    } catch {
      return requestAvailable(routes, payload, sessionToken, { signal });
    }
  }

  try {
    const data = await authoritativeRequest(routes, payload, sessionToken, signal);
    const core = await loadCore();
    const committed = await core.commitSyncCacheUpdate({
      stateKey: stateMetaKey(resource, userId, permissions, targetId),
      expectedState: state,
      nextState: { ...snapshotBasis, resource, userId, snapshotSavedAt: Date.now() },
      snapshotKey: synchronizedResponseCacheKey(snapshotBasis.cacheScope, routes, payload),
      snapshotData: data,
    });
    state = committed.state || state;
    scheduleDetailSync({ resource, entityId: targetId, routes, payload, sessionToken, userId, permissions });
    return data;
  } catch {
    return requestAvailable(routes, payload, sessionToken, { signal });
  }
}

export async function readSynchronizedCollectionCache(routes, payload = {}, { resource, userId = '', permissions = [] } = {}) {
  if (await securityBlocked(userId, permissions)) return null;
  const state = await readState(resource, userId, permissions);
  return readScopedCache(state, routes, payload);
}

export async function readSynchronizedDetailCache(routes, payload = {}, { resource, entityId, userId = '', permissions = [] } = {}) {
  if (await securityBlocked(userId, permissions)) return null;
  const state = await readState(resource, userId, permissions, entityId);
  return readScopedCache(state, routes, payload);
}
