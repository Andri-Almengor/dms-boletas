const TRANSIENT_HTTP_STATUSES = new Set([408, 409, 425, 500, 502, 503, 504]);
const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETRESET',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);
const TRANSIENT_REASONS = new Set([
  'backenderror',
  'internalerror',
  'internal',
  'serviceunavailable',
  'unavailable',
]);

function clean(value) {
  return String(value ?? '').trim();
}

export function sheetsErrorStatus(error) {
  const candidates = [
    error?.response?.status,
    error?.status,
    error?.response?.data?.error?.code,
    error?.code,
  ];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

function sheetsErrorReasons(error) {
  const values = [
    error?.reason,
    error?.response?.data?.error?.status,
    ...(Array.isArray(error?.errors) ? error.errors.map((item) => item?.reason) : []),
    ...(Array.isArray(error?.response?.data?.error?.errors)
      ? error.response.data.error.errors.map((item) => item?.reason)
      : []),
  ];
  return values.map((value) => clean(value).toLowerCase()).filter(Boolean);
}

export function isSheetsTransientError(error) {
  const status = sheetsErrorStatus(error);
  if (status === 429) return false;
  if (TRANSIENT_HTTP_STATUSES.has(status) || (status >= 500 && status <= 599)) return true;

  const code = clean(error?.code).toUpperCase();
  if (TRANSIENT_NETWORK_CODES.has(code)) return true;
  if (sheetsErrorReasons(error).some((reason) => TRANSIENT_REASONS.has(reason))) return true;

  const text = [
    error?.message,
    error?.response?.statusText,
    error?.response?.data?.error?.message,
  ].map(clean).join(' ').toLowerCase();

  return text.includes('internal error encountered')
    || text.includes('backend error')
    || text.includes('socket hang up')
    || text.includes('connection reset')
    || text.includes('network request failed')
    || text.includes('temporarily unavailable')
    || text.includes('service unavailable')
    || text.includes('timed out')
    || text.includes('timeout');
}

export function sheetsRetryAfterMs(error) {
  const headers = error?.response?.headers;
  const raw = headers?.['retry-after'] ?? headers?.get?.('retry-after') ?? 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;

  const date = Date.parse(clean(raw));
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return 0;
}

export function sheetsTransientDelayMs({
  attempt = 0,
  baseMs = 800,
  maxMs = 8_000,
  retryAfterMs = 0,
  jitterMs = 250,
  random = Math.random,
} = {}) {
  const safeAttempt = Math.max(0, Number(attempt) || 0);
  const safeBase = Math.max(50, Number(baseMs) || 800);
  const safeMax = Math.max(safeBase, Number(maxMs) || 8_000);
  const safeJitter = Math.max(0, Number(jitterMs) || 0);
  const jitter = safeJitter ? Math.floor(Math.max(0, Math.min(1, Number(random()) || 0)) * safeJitter) : 0;
  const exponential = Math.min(safeMax, safeBase * (2 ** safeAttempt) + jitter);
  return Math.max(Math.max(0, Number(retryAfterMs) || 0), exponential);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function withSheetsTransientRetry(operation, {
  retries = 2,
  baseMs = 800,
  maxMs = 8_000,
  onRetry = null,
  sleepFn = sleep,
  random = Math.random,
} = {}) {
  const maxRetries = Math.max(0, Number(retries) || 0);
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (!isSheetsTransientError(error) || attempt >= maxRetries) throw error;
      const delayMs = sheetsTransientDelayMs({
        attempt,
        baseMs,
        maxMs,
        retryAfterMs: sheetsRetryAfterMs(error),
        random,
      });
      onRetry?.({ attempt: attempt + 1, delayMs, error });
      await sleepFn(delayMs);
    }
  }

  throw lastError;
}
