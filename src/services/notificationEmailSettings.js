import { apiRequest } from '../api';

const SECTION = 'NOTIFICATION_EMAILS';

export async function getNotificationEmailSettings(sessionToken, options = {}) {
  const response = await apiRequest('config.get', {
    section: SECTION,
    operation: 'GET',
  }, sessionToken, options);
  return response?.settings || {};
}

export async function saveNotificationEmailSettings(settings, sessionToken, options = {}) {
  const response = await apiRequest('config.get', {
    section: SECTION,
    operation: 'UPDATE',
    settings,
  }, sessionToken, options);
  return response?.settings || {};
}

export function emailListText(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .join('\n');
}

export function parseEmailListText(value) {
  return [...new Set(String(value || '')
    .split(/[;,\n\r]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean))];
}
