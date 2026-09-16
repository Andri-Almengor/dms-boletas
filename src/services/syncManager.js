import { apiRequest } from '../api';
import { normalizeItems, requestAvailable } from './moduleApi';

export const CLIENT_SYNC_SCHEMA_VERSION = 1;

let corePromise = null;
const syncInflight = new Map();
const listeners = new Map();

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

function stateMetaKey(resource, userId, permissions = []) {
  return `incremental-sync:${clean(resource)}:${clean(userId) || 'anonymous'}:${hashText(permissionFingerprint(permissions))}`;
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
    if (expected && clean(ticket[rowKey] || (rowKey === 'ClienteID' ? ticket.ClienteRef : '')) !== expected) return false;
  }
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
  let integrityPending = false;

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

  return rebuildCollection(data, items, total, request, delta, integrityPending);
}

async function readState(resource, userId, permissions) {
  const core = await loadCore();
  const entry = await core.getOfflineMeta(stateMetaKey(resource, userId, permissions));
  return entry?.value || null;
}

async function saveState(resource, userId, permissions, nextState = {}) {
  const core = await loadCore();
  const key = stateMetaKey(resource, userId, permissions);
  const current = (await core.getOfflineMeta(key))?.value || null;
  if (current && current.generation === nextState.generation
    && Number(nextState.cursor || 0) < Number(current.cursor || 0)) return current;
  const value = {
    ...(current || {}),
    ...nextState,
    resource,
    userId: clean(userId),
    savedAt: Date.now(),
  };
  await core.setOfflineMeta(key, value);
  return value;
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
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(`dms-sync-${resource}`, { detail }));
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

async function applyTicketDeltaToCaches(cacheScope, delta) {
  const core = await loadCore();
  const prefix = `${cacheScope}|`;
  return core.updateCachedResponses(
    (entry) => String(entry?.key || '').startsWith(prefix)
      && ['boletas.list', 'tickets.list'].includes(cacheRoute(entry)),
    (data, entry) => patchTicketCollection(data, cachePayload(entry), delta),
  );
}

async function applyRemoteDelta(resource, state, delta) {
  if (resource === 'ticket') return applyTicketDeltaToCaches(state.cacheScope, delta);
  return 0;
}

async function probeSnapshot(resource, sessionToken, signal) {
  return apiRequest('sync.delta', {
    resource,
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

async function replaceSnapshot({
  resource,
  routes,
  payload,
  sessionToken,
  userId,
  permissions,
  delta,
  signal,
}) {
  const snapshotCursor = Number(delta.snapshotCursor ?? delta.cursor ?? 1);
  const snapshotState = stateFromDelta(delta, snapshotCursor);
  const data = await requestAvailable(routes, payload, sessionToken, { signal });
  await writeScopedCache(snapshotState, routes, payload, data);
  const saved = await saveState(resource, userId, permissions, snapshotState);
  emit(resource, { type: 'snapshot', resource, data, state: saved, reason: delta.reason || 'reconcile' });
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

  for (let page = 0; page < 20; page += 1) {
    const delta = await apiRequest('sync.delta', {
      resource,
      cursor: Number(state.cursor || 1),
      generation: state.generation,
      schemaVersion: state.schemaVersion,
    }, sessionToken, { signal });

    if (delta.securityInvalidated && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('dms-sync-security-invalidated', { detail: delta }));
    }

    if (delta.fullSnapshotRequired) {
      const replacement = await replaceSnapshot({
        resource,
        routes,
        payload,
        sessionToken,
        userId,
        permissions,
        delta,
        signal,
      });
      state = replacement.state;
      continue;
    }

    const current = await readState(resource, userId, permissions);
    if (!current || current.generation !== delta.generation) return null;
    if (Number(delta.cursor || 0) < Number(current.cursor || 0)) return current;

    const idbPatchStartedAt = performance.now();
    const idbWriteCount = await applyRemoteDelta(resource, current, delta);
    const idbPatchMs = Math.round((performance.now() - idbPatchStartedAt) * 100) / 100;
    state = await saveState(resource, userId, permissions, {
      ...current,
      cursor: Number(delta.cursor || current.cursor || 1),
      generation: delta.generation,
      schemaVersion: Number(delta.schemaVersion || current.schemaVersion),
      cacheScope: delta.cacheScope || current.cacheScope,
      fullSnapshotRequired: false,
      securityInvalidated: false,
      lastSyncAt: Date.now(),
    });
    emit(resource, {
      type: 'delta',
      resource,
      delta: { ...delta, idbPatchMs, idbWriteCount },
      state,
    });
    if (!delta.hasMore) return state;
  }

  const fallback = await apiRequest('sync.delta', {
    resource,
    cursor: Number(state.cursor || 1),
    generation: '__force_snapshot__',
    schemaVersion: state.schemaVersion,
  }, sessionToken, { signal });
  if (fallback.fullSnapshotRequired) {
    return (await replaceSnapshot({ resource, routes, payload, sessionToken, userId, permissions, delta: fallback, signal })).state;
  }
  return state;
}

export async function synchronizeResource(options = {}) {
  const state = await readState(options.resource, options.userId, options.permissions);
  if (!state?.cacheScope) return null;
  const key = `${state.cacheScope}|${options.resource}|${Number(state.cursor || 1)}`;
  if (syncInflight.has(key)) return syncInflight.get(key);
  const promise = synchronizeResourceInternal(options)
    .finally(() => {
      if (syncInflight.get(key) === promise) syncInflight.delete(key);
    });
  syncInflight.set(key, promise);
  return promise;
}

function scheduleSync(options) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  Promise.resolve().then(() => synchronizeResource(options)).catch(() => {});
}

export async function requestSynchronizedCollection(
  routes,
  payload = {},
  sessionToken = '',
  {
    resource,
    userId = '',
    permissions = [],
    signal,
  } = {},
) {
  if (!sessionToken || !resource) return requestAvailable(routes, payload, sessionToken, { signal });
  let state = await readState(resource, userId, permissions);

  if (state?.enabled !== false && state?.cacheScope && !state?.securityInvalidated) {
    const cached = await readScopedCache(state, routes, payload);
    if (cached !== null) {
      scheduleSync({ resource, routes, payload, sessionToken, userId, permissions });
      return cached;
    }
  }

  let snapshotBasis = state;
  if (!snapshotBasis?.generation || !snapshotBasis?.cacheScope) {
    try {
      const probe = await probeSnapshot(resource, sessionToken, signal);
      if (probe.enabled === false) return requestAvailable(routes, payload, sessionToken, { signal });
      snapshotBasis = stateFromDelta(probe);
    } catch {
      return requestAvailable(routes, payload, sessionToken, { signal });
    }
  }

  const data = await requestAvailable(routes, payload, sessionToken, { signal });
  await writeScopedCache(snapshotBasis, routes, payload, data);
  state = await saveState(resource, userId, permissions, snapshotBasis);
  scheduleSync({ resource, routes, payload, sessionToken, userId, permissions });
  return data;
}

export async function readSynchronizedCollectionCache(routes, payload = {}, { resource, userId = '', permissions = [] } = {}) {
  const state = await readState(resource, userId, permissions);
  return readScopedCache(state, routes, payload);
}
