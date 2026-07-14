import { env } from '../config/env.js';
import { AsyncSemaphore } from '../core/semaphore.js';

const allRequests = new AsyncSemaphore({
  max: env.httpMaxConcurrentRequests,
  queueLimit: env.httpQueueLimit,
  timeoutMs: env.httpQueueTimeoutMs,
});

const largeRequests = new AsyncSemaphore({
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
    next(error);
  }
}
