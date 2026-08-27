import { AppError } from '../core/errors.js';

function clean(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function appsScriptConfig() {
  const url = clean(process.env.APPS_SCRIPT_REPORT_URL);
  const secret = clean(process.env.APPS_SCRIPT_REPORT_SECRET);
  if (!url) throw new AppError('APPS_SCRIPT_URL_MISSING', 'Falta configurar APPS_SCRIPT_REPORT_URL en el backend.', 503);
  if (!secret) throw new AppError('APPS_SCRIPT_SECRET_MISSING', 'Falta configurar APPS_SCRIPT_REPORT_SECRET en el backend.', 503);
  return { url, secret };
}

async function request(url, payload, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      throw new AppError('APPS_SCRIPT_INVALID_RESPONSE', `Apps Script respondió con un formato inválido (${response.status}).`, 502);
    }
    if (!response.ok || !parsed?.ok) {
      throw new AppError(
        parsed?.error?.code || 'APPS_SCRIPT_REQUEST_FAILED',
        parsed?.error?.message || `Apps Script rechazó la solicitud (${response.status}).`,
        502,
      );
    }
    return parsed.data || {};
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new AppError('APPS_SCRIPT_TIMEOUT', 'Apps Script tardó demasiado en responder.', 504);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendAppsScriptAction(action, payload = {}, options = {}) {
  const { url, secret } = appsScriptConfig();
  const attempts = Math.max(1, Math.min(4, Number(options.attempts || 3)));
  const timeoutMs = Math.max(10_000, Number(options.timeoutMs || process.env.APPS_SCRIPT_AGENDA_TIMEOUT_MS || 60_000));
  let lastError;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await request(url, {
        action,
        secret,
        idempotencyKey: clean(options.idempotencyKey),
        ...payload,
      }, timeoutMs);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts - 1 || Number(error?.status || 0) < 500) throw error;
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
    }
  }
  throw lastError;
}
