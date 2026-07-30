import { normalizeItems, requestAvailable } from './moduleApi';
import { stableCatalogPayload } from '../utils/catalogCollection';

const DEFAULT_CATALOG_TTL_MS = 5 * 60_000;
const catalogCache = new Map();

function abortError() {
  const error = new Error('La solicitud fue cancelada.');
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

function routeKey(routes) {
  return (Array.isArray(routes) ? routes : [routes]).join('|');
}

export function catalogRequestKey({ routes, payload = {}, sessionToken = '' }) {
  return `${String(sessionToken || '')}::${routeKey(routes)}::${stableCatalogPayload(payload)}`;
}

export function clearCatalogResourceCache(predicate = null) {
  if (typeof predicate !== 'function') {
    catalogCache.clear();
    return;
  }
  for (const [key, entry] of catalogCache.entries()) {
    if (predicate(entry, key)) catalogCache.delete(key);
  }
}

export async function loadCatalogResource({
  routes,
  payload = {},
  sessionToken = '',
  signal,
  force = false,
  ttlMs = DEFAULT_CATALOG_TTL_MS,
}) {
  if (signal?.aborted) throw abortError();
  const key = catalogRequestKey({ routes, payload, sessionToken });
  const cached = catalogCache.get(key);
  if (!force && cached && Date.now() - cached.at < ttlMs) return cached.value;

  const response = await requestAvailable(
    routes,
    payload,
    sessionToken,
    signal ? { signal } : {},
  );
  if (signal?.aborted) throw abortError();

  const value = {
    items: normalizeItems(response),
    total: Number.isFinite(Number(response?.total)) ? Number(response.total) : normalizeItems(response).length,
    page: Number(response?.page || payload.page || 1),
    pageSize: Number(response?.pageSize || payload.pageSize || normalizeItems(response).length || 0),
  };
  catalogCache.set(key, { at: Date.now(), value, routes, payload });
  return value;
}
