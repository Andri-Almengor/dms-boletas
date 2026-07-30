const MISSING_ROUTE_CODES = new Set([
  'ROUTE_NOT_FOUND',
  'ACTION_NOT_FOUND',
  'HANDLER_NOT_FOUND',
  'UNKNOWN_ACTION',
]);

const TRANSIENT_STATUSES = new Set([502, 503, 504]);

export function isAbortError(error) {
  return error?.name === 'AbortError' || String(error?.code || '').toUpperCase() === 'ABORT_ERR';
}

export function createAbortError(message = 'La solicitud fue cancelada.') {
  if (typeof DOMException === 'function') return new DOMException(message, 'AbortError');
  const error = new Error(message);
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

export function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason || createAbortError();
}

export function isMissingRouteError(error) {
  const code = String(error?.code || '').trim().toUpperCase();
  if (MISSING_ROUTE_CODES.has(code)) return true;

  const text = `${error?.code || ''} ${error?.message || ''}`.trim().toLowerCase();
  return text.includes('route_not_found')
    || text.includes('action_not_found')
    || text.includes('handler_not_found')
    || text.includes('unknown action')
    || text.includes('handler not found')
    || /(?:route|ruta|acción|accion|action|handler).*(?:not found|no encontrada|no encontrado|desconocida|desconocido)/i.test(text);
}

export function isNetworkError(error) {
  if (isAbortError(error)) return false;
  const status = Number(error?.status || 0);
  const code = String(error?.code || '').trim().toUpperCase();
  const text = `${error?.name || ''} ${error?.message || ''}`.toLowerCase();
  return TRANSIENT_STATUSES.has(status)
    || code === 'BACKEND_TEMPORARILY_UNAVAILABLE'
    || text.includes('failed to fetch')
    || text.includes('networkerror')
    || text.includes('network request failed')
    || text.includes('load failed')
    || text.includes('internet disconnected');
}
