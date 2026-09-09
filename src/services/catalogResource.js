import {
  isNetworkError,
  normalizeItems,
  OFFLINE_CATALOG_PAYLOAD,
  requestAvailable,
} from './moduleApi';
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

function normalized(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function matchesActive(row, expected) {
  if (expected === undefined) return true;
  const active = row?.Activo ?? (String(row?.Estado || 'ACTIVO').toUpperCase() !== 'INACTIVO');
  return String(active).toLowerCase() === String(expected).toLowerCase()
    && String(row?.Estado || 'ACTIVO').toUpperCase() !== 'INACTIVO';
}

function filterOfflineCatalog(response, payload = {}) {
  const query = normalized(payload.search || payload.q);
  const typeId = String(payload.tipoDispositivoId || payload.TipoDispositivoID || '').trim();
  const manufacturerId = String(payload.fabricanteId || payload.FabricanteID || '').trim();
  const clientId = String(payload.clienteId || payload.ClienteID || '').trim();
  const locationId = String(payload.ubicacionId || payload.UbicacionID || '').trim();

  let items = normalizeItems(response).filter((row) => {
    if (!matchesActive(row, payload.activo)) return false;
    if (typeId && String(row.TipoDispositivoID || row.tipoDispositivoId || '') !== typeId) return false;
    if (manufacturerId && String(row.FabricanteID || row.fabricanteId || '') !== manufacturerId) return false;
    if (clientId && String(row.ClienteID || row.clienteId || '') !== clientId) return false;
    if (locationId && String(row.UbicacionID || row.ubicacionId || '') !== locationId) return false;
    if (query && !normalized(Object.values(row || {}).join(' ')).includes(query)) return false;
    return true;
  });

  const page = Math.max(1, Number(payload.page || 1));
  const pageSize = Math.max(1, Number(payload.pageSize || items.length || 1));
  const total = items.length;
  items = items.slice((page - 1) * pageSize, page * pageSize);
  return { items, total, page, pageSize };
}

function normalizedCatalogResponse(response, payload = {}) {
  const items = normalizeItems(response);
  return {
    items,
    total: Number.isFinite(Number(response?.total)) ? Number(response.total) : items.length,
    page: Number(response?.page || payload.page || 1),
    pageSize: Number(response?.pageSize || payload.pageSize || items.length || 0),
  };
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

  const options = signal ? { signal } : {};
  let response;
  try {
    response = await requestAvailable(routes, payload, sessionToken, options);
  } catch (error) {
    const browserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (!browserOffline && !isNetworkError(error)) throw error;
    const master = await requestAvailable(
      routes,
      OFFLINE_CATALOG_PAYLOAD,
      sessionToken,
      options,
    );
    response = filterOfflineCatalog(master, payload);
  }
  if (signal?.aborted) throw abortError();

  const value = normalizedCatalogResponse(response, payload);
  catalogCache.set(key, { at: Date.now(), value, routes, payload });
  return value;
}
