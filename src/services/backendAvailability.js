const HEALTH_TIMEOUT_MS = 5_000;
const RETRY_MS = 2_000;
const RETRY_SLOW_MS = 5_000;
const SLOW_AFTER_MS = 30_000;

const listeners = new Set();
let state = {
  status: import.meta.env.PROD ? 'checking' : 'ready',
  checked: !import.meta.env.PROD,
  unavailableSince: 0,
  lastReadyAt: 0,
  lastError: '',
};
let started = false;
let pollTimer = null;
let inflightProbe = null;

function snapshot() {
  return state;
}

function emit(next) {
  const previous = state;
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
  if (previous.status !== 'ready' && state.status === 'ready') {
    globalThis.dispatchEvent?.(new CustomEvent('dms-backend-recovered'));
  }
}

function clearPoll() {
  if (pollTimer) globalThis.clearTimeout(pollTimer);
  pollTimer = null;
}

function scheduleProbe() {
  if (!started || state.status === 'ready' || state.status === 'offline' || pollTimer) return;
  const elapsed = state.unavailableSince ? Date.now() - state.unavailableSince : 0;
  const delay = elapsed >= SLOW_AFTER_MS ? RETRY_SLOW_MS : RETRY_MS;
  pollTimer = globalThis.setTimeout(() => {
    pollTimer = null;
    void probeBackend();
  }, delay);
}

function offlineState() {
  clearPoll();
  emit({ status: 'offline', checked: true, lastError: 'OFFLINE' });
}

export function backendAvailabilitySnapshot() {
  return snapshot();
}

export function subscribeBackendAvailability(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function markBackendReady() {
  clearPoll();
  emit({
    status: 'ready',
    checked: true,
    unavailableSince: 0,
    lastReadyAt: Date.now(),
    lastError: '',
  });
}

export function markBackendUnavailable(error = null) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    offlineState();
    return;
  }
  const since = state.unavailableSince || Date.now();
  emit({
    status: 'waking',
    checked: true,
    unavailableSince: since,
    lastError: String(error?.code || error?.status || error?.name || 'UNAVAILABLE'),
  });
  scheduleProbe();
}

async function fetchHealth() {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch('/api/health', {
      method: 'GET',
      cache: 'no-store',
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const body = await response.json().catch(() => null);
    return body?.ok === true;
  } catch {
    return false;
  } finally {
    globalThis.clearTimeout(timer);
  }
}

export async function probeBackend({ force = false } = {}) {
  if (!import.meta.env.PROD) {
    markBackendReady();
    return true;
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    offlineState();
    return false;
  }
  if (inflightProbe && !force) return inflightProbe;

  inflightProbe = (async () => {
    const ok = await fetchHealth();
    if (ok) {
      markBackendReady();
      return true;
    }
    markBackendUnavailable({ code: 'HEALTH_UNAVAILABLE' });
    return false;
  })().finally(() => {
    inflightProbe = null;
  });

  return inflightProbe;
}

export function startBackendAvailabilityMonitor() {
  if (started) return () => {};
  started = true;

  const handleOnline = () => {
    emit({ status: 'checking', checked: false, unavailableSince: state.unavailableSince || Date.now(), lastError: '' });
    void probeBackend({ force: true });
  };
  const handleOffline = () => offlineState();
  const handleVisibility = () => {
    if (document.visibilityState === 'visible' && state.status !== 'ready') void probeBackend({ force: true });
  };

  globalThis.addEventListener?.('online', handleOnline);
  globalThis.addEventListener?.('offline', handleOffline);
  document?.addEventListener?.('visibilitychange', handleVisibility);
  void probeBackend({ force: true });

  return () => {
    started = false;
    clearPoll();
    globalThis.removeEventListener?.('online', handleOnline);
    globalThis.removeEventListener?.('offline', handleOffline);
    document?.removeEventListener?.('visibilitychange', handleVisibility);
  };
}

export function waitForBackendReady(signal) {
  if (state.status === 'ready') return Promise.resolve(true);
  startBackendAvailabilityMonitor();
  if (signal?.aborted) return Promise.reject(signal.reason || new DOMException('Aborted', 'AbortError'));

  return new Promise((resolve, reject) => {
    const unsubscribe = subscribeBackendAvailability(() => {
      if (state.status !== 'ready') return;
      cleanup();
      resolve(true);
    });
    const abort = () => {
      cleanup();
      reject(signal.reason || new DOMException('Aborted', 'AbortError'));
    };
    function cleanup() {
      unsubscribe();
      signal?.removeEventListener?.('abort', abort);
    }
    signal?.addEventListener?.('abort', abort, { once: true });
    void probeBackend();
  });
}
