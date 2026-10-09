// A total deadline includes retries AND reading the response body.
export function requestTimeoutMs(route) {
  const value = String(route || '').toLowerCase();
  if (value === 'auth.login') return 20_000;
  if (value === 'auth.me') return 25_000;
  // Must stay above AI_AGENT_TOTAL_TIMEOUT_MS (max configured backend default: 120 s)
  // so the browser does not abandon a valid Gemini/tool loop first.
  if (['assistant.chat','asistente.chat'].includes(value)) return 195_000;
  // La redacción técnica puede necesitar esperar un modelo lento y luego rotar
  // a uno o más modelos alternativos. El backend tiene un presupuesto total
  // menor que esta ventana para que el navegador no abandone primero.
  if ([
    'ai.technicalrewrite',
    'gemini.technicalrewrite',
    'boletas.ai.rewrite',
    'ai.knowledgerewrite',
    'gemini.knowledgerewrite',
    'knowledge.ai.rewrite',
    'baseconocimientos.ai.rewrite',
  ].includes(value)) return 240_000;
  if (['assistant.operations.decide','asistente.operaciones.decidir'].includes(value)) return 90_000;
  if (['customercases.public.submit','casos.cliente.public.submit'].includes(value)) return 240_000;
  // Ticket finalization can wait on Drive/PDF/email. The browser deadline must
  // remain above the backend's 360 s request budget; a proxy-originated 502
  // is instead recovered by checking the server/Drive state.
  if (/finaliz|report|reporte|slides|presentacion|resend|reenviar/.test(value)) return 420_000;
  // Each resumable chunk has a separate deadline, longer than Drive's 120 s
  // backend timeout. Large videos are never held in one browser request.
  if (/upload|evidence|images|imagenes|grande/.test(value)) return 180_000;
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
