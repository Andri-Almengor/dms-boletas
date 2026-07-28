const APPS_SCRIPT_FALLBACK = 'https://script.google.com/macros/s/AKfycbzGZuFbXWJn3y4hbfSGRFeaJfWufu2xaDnoAb9dFZl4DklRXiuFU9-GSb-q2hnY7O6pmQ/exec';
const SAME_ORIGIN_NODE_API = '/api/action';
const READ_CACHE_MS = 15_000;
const READ_STALE_MS = 5 * 60_000;
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

function preparePayload(route, payload) {
  const value = String(route || '').toLowerCase();
  const isTicketCreate = value === 'boletas.create' || value === 'tickets.create';
  if (!isTicketCreate || payload?.boletaUid || payload?.BoletaUID) return payload;
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const uid = `boleta-${random}`;
  // Se modifica el mismo objeto para que, si la respuesta se pierde por un corte
  // de internet, la cola offline reutilice exactamente el mismo identificador.
  payload.boletaUid = uid;
  payload.BoletaUID = uid;
  return payload;
}

function requestKey(route, payload, sessionToken) {
  return `${String(route)}|${String(sessionToken)}|${JSON.stringify(payload || {})}`;
}

function wait(milliseconds) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

function transientError(error) {
  const status = Number(error?.status || 0);
  const code = String(error?.code || '').toUpperCase();
  const text = `${error?.name || ''} ${error?.message || ''}`.toLowerCase();
  return TRANSIENT_BACKEND_STATUSES.has(status)
    || code === 'BACKEND_TEMPORARILY_UNAVAILABLE'
    || text.includes('failed to fetch')
    || text.includes('networkerror')
    || text.includes('load failed');
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

async function performRequest(route, payload, sessionToken) {
  if (!API_URL) throw new Error('Falta configurar VITE_API_URL.');
  const requestPayload = preparePayload(route, payload || {});

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': isAppsScriptUrl(API_URL)
        ? 'text/plain;charset=utf-8'
        : 'application/json;charset=utf-8',
    },
    body: JSON.stringify({ route, payload: requestPayload, sessionToken }),
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

async function performRequestWithRetry(route, payload, sessionToken) {
  let lastError;
  for (let attempt = 0; attempt <= TRANSIENT_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await performRequest(route, payload, sessionToken);
    } catch (error) {
      lastError = error;
      // Los 429 de Sheets no se reintentan desde cada navegador. El backend
      // centraliza el backoff para evitar que muchos teléfonos creen una tormenta.
      if (!transientError(error) || attempt === TRANSIENT_RETRY_DELAYS_MS.length) throw error;
      await wait(TRANSIENT_RETRY_DELAYS_MS[attempt]);
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

export async function apiRequest(route, payload = {}, sessionToken = '') {
  if (!isReadRoute(route)) {
    writeEpoch += 1;
    invalidateRelatedReads(route);
    const data = await performRequestWithRetry(route, payload, sessionToken);
    notifyWriteComplete(route, payload, data);
    return data;
  }

  const key = requestKey(route, payload, sessionToken);
  const cached = recentReads.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  if (cached && cached.staleUntil <= Date.now()) recentReads.delete(key);
  if (pendingReads.has(key)) return pendingReads.get(key);

  const requestEpoch = writeEpoch;
  const request = performRequestWithRetry(route, payload, sessionToken)
    .then((data) => {
      // Si ocurrió una escritura mientras la lectura estaba en vuelo, no se
      // conserva una respuesta potencialmente anterior al cambio.
      if (requestEpoch === writeEpoch) {
        const entry = {
          route,
          data,
          expiresAt: Date.now() + READ_CACHE_MS,
          staleUntil: Date.now() + READ_STALE_MS,
        };
        recentReads.set(key, entry);
        setTimeout(() => {
          if (recentReads.get(key) === entry && entry.staleUntil <= Date.now()) recentReads.delete(key);
        }, READ_STALE_MS + 1000);
      }
      return data;
    })
    .catch((error) => {
      const stale = recentReads.get(key);
      if (isSheetsQuotaError(error) && stale && stale.staleUntil > Date.now()) {
        notifyDegradedMode(route, error);
        return stale.data;
      }
      throw error;
    })
    .finally(() => pendingReads.delete(key));

  pendingReads.set(key, request);
  return request;
}
