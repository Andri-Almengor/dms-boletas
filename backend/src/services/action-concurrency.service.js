import { env } from '../config/env.js';
import { AsyncSemaphore } from '../core/semaphore.js';

const heavyActions = new AsyncSemaphore({
  max: env.heavyActionMaxConcurrent,
  queueLimit: Math.max(20, Math.ceil(env.httpQueueLimit / 2)),
  timeoutMs: Math.max(env.httpQueueTimeoutMs, 30000),
});

function isHeavyAction(route) {
  const name = String(route || '').toLowerCase();
  return name.includes('finalize')
    || name.includes('generatepdf')
    || name.includes('.report.')
    || name.includes('.upload')
    || name.includes('.media.get')
    || name.includes('technicalrewrite');
}

export function actionConcurrencySnapshot() {
  return heavyActions.snapshot();
}

export async function runActionWithConcurrency(route, operation) {
  if (!isHeavyAction(route)) return operation();
  const release = await heavyActions.acquire();
  try {
    return await operation();
  } finally {
    release();
  }
}
