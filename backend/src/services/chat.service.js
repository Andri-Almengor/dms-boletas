import { AppError } from '../core/errors.js';
import { summarizeClientChatFacts } from './gemini.service.js';

const CLIENT_TICKET_HEADINGS = [
  '✅ REPORTE DE SEGUIMIENTO FINALIZADO',
  '🔁 REPORTE DE SEGUIMIENTO ACTUALIZADO',
];

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

function clean(value, maxLength = 3900) {
  return String(value ?? '').trim().slice(0, maxLength);
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
    const preparedText = await prepareChatText(text);
    const response = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ text: preparedText }),
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
