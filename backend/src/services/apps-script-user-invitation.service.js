import { AppError } from '../core/errors.js';

function clean(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value).toLowerCase());
}

async function postAppsScript(url, payload) {
  const timeoutMs = Math.max(10_000, Number(process.env.APPS_SCRIPT_INVITATION_TIMEOUT_MS || 60_000));
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
      parsed = JSON.parse(text);
    } catch {
      throw new AppError(
        'APPS_SCRIPT_INVALID_RESPONSE',
        `Apps Script respondió con un formato inválido (${response.status}).`,
        502,
        { preview: text.slice(0, 300) },
      );
    }

    if (!response.ok || !parsed.ok) {
      throw new AppError(
        parsed?.error?.code || 'APPS_SCRIPT_INVITATION_FAILED',
        parsed?.error?.message || `Apps Script rechazó el envío de credenciales (${response.status}).`,
        502,
      );
    }

    return parsed.data || {};
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new AppError(
        'APPS_SCRIPT_INVITATION_TIMEOUT',
        'Apps Script tardó demasiado en enviar las credenciales temporales.',
        504,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendTemporaryCredentialsWithAppsScript(user, temporaryPassword) {
  const url = clean(process.env.APPS_SCRIPT_REPORT_URL);
  const secret = clean(process.env.APPS_SCRIPT_REPORT_SECRET);
  const email = clean(user?.Correo).toLowerCase();
  const username = clean(user?.NombreUsuario);
  const password = String(temporaryPassword || '');

  if (!url) {
    throw new AppError(
      'APPS_SCRIPT_URL_MISSING',
      'Falta configurar APPS_SCRIPT_REPORT_URL en el backend.',
      503,
    );
  }
  if (!secret) {
    throw new AppError(
      'APPS_SCRIPT_SECRET_MISSING',
      'Falta configurar APPS_SCRIPT_REPORT_SECRET en el backend.',
      503,
    );
  }
  if (!validEmail(email)) {
    throw new AppError('USER_EMAIL_INVALID', 'El usuario no tiene un correo válido para enviar sus credenciales.', 400);
  }
  if (!username || !password) {
    throw new AppError('USER_CREDENTIALS_INCOMPLETE', 'No fue posible preparar las credenciales temporales.', 500);
  }

  return postAppsScript(url, {
    action: 'user.credentials.send',
    secret,
    idempotencyKey: `user-credentials:${clean(user.UsuarioID, email)}`,
    user: {
      usuarioId: clean(user.UsuarioID),
      nombre: clean(user.NombreCompleto || user.Nombre || username, username),
      nombreUsuario: username,
      correo: email,
    },
    temporaryPassword: password,
    appUrl: clean(process.env.APP_PUBLIC_URL),
  });
}
