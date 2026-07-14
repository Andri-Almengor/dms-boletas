import { env } from '../config/env.js';
import { AsyncSemaphore } from '../core/semaphore.js';

const writes = new AsyncSemaphore({
  max: env.writeActionMaxConcurrent,
  queueLimit: env.httpQueueLimit,
  timeoutMs: env.httpQueueTimeoutMs,
});

function changesData(route) {
  const name = String(route || '').toLowerCase();
  return name.includes('.create')
    || name.includes('.update')
    || name.includes('.delete')
    || name.includes('.autosave')
    || name.includes('.reopen')
    || name.includes('.annul')
    || name.includes('.returnpending');
}

export function writeConcurrencySnapshot() {
  return writes.snapshot();
}

export async function runWriteWithConcurrency(route, operation) {
  if (!changesData(route)) return operation();
  const release = await writes.acquire();
  try {
    return await operation();
  } finally {
    release();
  }
}
