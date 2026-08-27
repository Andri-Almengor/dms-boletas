import { AppError } from '../core/errors.js';
import { summarizeClientChatFacts } from './gemini.service.js';

const CLIENT_TICKET_HEADINGS = [
  '✅ REPORTE DE SEGUIMIENTO FINALIZADO',
  '🔁 REPORTE DE SEGUIMIENTO ACTUALIZADO',
];
const RETRYABLE_CHAT_STATUSES = new Set([429, 500, 502, 503, 504]);

function clean(value, maxLength = 3900) {
  return String(value ?? '').trim().slice(0, maxLength);
}

export function normalizeWebhook(value) {
  let text = String(value ?? '').trim();
  if (
    text.length >= 2
    && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))
  ) {
    text = text.slice(1, -1).trim();
  }
  return text.replace(/&amp;/gi, '&').trim();
}

export function isValidWebhook(value) {
  try {
    const url = new URL(normalizeWebhook(value));
    return url.protocol === 'https:'
      && url.hostname === 'chat.googleapis.com'
      && url.pathname.includes('/messages')
      && url.searchParams.has('key')
      && url.searchParams.has('token');
  } catch {
    return false;
  }
}

function isClientTicketMessage(value) {
  const source = clean(value);
  return CLIENT_TICKET_HEADINGS.some((heading) => source.startsWith(heading));
}

function splitClientTicketMessage(value) {
  const lines = clean(value).split('\n');
  const heading = lines.shift() || CLIENT_TICKET_HEADINGS[0];
  const facts = [];
  const preserved = [];
  let preserveRest = false;

  for (const rawLine of lines) {
    const line = clean(rawLine, 1500);
    if (!line) continue;
    if (
      line.startsWith('Cada boleta conserva')
      || line.startsWith('PDF:')
      || line.startsWith('PDF boleta')
      || line.startsWith('Califique ')
      || line.startsWith('Firma única')
    ) {
      preserveRest = true;
    }
    if (preserveRest || /https?:\/\//i.test(line)) preserved.push(line);
    else facts.push(line);
  }

  return { heading, facts, preserved };
}

async function prepareChatText(value) {
  const source = clean(value);
  if (!isClientTicketMessage(source)) return source;

  const { heading, facts, preserved } = splitClientTicketMessage(source);
  if (!facts.length) return source;

  try {
    const response = await summarizeClientChatFacts(facts.join('\n'));
    const summary = clean(response?.summary, 1200);
    if (!summary) return source;
    return [
      heading,
      '',
      'Resumen del servicio:',
      summary,
      '',
      ...preserved,
    ].filter(Boolean).join('\n').slice(0, 3900);
  } catch (error) {
    // La notificación no debe fallar si Gemini está saturado o sin configurar.
    console.warn(`[chat] No se pudo generar el resumen para el cliente; se enviará el mensaje original: ${error?.message || error}`);
    return source;
  }
}

export function redactWebhook(value) {
  const normalized = normalizeWebhook(value);
  if (!isValidWebhook(normalized)) return '';
  const url = new URL(normalized);
  return `${url.origin}${url.pathname}`;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryableChatError(error) {
  const providerStatus = Number(error?.details?.status || 0);
  if (providerStatus) return RETRYABLE_CHAT_STATUSES.has(providerStatus);
  if (error?.code === 'CHAT_TIMEOUT') return true;
  if (error?.code === 'CHAT_SEND_FAILED') return false;
  return true;
}

export async function sendChatMessage(webhook, text, options = {}) {
  const normalizedWebhook = normalizeWebhook(webhook);
  if (!isValidWebhook(normalizedWebhook)) {
    throw new AppError('CHAT_NOT_CONFIGURED', 'El webhook de Google Chat no está configurado o no es válido.', 503);
  }

  // Gemini se ejecuta antes del temporizador propio de Google Chat. Así un resumen
  // lento no consume el tiempo reservado para publicar el mensaje.
  const preparedText = await prepareChatText(text);
  const timeoutMs = Math.max(3000, Number(options.timeoutMs || process.env.NOTIFICATION_TIMEOUT_MS || 15000));
  const attempts = Math.max(1, Math.min(3, Number(options.attempts || 2)));
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(normalizedWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({ text: preparedText }),
        signal: controller.signal,
      });
      const responseText = await response.text();
      if (!response.ok) {
        const error = new AppError(
          'CHAT_SEND_FAILED',
          `Google Chat rechazó el mensaje con estado ${response.status}.`,
          502,
          { status: response.status, response: responseText.slice(0, 500) },
        );
        if (attempt < attempts - 1 && RETRYABLE_CHAT_STATUSES.has(response.status)) {
          lastError = error;
          await sleep(500 * (attempt + 1));
          continue;
        }
        throw error;
      }
      let data = responseText;
      try { data = responseText ? JSON.parse(responseText) : {}; } catch { /* Conserva el texto original. */ }
      return { sent: true, status: response.status, response: data, attempts: attempt + 1 };
    } catch (error) {
      const normalizedError = error?.name === 'AbortError'
        ? new AppError('CHAT_TIMEOUT', 'Google Chat tardó demasiado en responder.', 504)
        : error;
      lastError = normalizedError;
      if (attempt < attempts - 1 && retryableChatError(normalizedError)) {
        await sleep(500 * (attempt + 1));
        continue;
      }
      throw normalizedError;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new AppError('CHAT_SEND_FAILED', 'No se pudo enviar el mensaje a Google Chat.', 502);
}