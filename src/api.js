const APPS_SCRIPT_FALLBACK = 'https://script.google.com/macros/s/AKfycbzGZuFbXWJn3y4hbfSGRFeaJfWufu2xaDnoAb9dFZl4DklRXiuFU9-GSb-q2hnY7O6pmQ/exec';
const SAME_ORIGIN_NODE_API = '/api/action';
const READ_CACHE_MS = 4000;
const TRANSIENT_BACKEND_STATUSES = new Set([502, 503, 504]);
const TRANSIENT_RETRY_DELAYS_MS = [700, 1500, 2800];
const pendingReads = new Map();
const recentReads = new Map();

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

function invalidResponseError(response) {
  const temporary = TRANSIENT_BACKEND_STATUSES.has(Number(response.status));
  const error = new Error(temporary
    ? `El servidor se está reiniciando temporalmente (${response.status}). La aplicación reintentará la conexión.`
    : `El backend respondió con un formato inválido (${response.status}).`);
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
    const error = new Error(result?.error?.message || `Error de comunicación con el backend (${response.status}).`);
    error.code = result?.error?.code || (TRANSIENT_BACKEND_STATUSES.has(response.status) ? 'BACKEND_TEMPORARILY_UNAVAILABLE' : 'API_ERROR');
    error.details = result?.error?.details || null;
    error.status = response.status;
    error.retryable = TRANSIENT_BACKEND_STATUSES.has(response.status);
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
      if (!transientError(error) || attempt === TRANSIENT_RETRY_DELAYS_MS.length) throw error;
      await wait(TRANSIENT_RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastError;
}

export async function apiRequest(route, payload = {}, sessionToken = '') {
  if (!isReadRoute(route)) {
    recentReads.clear();
    return performRequestWithRetry(route, payload, sessionToken);
  }

  const key = requestKey(route, payload, sessionToken);
  const cached = recentReads.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  if (cached) recentReads.delete(key);
  if (pendingReads.has(key)) return pendingReads.get(key);

  const request = performRequestWithRetry(route, payload, sessionToken)
    .then((data) => {
      const entry = { data, expiresAt: Date.now() + READ_CACHE_MS };
      recentReads.set(key, entry);
      setTimeout(() => { if (recentReads.get(key) === entry) recentReads.delete(key); }, READ_CACHE_MS);
      return data;
    })
    .finally(() => pendingReads.delete(key));

  pendingReads.set(key, request);
  return request;
}
