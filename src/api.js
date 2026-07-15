const APPS_SCRIPT_FALLBACK = 'https://script.google.com/macros/s/AKfycbzGZuFbXWJn3y4hbfSGRFeaJfWufu2xaDnoAb9dFZl4DklRXiuFU9-GSb-q2hnY7O6pmQ/exec';
const SAME_ORIGIN_NODE_API = '/api/action';
const READ_CACHE_MS = 4000;
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

function localId(prefix) {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}

function storedUserId() {
  try {
    const session = JSON.parse(localStorage.getItem('dms_session') || '{}');
    return String(session?.user?.UsuarioID || session?.user?.id || '');
  } catch {
    return '';
  }
}

function attachOfflineOwner(payload) {
  if (!payload.OfflineOwnerID && !payload.offlineOwnerId) {
    const ownerId = storedUserId();
    if (ownerId) {
      payload.OfflineOwnerID = ownerId;
      payload.offlineOwnerId = ownerId;
    }
  }
  return payload;
}

function ensurePayloadId(payload, fields, prefix) {
  const current = fields.map((field) => payload?.[field]).find(Boolean);
  const id = String(current || localId(prefix));
  fields.forEach((field) => { payload[field] = id; });
  return payload;
}

function preparePayload(route, payload) {
  const value = String(route || '').toLowerCase();
  const ticketWrite = value.startsWith('boletas.') || value.startsWith('tickets.');
  const maintenanceWrite = value.startsWith('maintenance.') || value.startsWith('mantenimientos.');
  if ((ticketWrite || maintenanceWrite) && !isReadRoute(value)) attachOfflineOwner(payload);

  if (value === 'boletas.create' || value === 'tickets.create') {
    return ensurePayloadId(payload, ['boletaUid', 'BoletaUID'], 'boleta');
  }
  if (value === 'boletas.evidence.upload' || value === 'tickets.evidence.upload') {
    return ensurePayloadId(payload, ['evidenciaId', 'EvidenciaID'], 'evidencia');
  }
  if (value === 'maintenance.create' || value === 'mantenimientos.create') {
    return ensurePayloadId(payload, ['maintenanceId', 'MantenimientoID'], 'mantenimiento');
  }
  if (value === 'maintenance.devices.create' || value === 'mantenimientos.dispositivos.create') {
    return ensurePayloadId(payload, ['deviceId', 'EvidenciaMantenimientoID'], 'dispositivo');
  }
  if (value === 'maintenance.images.upload' || value === 'mantenimientos.imagenes.upload') {
    return ensurePayloadId(payload, ['imageId', 'FotoDispositivoID'], 'imagen');
  }

  return payload;
}

function requestKey(route, payload, sessionToken) {
  return `${String(route)}|${String(sessionToken)}|${JSON.stringify(payload || {})}`;
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

  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(`El backend respondió con un formato inválido (${response.status}).`);
  }

  if (!response.ok || !result.ok) {
    const error = new Error(result?.error?.message || `Error de comunicación con el backend (${response.status}).`);
    error.code = result?.error?.code || 'API_ERROR';
    error.details = result?.error?.details || null;
    error.status = response.status;
    throw error;
  }

  return result.data;
}

export async function apiRequest(route, payload = {}, sessionToken = '') {
  if (!isReadRoute(route)) {
    recentReads.clear();
    return performRequest(route, payload, sessionToken);
  }

  const key = requestKey(route, payload, sessionToken);
  const cached = recentReads.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  if (cached) recentReads.delete(key);
  if (pendingReads.has(key)) return pendingReads.get(key);

  const request = performRequest(route, payload, sessionToken)
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
