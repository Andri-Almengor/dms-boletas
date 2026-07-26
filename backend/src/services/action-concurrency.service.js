import { env } from '../config/env.js';
import { AsyncSemaphore } from '../core/semaphore.js';

const writeActions = new AsyncSemaphore({
  max: env.writeActionMaxConcurrent,
  queueLimit: env.httpQueueLimit,
  timeoutMs: env.httpQueueTimeoutMs,
});

const heavyActions = new AsyncSemaphore({
  max: env.heavyActionMaxConcurrent,
  queueLimit: Math.max(10, Math.ceil(env.httpQueueLimit / 3)),
  timeoutMs: Math.max(env.httpQueueTimeoutMs, 30_000),
});

function normalizedRoute(route) {
  return String(route || '').trim().toLowerCase();
}

function isReadRoute(route) {
  const value = normalizedRoute(route);
  return value === 'auth.me'
    || value === 'assistant.chat'
    || value === 'asistente.chat'
    || value === 'config.get'
    || value === 'app.config.get'
    || value.endsWith('.list')
    || value.endsWith('.get')
    || value.endsWith('.config')
    || value.includes('.media.get')
    || value.includes('.public.get');
}

function isHeavyRoute(route) {
  const value = normalizedRoute(route);
  return value.includes('assistant.chat')
    || value.includes('asistente.chat')
    || value.includes('metrics.')
    || value.includes('metricas.')
    || value.includes('finalize')
    || value.includes('finalizar')
    || value.includes('generatepdf')
    || value.includes('generate.pdf')
    || value.includes('report.')
    || value.includes('reporte.')
    || value.includes('slides')
    || value.includes('presentacion')
    || value.includes('legacy.tickets')
    || value.includes('migracion.boletas')
    || value.includes('resend')
    || value.includes('reenviar')
    || value.includes('testfinalize')
    || value.includes('probar');
}

export async function runWithActionConcurrency(route, operation) {
  const heavy = isHeavyRoute(route);
  const write = !isReadRoute(route);
  let releaseHeavy;
  let releaseWrite;

  try {
    // Todas las acciones adquieren recursos en el mismo orden para evitar
    // bloqueos cruzados entre una finalización y una escritura normal.
    if (heavy) releaseHeavy = await heavyActions.acquire();
    if (write) releaseWrite = await writeActions.acquire();
    return await operation();
  } finally {
    releaseWrite?.();
    releaseHeavy?.();
  }
}

export function actionConcurrencySnapshot() {
  return {
    writes: writeActions.snapshot(),
    heavy: heavyActions.snapshot(),
  };
}
