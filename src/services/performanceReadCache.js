const PERFORMANCE_CACHE_PREFIX = 'perf';
export const PERFORMANCE_CACHE_MAX_AGE_MS = 2 * 60_000;
export const PERFORMANCE_CACHE_GRACE_MS = 280;

let corePromise = null;

function loadCore() {
  if (!corePromise) corePromise = import('./offlineStoreCore');
  return corePromise;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stable(value[key]);
      return result;
    }, {});
  }
  return value;
}

function sessionScope(sessionToken = '') {
  const text = String(sessionToken || 'public');
  return text.length > 18 ? text.slice(-18) : text;
}

function lastWriteKey(sessionToken = '') {
  return `dms_perf_last_write_${sessionScope(sessionToken)}`;
}

function readLastWriteAt(sessionToken = '') {
  try {
    return Number(localStorage.getItem(lastWriteKey(sessionToken)) || 0);
  } catch {
    return 0;
  }
}

export function performanceResponseCacheKey(routes, payload = {}, sessionToken = '') {
  const route = Array.isArray(routes) ? routes[0] : routes;
  return `${PERFORMANCE_CACHE_PREFIX}|${sessionScope(sessionToken)}|${String(route || '')}|${JSON.stringify(stable(payload || {}))}`;
}

export async function cachePerformanceResponse(routes, payload, sessionToken, data) {
  if (!sessionToken || data === undefined) return null;
  const core = await loadCore();
  return core.cacheResponse(
    performanceResponseCacheKey(routes, payload, sessionToken),
    { data, cachedAt: Date.now() },
  );
}

export async function readPerformanceResponse(routes, payload, sessionToken, maxAgeMs = PERFORMANCE_CACHE_MAX_AGE_MS) {
  if (!sessionToken) return null;
  const core = await loadCore();
  const entry = await core.readCachedResponse(
    performanceResponseCacheKey(routes, payload, sessionToken),
    maxAgeMs,
  );
  if (!entry || typeof entry !== 'object' || !Object.prototype.hasOwnProperty.call(entry, 'data')) return null;
  const cachedAt = Number(entry.cachedAt || 0);
  if (!cachedAt || cachedAt <= readLastWriteAt(sessionToken)) return null;
  return entry.data;
}

export function invalidatePerformanceResponses(sessionToken = '') {
  if (!sessionToken) return;
  try {
    localStorage.setItem(lastWriteKey(sessionToken), String(Date.now()));
  } catch {
    // La caché de rendimiento es complementaria y nunca debe bloquear una escritura.
  }
}

export function clearPerformanceResponseScope(sessionToken = '') {
  invalidatePerformanceResponses(sessionToken);
}

export function waitForPerformanceGrace(signal, milliseconds = PERFORMANCE_CACHE_GRACE_MS) {
  if (!signal) return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = globalThis.setTimeout(done, milliseconds);
    function done() {
      globalThis.clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}
