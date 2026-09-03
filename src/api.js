import { isOfflineModeEnabled } from './services/offlineMode';
import {
  cachePerformanceResponse,
  invalidatePerformanceResponses,
  readPerformanceResponse,
  waitForPerformanceGrace,
} from './services/performanceReadCache';
import {
  createAbortError,
  isAbortError,
  isNetworkError,
  throwIfAborted,
} from './services/requestErrors';
import { createLocalId } from './utils/localId';

const APPS_SCRIPT_FALLBACK = 'https://script.google.com/macros/s/AKfycbzGZuFbXWJn3y4hbfSGRFeaJfWufu2xaDnoAb9dFZl4DklRXiuFU9-GSb-q2hnY7O6pmQ/exec';
const SAME_ORIGIN_NODE_API = '/api/action';
const READ_CACHE_MS = 15_000;
const READ_STALE_MS = 5 * 60_000;
const MAX_RECENT_READS = 120;
const TRANSIENT_BACKEND_STATUSES = new Set([502, 503, 504]);
const TRANSIENT_RETRY_DELAYS_MS = [700, 1500, 2800];
const pendingReads = new Map();
const recentReads = new Map();
let writeEpoch = 0;

export const API_URL = String(
  import.meta.env.VITE_API_URL
  || (import.meta.env.PROD ? SAME_ORIGIN_NODE_API : APPS_SCRIPT_FALLBACK),
).trim();

function isAppsScriptUrl(value) {
  return /^https:\/\/script\.google\.com\//i.test(String(value || ''));
}

function isReadRoute(route) {
  const value = String(route || '').toLowerCase();
  return value === 'auth.me'
    || value === 'assistant.chat'
    || value === 'asistente.chat'
    || value === 'config.get'
    || value === 'app.config.get'
    || value.endsWith('.list')
    || value.endsWith('.get')
    || value.endsWith('.config');
}

function isPerformanceCacheableRead(route, sessionToken) {
  if (!sessionToken) return false;
  const value = String(route || '').toLowerCase();
  if (value === 'auth.me' || value === 'assistant.chat' || value === 'asistente.chat') return false;
  return isReadRoute(route);
}

function preparePayload(route, payload) {
  const value = String(route || '').toLowerCase();
  const isTicketCreate = value === 'boletas.create' || value === 'tickets.create';
  if (!isTicketCreate || payload?.boletaUid || payload?.BoletaUID) return payload;
  const uid = createLocalId('boleta');
  payload.boletaUid = uid;
  payload.BoletaUID = uid;
  return payload;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stableValue(value[key]);
      return result;
    }, {});
  }
  return value;
}

function requestKey(route, payload, sessionToken) {
  return `${String(route)}|${String(sessionToken)}|${JSON.stringify(stableValue(payload || {}))}`;
}

function wait(milliseconds, signal) {
  if (!signal) return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    function abort() {
      globalThis.clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(signal.reason || createAbortError());
    }
    signal.addEventListener('abort', abort, { once: true });
  });
}

function transientError(error) {
  return isNetworkError(error);
}

function onlineRequiredError(originalError = null) {
  const error = new Error('No se pudo conectar al servidor. El modo sin conexión está desactivado en este dispositivo.');
  error.name = 'Error';
  error.code = 'ONLINE_REQUIRED';
  error.status = Number(originalError?.status || 0);
  error.retryable = false;
  error.cause = originalError || undefined;
  return error;
}

function isSheetsQuotaError(error) {
  return Number(error?.status || 0) === 429
    || String(error?.code || '').toUpperCase() === 'SHEETS_QUOTA_EXCEEDED';
}

function invalidResponseError(response) {
  const temporary = TRANSIENT_BACKEND_STATUSES.has(Number(response.status));
  const error = new Error(temporary
    ? `El servidor se está reiniciando temporalmente (${response.status}). La aplicación reintentará la conexión.`
    : `El backend respondió con un formato inválido (${response.status}).`);
  error.name = temporary ? 'NetworkError' : 'Error';
  error.code = temporary ? 'BACKEND_TEMPORARILY_UNAVAILABLE' : 'INVALID_BACKEND_RESPONSE';
  error.status = response.status;
  error.retryable = temporary;
  return error;
}

async function performRequest(route, payload, sessionToken, { signal } = {}) {
  if (!API_URL) throw new Error('Falta configurar VITE_API_URL.');
  throwIfAborted(signal);
  const requestPayload = preparePayload(route, payload || {});

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': isAppsScriptUrl(API_URL)
        ? 'text/plain;charset=utf-8'
        : 'application/json;charset=utf-8',
    },
    body: JSON.stringify({ route, payload: requestPayload, sessionToken }),
    signal,
  });

  const responseText = await response.text();
  let result;
  try {
    result = responseText ? JSON.parse(responseText) : null;
  } catch {
    throw invalidResponseError(response);
  }

  if (!result || typeof result !== 'object') throw invalidResponseError(response);

  if (!response.ok || !result.ok) {
    const temporary = TRANSIENT_BACKEND_STATUSES.has(response.status);
    const error = new Error(result?.error?.message || `Error de comunicación con el backend (${response.status}).`);
    error.name = temporary ? 'NetworkError' : 'Error';
    error.code = result?.error?.code || (temporary ? 'BACKEND_TEMPORARILY_UNAVAILABLE' : 'API_ERROR');
    error.details = result?.error?.details || null;
    error.status = response.status;
    error.retryAfterSeconds = Number(response.headers.get('retry-after') || error.details?.retryAfterSeconds || 0);
    error.retryable = temporary;
    throw error;
  }

  return result.data;
}

async function performRequestWithRetry(route, payload, sessionToken, { signal } = {}) {
  throwIfAborted(signal);
  if (typeof navigator !== 'undefined' && navigator.onLine === false && !isOfflineModeEnabled()) {
    throw onlineRequiredError();
  }

  let lastError;
  for (let attempt = 0; attempt <= TRANSIENT_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await performRequest(route, payload, sessionToken, { signal });
    } catch (error) {
      if (isAbortError(error)) throw error;
      lastError = error;
      const retryable = transientError(error);
      if (!retryable || attempt === TRANSIENT_RETRY_DELAYS_MS.length) {
        if (retryable && !isOfflineModeEnabled()) throw onlineRequiredError(error);
        throw error;
      }
      await wait(TRANSIENT_RETRY_DELAYS_MS[attempt], signal);
    }
  }
  throw lastError;
}

function writeFamilies(route) {
  const value = String(route || '').toLowerCase();
  if (/(maintenance|mantenimientos)/.test(value)) return ['maintenance', 'mantenimientos', 'metricas.mantenimientos', 'metrics.maintenance', 'assistant', 'asistente'];
  if (/(boletas|tickets)/.test(value)) return ['boletas', 'tickets', 'metricas.boletas', 'metrics.tickets', 'survey', 'encuesta', 'assistant', 'asistente'];
  if (/(clients|clientes|ubicaciones|contacts|contactos)/.test(value)) return ['clients', 'clientes', 'ubicaciones', 'contacts', 'contactos', 'maintenance', 'mantenimientos', 'boletas', 'tickets', 'assistant', 'asistente'];
  if (/(catalog|categor|deviceTypes|tiposDispositivo|manufacturers|fabricantes|models|modelos|failureTypes|tiposFalla)/i.test(value)) return ['catalog', 'categor', 'devicetypes', 'tiposdispositivo', 'manufacturers', 'fabricantes', 'models', 'modelos', 'failuretypes', 'tiposfalla', 'maintenance', 'mantenimientos', 'assistant', 'asistente'];
  if (/(knowledge|conocimiento|tutorial)/.test(value)) return ['knowledge', 'conocimiento', 'tutorial', 'assistant', 'asistente'];
  if (/(users|usuarios|roles|permissions|permisos|auth)/.test(value)) return ['*'];
  return [value.split('.')[0]];
}

function invalidateRelatedReads(route) {
  const families = writeFamilies(route);
  if (families.includes('*')) {
    recentReads.clear();
    return;
  }
  for (const [key, entry] of recentReads.entries()) {
    const readRoute = String(entry.route || key).toLowerCase();
    if (families.some((family) => family && readRoute.includes(family))) recentReads.delete(key);
  }
}

function pruneRecentReads(now = Date.now()) {
  for (const [key, entry] of recentReads.entries()) {
    if (Number(entry.staleUntil || 0) <= now) recentReads.delete(key);
  }
  if (recentReads.size <= MAX_RECENT_READS) return;
  const oldest = [...recentReads.entries()]
    .sort((left, right) => Number(left[1].lastAccess || 0) - Number(right[1].lastAccess || 0));
  oldest.slice(0, recentReads.size - MAX_RECENT_READS).forEach(([key]) => recentReads.delete(key));
}

function notifyWriteComplete(route, payload, data) {
  try {
    const value = String(route || '').toLowerCase();
    const detail = {
      route: String(route || ''),
      clientId: String(payload?.ClienteID || payload?.clienteId || data?.ClienteID || data?.clienteId || ''),
      locationId: String(payload?.UbicacionID || payload?.ubicacionId || data?.UbicacionID || data?.ubicacionId || ''),
      equipmentLocationId: String(payload?.UbicacionEquipoID || payload?.ubicacionEquipoId || data?.UbicacionEquipoID || data?.ubicacionEquipoId || ''),
      contactId: String(payload?.ContactoID || payload?.contactoId || data?.ContactoID || data?.contactoId || ''),
    };
    globalThis.dispatchEvent?.(new CustomEvent('dms-api-write-complete', { detail }));
    if (/(clients|clientes|clientlocations|ubicacionescliente|equipmentlocations|ubicacionesequipo|contacts|contactos)/.test(value)) {
      globalThis.dispatchEvent?.(new CustomEvent('dms-client-relations-updated', { detail }));
    }
  } catch {
    // La sincronización visual es complementaria; nunca debe cancelar la escritura confirmada.
  }
}

function notifyDegradedMode(route, error) {
  try {
    globalThis.dispatchEvent?.(new CustomEvent('dms-sheets-degraded', {
      detail: {
        route,
        message: 'Se muestran datos recientes guardados mientras Google Sheets recupera disponibilidad.',
        retryAfterSeconds: error?.retryAfterSeconds || error?.details?.retryAfterSeconds || 60,
      },
    }));
  } catch {
    // La notificación visual es opcional; nunca debe bloquear la lectura.
  }
}

function notifyPerformanceCacheUsed(route) {
  try {
    globalThis.dispatchEvent?.(new CustomEvent('dms-performance-cache-used', { detail: { route } }));
  } catch {
    // La señal visual es complementaria.
  }
}

function notifyPerformanceRevalidated(route, data) {
  try {
    globalThis.dispatchEvent?.(new CustomEvent('dms-performance-cache-updated', { detail: { route, data } }));
  } catch {
    // La actualización de caché nunca debe afectar la lectura principal.
  }
}

async function executeRead(route, payload, sessionToken, key, requestEpoch, signal) {
  try {
    const data = await performRequestWithRetry(route, payload, sessionToken, { signal });
    if (requestEpoch === writeEpoch) {
      const savedAt = Date.now();
      recentReads.set(key, {
        route,
        data,
        expiresAt: savedAt + READ_CACHE_MS,
        staleUntil: savedAt + READ_STALE_MS,
        lastAccess: savedAt,
      });
      pruneRecentReads(savedAt);
      if (isPerformanceCacheableRead(route, sessionToken)) {
        cachePerformanceResponse(route, payload, sessionToken, data).catch(() => {});
        notifyPerformanceRevalidated(route, data);
      }
    }
    return data;
  } catch (error) {
    if (isAbortError(error)) throw error;
    const stale = recentReads.get(key);
    if (isSheetsQuotaError(error) && stale && stale.staleUntil > Date.now()) {
      stale.lastAccess = Date.now();
      notifyDegradedMode(route, error);
      return stale.data;
    }
    throw error;
  }
}

async function preferPersistentCacheWhenSlow(route, payload, sessionToken, request, signal) {
  if (!isPerformanceCacheableRead(route, sessionToken)) return request;

  const cachedAfterGrace = Promise.all([
    readPerformanceResponse(route, payload, sessionToken).catch(() => null),
    waitForPerformanceGrace(signal),
  ]).then(([data]) => ({ source: 'cache', data }));

  const network = request.then((data) => ({ source: 'network', data }));
  const winner = await Promise.race([network, cachedAfterGrace]);
  if (winner.source === 'network') return winner.data;
  throwIfAborted(signal);
  if (winner.data === null) return request;
  notifyPerformanceCacheUsed(route);
  return winner.data;
}

export async function apiRequest(route, payload = {}, sessionToken = '', options = {}) {
  const signal = options?.signal;
  throwIfAborted(signal);

  if (!isReadRoute(route)) {
    writeEpoch += 1;
    invalidateRelatedReads(route);
    const data = await performRequestWithRetry(route, payload, sessionToken, { signal });
    invalidatePerformanceResponses(sessionToken);
    notifyWriteComplete(route, payload, data);
    return data;
  }

  const now = Date.now();
  pruneRecentReads(now);
  const key = requestKey(route, payload, sessionToken);
  const cached = recentReads.get(key);
  if (cached && cached.expiresAt > now) {
    cached.lastAccess = now;
    return cached.data;
  }
  if (cached && cached.staleUntil <= now) recentReads.delete(key);

  // Las lecturas sin señal comparten una única petición. Las lecturas cancelables
  // conservan su propio fetch para que AbortController pueda detener la red real.
  if (!signal && pendingReads.has(key)) return pendingReads.get(key);

  const requestEpoch = writeEpoch;
  const request = executeRead(route, payload, sessionToken, key, requestEpoch, signal);
  const resolved = preferPersistentCacheWhenSlow(route, payload, sessionToken, request, signal);
  if (signal) return resolved;

  const sharedRequest = resolved.finally(() => pendingReads.delete(key));
  pendingReads.set(key, sharedRequest);
  return sharedRequest;
}
