import { env } from '../config/env.js';
import { AsyncSemaphore } from '../core/semaphore.js';

const allRequests = new AsyncSemaphore({
  name: 'http-all',
  max: env.httpMaxConcurrentRequests,
  queueLimit: env.httpQueueLimit,
  timeoutMs: env.httpQueueTimeoutMs,
});

const smallRequests = new AsyncSemaphore({ name: 'http-small', max: env.httpMaxConcurrentRequests, queueLimit: env.httpQueueLimit, timeoutMs: env.httpQueueTimeoutMs });

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
    smallRequests: smallRequests.snapshot(),
  };
}

export async function concurrencyMiddleware(req, res, next) {
  let releaseAll;
  let releaseLarge;
  let releaseSmall;
  const controller = new AbortController();
  const abort = () => controller.abort();
  res.once('close', abort);
  try {
    const size = Number(req.headers['content-length'] || 0);
    const hasBody = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const unknown = hasBody && !req.headers['content-length'];
    const encoded = req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity';
    const large = size >= env.httpLargeRequestBytes || unknown || encoded;
    // IncomingMessage stays paused while queued: no body parser runs yet.
    if (large) releaseLarge = await largeRequests.acquire({ signal: controller.signal });
    else releaseSmall = await smallRequests.acquire({ signal: controller.signal });
    // Keep one HTTP slot available to small requests under upload pressure.
    releaseAll = await allRequests.acquire({ signal: controller.signal });
    if (large) {
      const estimatedBytes = (unknown || encoded ? 50 * 1024 * 1024 : size) * 4;
      if (process.memoryUsage().rss + estimatedBytes > env.memoryBudgetMb * 1024 * 1024 * 0.9) {
        const error = new Error('El servidor está ocupado. Reintente la carga en unos segundos.');
        error.code = 'SERVER_BUSY'; error.status = 503;
        throw error;
      }
    }
    if (controller.signal.aborted) throw new Error('Client disconnected');
    const release = () => {
      releaseAll?.();
      releaseLarge?.();
      releaseSmall?.();
      res.off('close', abort);
    };
    res.once('finish', release);
    res.once('close', () => {
      // A disconnected client does not mean its Google action has stopped.
      if (req.dmsActionRunning) req.once('dms-action-settled', release);
      else release();
    });
    next();
  } catch (error) {
    releaseAll?.();
    releaseLarge?.();
    releaseSmall?.();
    res.off('close', abort);
    if (controller.signal.aborted) return;
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
