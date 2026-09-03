const DEFAULT_MEGABYTE = 1024 * 1024;

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

export function megabytes(value) {
  return positiveInteger(value, 0) * DEFAULT_MEGABYTE;
}

export function createUploadPressureGate({
  softLimitBytes,
  reserveBytes,
  maxInFlightBytes,
  maxRequestBytes,
  memoryUsage = () => process.memoryUsage(),
  now = () => Date.now(),
} = {}) {
  const softLimit = positiveInteger(softLimitBytes, 384 * DEFAULT_MEGABYTE);
  const reserve = positiveInteger(reserveBytes, 48 * DEFAULT_MEGABYTE);
  const maxInFlight = positiveInteger(maxInFlightBytes, 64 * DEFAULT_MEGABYTE);
  const maxRequest = positiveInteger(maxRequestBytes, 32 * DEFAULT_MEGABYTE);

  let active = 0;
  let activeBytes = 0;
  let peakActive = 0;
  let peakActiveBytes = 0;
  let accepted = 0;
  let rejected = 0;
  let completed = 0;
  let failed = 0;
  let completedBytes = 0;
  let totalDurationMs = 0;
  let maximumDurationMs = 0;
  let lastRejectionReason = '';
  let lastRejectedAt = 0;

  function memorySnapshot() {
    const value = memoryUsage?.() || {};
    return {
      rss: Math.max(0, Number(value.rss || 0)),
      heapUsed: Math.max(0, Number(value.heapUsed || 0)),
      external: Math.max(0, Number(value.external || 0)),
      arrayBuffers: Math.max(0, Number(value.arrayBuffers || 0)),
    };
  }

  function normalizeRequestBytes(value) {
    const declared = Number(value || 0);
    if (!Number.isFinite(declared) || declared <= 0) return maxRequest;
    return Math.ceil(declared);
  }

  function snapshot() {
    const memory = memorySnapshot();
    return {
      active,
      activeBytes,
      peakActive,
      peakActiveBytes,
      accepted,
      rejected,
      completed,
      failed,
      completedBytes,
      averageDurationMs: completed + failed > 0
        ? Math.round(totalDurationMs / (completed + failed))
        : 0,
      maximumDurationMs,
      lastRejectionReason,
      lastRejectedAt,
      limits: {
        softLimitBytes: softLimit,
        reserveBytes: reserve,
        maxInFlightBytes: maxInFlight,
        maxRequestBytes: maxRequest,
      },
      memory,
    };
  }

  function reject(reason) {
    rejected += 1;
    lastRejectionReason = reason;
    lastRejectedAt = now();
    return { accepted: false, reason, snapshot: snapshot() };
  }

  function reserveRequest(declaredBytes) {
    const bytes = normalizeRequestBytes(declaredBytes);
    const memory = memorySnapshot();

    if (bytes > maxRequest) return reject('REQUEST_TOO_LARGE');
    if (activeBytes + bytes > maxInFlight) return reject('IN_FLIGHT_LIMIT');
    if (memory.rss + bytes + reserve > softLimit) return reject('MEMORY_PRESSURE');

    const startedAt = now();
    active += 1;
    activeBytes += bytes;
    accepted += 1;
    peakActive = Math.max(peakActive, active);
    peakActiveBytes = Math.max(peakActiveBytes, activeBytes);

    let released = false;
    return {
      accepted: true,
      bytes,
      startedAt,
      release({ ok = true } = {}) {
        if (released) return;
        released = true;
        const durationMs = Math.max(0, now() - startedAt);
        active = Math.max(0, active - 1);
        activeBytes = Math.max(0, activeBytes - bytes);
        totalDurationMs += durationMs;
        maximumDurationMs = Math.max(maximumDurationMs, durationMs);
        completedBytes += bytes;
        if (ok) completed += 1;
        else failed += 1;
      },
    };
  }

  return {
    reserve: reserveRequest,
    snapshot,
  };
}
