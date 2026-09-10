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
  queueLimit: env.httpLargeQueueLimit,
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
  const queuedAbort = new AbortController();
  const abortQueuedRequest = () => queuedAbort.abort();
  req.once('aborted', abortQueuedRequest);

  try {
    const size = Number(req.headers['content-length'] || 0);
    if (size >= env.httpLargeRequestBytes) {
      releaseLarge = await largeRequests.acquire({ signal: queuedAbort.signal });
    }
    releaseAll = await allRequests.acquire({ signal: queuedAbort.signal });
    req.removeListener('aborted', abortQueuedRequest);

    const release = () => {
      releaseAll?.();
      releaseLarge?.();
      releaseAll = null;
      releaseLarge = null;
    };
    res.once('finish', release);
    res.once('close', release);
    next();
  } catch (error) {
    req.removeListener('aborted', abortQueuedRequest);
    releaseAll?.();
    releaseLarge?.();
    if (error?.code === 'QUEUE_ABORTED') return;
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
