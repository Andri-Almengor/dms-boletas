import { API_URL } from '../api';
import { isAbortError, isNetworkError, throwIfAborted } from './requestErrors';

const TRANSIENT_STATUSES = new Set([502, 503, 504]);
const RETRY_DELAYS_MS = [500, 1200];
let binaryUploadAvailable = null;

function isAppsScriptUrl(value) {
  return /^https:\/\/script\.google\.com\//i.test(String(value || ''));
}

function browserOrigin() {
  return typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : 'http://localhost';
}

function binaryEndpoint() {
  if (!API_URL || isAppsScriptUrl(API_URL)) return '';
  try {
    const url = new URL(API_URL, browserOrigin());
    const pathname = url.pathname.replace(/\/+$/, '');
    if (!pathname.endsWith('/api/action')) return '';
    url.pathname = pathname.replace(/\/api\/action$/, '/api/upload/binary');
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

function encodeMetadata(payload = {}) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload || {}));
  let binary = '';
  const step = 0x8000;
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step));
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function unavailableError() {
  const error = new Error('La carga binaria no está disponible en este backend.');
  error.code = 'BINARY_UPLOAD_UNAVAILABLE';
  error.binaryUnavailable = true;
  return error;
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
      reject(signal.reason || new DOMException('La carga fue cancelada.', 'AbortError'));
    }
    signal.addEventListener('abort', abort, { once: true });
  });
}

function invalidResponseError(response) {
  const error = new Error(`El backend respondió con un formato inválido (${response.status}).`);
  error.code = 'INVALID_BINARY_UPLOAD_RESPONSE';
  error.status = response.status;
  return error;
}

function shouldDisableBinaryEndpoint(response, result) {
  if ([405, 415].includes(Number(response.status))) return true;
  return Number(response.status) === 404 && String(result?.error?.code || '') === 'NOT_FOUND';
}

async function performBinaryRequest(route, payload, file, sessionToken, signal) {
  const endpoint = binaryEndpoint();
  if (!endpoint || binaryUploadAvailable === false) throw unavailableError();
  throwIfAborted(signal);

  const headers = {
    'Content-Type': 'application/octet-stream',
    'X-DMS-Route': String(route || ''),
    'X-DMS-Payload': encodeMetadata(payload),
  };
  if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: file,
    signal,
  });

  const text = await response.text();
  let result;
  try {
    result = text ? JSON.parse(text) : null;
  } catch {
    throw invalidResponseError(response);
  }

  if (shouldDisableBinaryEndpoint(response, result)) {
    binaryUploadAvailable = false;
    throw unavailableError();
  }
  if (!result || typeof result !== 'object') throw invalidResponseError(response);
  if (!response.ok || !result.ok) {
    const error = new Error(result?.error?.message || `Error de carga binaria (${response.status}).`);
    error.code = result?.error?.code || 'BINARY_UPLOAD_ERROR';
    error.details = result?.error?.details || null;
    error.status = response.status;
    error.retryable = TRANSIENT_STATUSES.has(Number(response.status));
    throw error;
  }

  binaryUploadAvailable = true;
  return result.data;
}

export function canUseBinaryUpload() {
  if (binaryUploadAvailable === false) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  return Boolean(binaryEndpoint());
}

export function isBinaryUploadUnavailable(error) {
  return Boolean(error?.binaryUnavailable || error?.code === 'BINARY_UPLOAD_UNAVAILABLE');
}

export async function binaryUploadRequest(route, payload, file, sessionToken = '', { signal } = {}) {
  if (!(file instanceof Blob)) {
    const error = new Error('No se recibió un archivo válido para la carga binaria.');
    error.code = 'INVALID_BINARY_FILE';
    throw error;
  }
  if (!canUseBinaryUpload()) throw unavailableError();

  let lastError;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await performBinaryRequest(route, payload, file, sessionToken, signal);
    } catch (error) {
      if (isAbortError(error) || isBinaryUploadUnavailable(error)) throw error;
      lastError = error;
      const retryable = Boolean(error?.retryable) || isNetworkError(error);
      if (!retryable || attempt === RETRY_DELAYS_MS.length) throw error;
      await wait(RETRY_DELAYS_MS[attempt], signal);
    }
  }
  throw lastError;
}
