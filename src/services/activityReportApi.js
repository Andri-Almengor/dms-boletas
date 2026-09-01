import { API_URL } from '../api';

function activityEndpoint(path) {
  const base = String(API_URL || '').trim();
  if (!base || /^https:\/\/script\.google\.com\//i.test(base)) return '';
  if (/\/api\/action\/?$/i.test(base)) return base.replace(/\/api\/action\/?$/i, `/api/activity/${path}`);
  if (/^https?:\/\//i.test(base)) {
    try {
      const url = new URL(base);
      url.pathname = `/api/activity/${path}`;
      url.search = '';
      return url.toString();
    } catch {
      return '';
    }
  }
  return `/api/activity/${path}`;
}

async function parseResponse(response) {
  const text = await response.text();
  let result = null;
  try { result = text ? JSON.parse(text) : null; } catch { /* handled below */ }
  if (!response.ok || !result?.ok) {
    const error = new Error(result?.error?.message || `No se pudo consultar el reporte de actividad (${response.status}).`);
    error.code = result?.error?.code || 'ACTIVITY_REPORT_REQUEST_FAILED';
    error.status = response.status;
    throw error;
  }
  return result.data;
}

export async function fetchActivityReport(sessionToken, filters = {}, options = {}) {
  const url = activityEndpoint('report');
  if (!url) throw new Error('Los reportes de actividad requieren el backend Node de DMS.');
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=utf-8',
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({ filters }),
    signal: options.signal,
  });
  return parseResponse(response);
}

export async function sendActivityEvent(sessionToken, event = {}, options = {}) {
  if (!sessionToken) return null;
  const url = activityEndpoint('track');
  if (!url) return null;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=utf-8',
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({ event }),
    keepalive: Boolean(options.keepalive),
    signal: options.signal,
  });
  if (!response.ok) return null;
  return parseResponse(response).catch(() => null);
}

export function activityReportingAvailable() {
  return Boolean(activityEndpoint('report'));
}
