import { AppError } from '../core/errors.js';

function isValidWebhook(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:'
      && url.hostname === 'chat.googleapis.com'
      && url.pathname.includes('/messages')
      && url.searchParams.has('key')
      && url.searchParams.has('token');
  } catch {
    return false;
  }
}

export function redactWebhook(value) {
  if (!isValidWebhook(value)) return '';
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
}

export async function sendChatMessage(webhook, text, options = {}) {
  if (!isValidWebhook(webhook)) {
    throw new AppError('CHAT_NOT_CONFIGURED', 'El webhook de Google Chat no está configurado o no es válido.', 503);
  }

  const timeoutMs = Number(options.timeoutMs || process.env.NOTIFICATION_TIMEOUT_MS || 15000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ text: String(text || '').slice(0, 3900) }),
      signal: controller.signal,
    });
    const responseText = await response.text();
    if (!response.ok) {
      throw new AppError(
        'CHAT_SEND_FAILED',
        `Google Chat rechazó el mensaje con estado ${response.status}.`,
        502,
        { status: response.status, response: responseText.slice(0, 500) },
      );
    }
    let data = responseText;
    try { data = responseText ? JSON.parse(responseText) : {}; } catch { /* Conserva el texto original. */ }
    return { sent: true, status: response.status, response: data };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new AppError('CHAT_TIMEOUT', 'Google Chat tardó demasiado en responder.', 504);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
