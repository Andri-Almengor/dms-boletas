import { env } from '../config/env.js';
import { AsyncSemaphore } from '../core/semaphore.js';

const writeActions = new AsyncSemaphore({
  name: 'action-write',
  max: env.writeActionMaxConcurrent,
  queueLimit: env.httpQueueLimit,
  timeoutMs: env.httpQueueTimeoutMs,
});

const heavyActions = new AsyncSemaphore({
  name: 'action-heavy',
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

function addBusyContext(error, route, { heavy, write }) {
  if (!error || !['SERVER_BUSY', 'SERVER_BUSY_TIMEOUT'].includes(error.code)) return error;
  error.details = {
    ...(error.details || {}),
    route: normalizedRoute(route),
    heavy,
    write,
  };
  return error;
}

export async function runWithActionConcurrency(route, operation) {
  const heavy = isHeavyRoute(route);
  const write = !isReadRoute(route);
  let releaseHeavy;
  let releaseWrite;

  try {
    // Las acciones pesadas tienen un carril exclusivo. No reservan además un
    // slot de escrituras normales durante varios minutos: las escrituras a
    // Sheets ya están serializadas por los gates internos del repositorio.
    if (heavy) {
      releaseHeavy = await heavyActions.acquire();
    } else if (write) {
      releaseWrite = await writeActions.acquire();
    }
    return await operation();
  } catch (error) {
    throw addBusyContext(error, route, { heavy, write });
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
