// A total deadline includes retries AND reading the response body.
export function requestTimeoutMs(route) {
  const value = String(route || '').toLowerCase();
  if (value === 'auth.login') return 20_000;
  if (value === 'auth.me') return 25_000;
  if (/finaliz|report|reporte|slides|presentacion|resend|reenviar/.test(value)) return 240_000;
  if (/upload|evidence|images|imagenes|grande/.test(value)) return 120_000;
  return 45_000;
}
export async function withRequestDeadline(route, signal, operation, timeoutMs = requestTimeoutMs(route)) {
  const controller = new AbortController();
  const timeout = new Error('El servidor se está reconectando. Intente nuevamente en unos segundos.');
  timeout.name = 'NetworkError'; timeout.code = 'REQUEST_TIMEOUT'; timeout.retryable = true;
  let rejectAbort;
  const cancelled = new Promise((_, reject) => { rejectAbort = reject; });
  const abort = () => { controller.abort(signal.reason); rejectAbort(signal.reason); };
  if (signal?.aborted) throw signal.reason;
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { controller.abort(timeout); rejectAbort(timeout); }, timeoutMs);
  try {
    return await Promise.race([operation(controller.signal), cancelled]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
