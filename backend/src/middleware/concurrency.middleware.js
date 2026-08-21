import { env } from '../config/env.js';
import { AsyncSemaphore } from '../core/semaphore.js';

const allRequests = new AsyncSemaphore({
  name: 'http-all',
  max: env.httpMaxConcurrentRequests,
  queueLimit: env.httpQueueLimit,
  timeoutMs: env.httpQueueTimeoutMs,
});

const largeRequests = new AsyncSemaphore({
  name: 'http-large',
  max: env.httpMaxConcurrentLargeRequests,
  queueLimit: Math.max(10, Math.ceil(env.httpQueueLimit / 4)),
  timeoutMs: env.httpQueueTimeoutMs,
});

export function concurrencySnapshot() {
  return {
    requests: allRequests.snapshot(),
    largeRequests: largeRequests.snapshot(),
  };
}

export async function concurrencyMiddleware(req, res, next) {
  let releaseAll;
  let releaseLarge;
  try {
    const size = Number(req.headers['content-length'] || 0);
    if (size >= env.httpLargeRequestBytes) releaseLarge = await largeRequests.acquire();
    releaseAll = await allRequests.acquire();
    const release = () => {
      releaseAll?.();
      releaseLarge?.();
    };
    res.once('finish', release);
    res.once('close', release);
    next();
  } catch (error) {
    releaseAll?.();
    releaseLarge?.();
    if (error && ['SERVER_BUSY', 'SERVER_BUSY_TIMEOUT'].includes(error.code)) {
      error.details = {
        ...(error.details || {}),
        method: String(req.method || '').toUpperCase(),
        path: String(req.url || '').split('?', 1)[0],
        contentLength: Number(req.headers['content-length'] || 0),
      };
    }
    next(error);
  }
}
