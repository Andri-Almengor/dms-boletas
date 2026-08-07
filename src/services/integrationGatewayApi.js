import { API_URL } from '../api';

function integrationBaseUrl() {
  if (/script\.google\.com/i.test(API_URL)) {
    throw new Error('La administración de gateways requiere el backend Node.js de DMS-Boletas.');
  }
  const actionUrl = new URL(API_URL, globalThis.location?.origin || 'http://localhost');
  return new URL('/api/integration-gateway', actionUrl.origin).toString().replace(/\/$/, '');
}

async function request(path, { sessionToken, body, method = 'GET', signal } = {}) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const error = new Error('La administración de gateways requiere conexión a internet.');
    error.code = 'ONLINE_REQUIRED';
    throw error;
  }
  const response = await fetch(`${integrationBaseUrl()}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${String(sessionToken || '')}`,
      ...(body ? { 'Content-Type': 'application/json;charset=utf-8' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  const text = await response.text();
  let result = null;
  try { result = text ? JSON.parse(text) : null; } catch { /* handled below */ }
  if (!response.ok || !result?.ok) {
    const error = new Error(result?.error?.message || `El servidor respondió ${response.status}.`);
    error.code = result?.error?.code || 'INTEGRATION_GATEWAY_REQUEST_FAILED';
    error.status = response.status;
    error.details = result?.error?.details || null;
    throw error;
  }
  return result.data;
}

export function getIntegrationGatewayOverview(sessionToken, options = {}) {
  return request('/admin/overview', { sessionToken, signal: options.signal });
}

export function provisionIntegrationGateway(payload, sessionToken, options = {}) {
  return request('/admin/provision', {
    method: 'POST',
    body: payload,
    sessionToken,
    signal: options.signal,
  });
}

export function revealIntegrationGatewayToken(gatewayId, sessionToken, options = {}) {
  return request('/admin/credentials/reveal', {
    method: 'POST',
    body: { gatewayId },
    sessionToken,
    signal: options.signal,
  });
}

export function revokeIntegrationGateway(gatewayId, sessionToken, options = {}) {
  return request('/admin/revoke', {
    method: 'POST',
    body: { gatewayId },
    sessionToken,
    signal: options.signal,
  });
}

export function sendIntegrationGatewayCommand(gatewayId, type, sessionToken, options = {}) {
  return request('/admin/commands', {
    method: 'POST',
    body: { gatewayId, type, payload: options.payload || {} },
    sessionToken,
    signal: options.signal,
  });
}

export function updateIntegrationDeviceName(deviceId, name, sessionToken, options = {}) {
  return request('/admin/devices/name', {
    method: 'POST',
    body: { deviceId, name },
    sessionToken,
    signal: options.signal,
  });
}

export function updateIntegrationDeviceProfile(payload, sessionToken, options = {}) {
  return request('/admin/devices/profile', {
    method: 'POST',
    body: payload,
    sessionToken,
    signal: options.signal,
  });
}
