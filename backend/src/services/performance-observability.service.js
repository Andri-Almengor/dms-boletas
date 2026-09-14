import { AsyncLocalStorage } from 'node:async_hooks';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

const requestMetricsStorage = new AsyncLocalStorage();
const routeAggregates = new Map();
const MAX_ROUTE_KEYS = 200;
const SAMPLE_LIMIT = 128;
const DEFAULT_LOG_INTERVAL_MS = 300_000;

let eventLoopDelay = null;
let reporterTimer = null;

function enabled() {
  return /^(1|true|yes|on)$/i.test(String(process.env.PERF_METRICS_ENABLED || ''));
}

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function canonicalRouteName(value) {
  const route = String(value || '').trim();
  if (!route || route.length > 120 || !/^[a-zA-Z0-9._-]+$/.test(route)) return '__other__';
  return route;
}

function percentile(sorted, ratio) {
  if (!sorted.length) return 0;
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

class FixedSamples {
  constructor(limit = SAMPLE_LIMIT) {
    this.limit = limit;
    this.values = [];
    this.cursor = 0;
    this.max = 0;
  }

  add(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return;
    this.max = Math.max(this.max, numeric);
    if (this.values.length < this.limit) this.values.push(numeric);
    else {
      this.values[this.cursor] = numeric;
      this.cursor = (this.cursor + 1) % this.limit;
    }
  }

  snapshot() {
    const sorted = [...this.values].sort((left, right) => left - right);
    return {
      samples: sorted.length,
      p50: Number(percentile(sorted, 0.50).toFixed(2)),
      p95: Number(percentile(sorted, 0.95).toFixed(2)),
      max: Number(this.max.toFixed(2)),
    };
  }
}

function createAggregate(routeName) {
  return {
    routeName,
    requestCount: 0,
    errorCount: 0,
    sheetsReadCount: 0,
    sheetsWriteCount: 0,
    driveCallCount: 0,
    cacheHit: 0,
    cacheMiss: 0,
    cacheEvictions: 0,
    responseSize: new FixedSamples(),
    queueWaitMs: new FixedSamples(),
    handlerDurationMs: new FixedSamples(),
    totalDurationMs: new FixedSamples(),
    eventLoopLagMs: new FixedSamples(),
    memory: {
      rssLatest: 0,
      rssPeak: 0,
      heapUsedLatest: 0,
      heapUsedPeak: 0,
      externalLatest: 0,
      externalPeak: 0,
      arrayBuffersLatest: 0,
      arrayBuffersPeak: 0,
    },
  };
}

function aggregateFor(routeName) {
  const key = canonicalRouteName(routeName);
  if (routeAggregates.has(key)) return routeAggregates.get(key);
  if (routeAggregates.size >= MAX_ROUTE_KEYS - 1) {
    if (!routeAggregates.has('__other__')) routeAggregates.set('__other__', createAggregate('__other__'));
    return routeAggregates.get('__other__');
  }
  const aggregate = createAggregate(key);
  routeAggregates.set(key, aggregate);
  return aggregate;
}

function ensureEventLoopMonitor() {
  if (eventLoopDelay) return;
  eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
  eventLoopDelay.enable();
}

function snapshotAggregate(value) {
  return {
    routeName: value.routeName,
    requestCount: value.requestCount,
    errorCount: value.errorCount,
    sheetsReadCount: value.sheetsReadCount,
    sheetsWriteCount: value.sheetsWriteCount,
    driveCallCount: value.driveCallCount,
    cacheHit: value.cacheHit,
    cacheMiss: value.cacheMiss,
    cacheEvictions: value.cacheEvictions,
    responseSize: value.responseSize.snapshot(),
    queueWaitMs: value.queueWaitMs.snapshot(),
    handlerDurationMs: value.handlerDurationMs.snapshot(),
    totalDurationMs: value.totalDurationMs.snapshot(),
    eventLoopLagMs: value.eventLoopLagMs.snapshot(),
    memory: { ...value.memory },
  };
}

function ensureReporter() {
  if (reporterTimer || !enabled()) return;
  const intervalMs = boundedNumber(
    process.env.PERF_METRICS_LOG_INTERVAL_MS,
    DEFAULT_LOG_INTERVAL_MS,
    60_000,
    3_600_000,
  );
  reporterTimer = setInterval(() => {
    const snapshot = performanceMetricsSnapshot();
    if (snapshot.routes.length) console.info('[perf-metrics]', JSON.stringify(snapshot));
  }, intervalMs);
  reporterTimer.unref?.();
}

function currentContext() {
  return requestMetricsStorage.getStore() || null;
}

export function recordSheetsRead(count = 1) {
  const context = currentContext();
  if (context) context.sheetsReadCount += Math.max(0, Number(count) || 0);
}

export function recordSheetsWrite(count = 1) {
  const context = currentContext();
  if (context) context.sheetsWriteCount += Math.max(0, Number(count) || 0);
}

export function recordDriveCall(count = 1) {
  const context = currentContext();
  if (context) context.driveCallCount += Math.max(0, Number(count) || 0);
}

export function recordCacheHit(count = 1) {
  const context = currentContext();
  if (context) context.cacheHit += Math.max(0, Number(count) || 0);
}

export function recordCacheMiss(count = 1) {
  const context = currentContext();
  if (context) context.cacheMiss += Math.max(0, Number(count) || 0);
}

export function recordCacheEvictions(count = 1) {
  const context = currentContext();
  if (context) context.cacheEvictions += Math.max(0, Number(count) || 0);
}

export function startRouteObservation(routeName) {
  if (!enabled()) {
    return {
      enabled: false,
      run: (operation) => operation(),
      markQueueWait() {},
      markHandlerDuration() {},
      finish() {},
    };
  }

  ensureEventLoopMonitor();
  ensureReporter();
  const startedAt = performance.now();
  const context = {
    routeName: canonicalRouteName(routeName),
    sheetsReadCount: 0,
    sheetsWriteCount: 0,
    driveCallCount: 0,
    cacheHit: 0,
    cacheMiss: 0,
    cacheEvictions: 0,
  };
  let queueWaitMs = 0;
  let handlerDurationMs = 0;
  let finished = false;

  return {
    enabled: true,
    run: (operation) => requestMetricsStorage.run(context, operation),
    markQueueWait(value) {
      queueWaitMs += Math.max(0, Number(value) || 0);
    },
    markHandlerDuration(value) {
      handlerDurationMs += Math.max(0, Number(value) || 0);
    },
    finish({ statusCode = 200, responseSize = 0 } = {}) {
      if (finished) return;
      finished = true;

      const aggregate = aggregateFor(context.routeName);
      const memory = process.memoryUsage();
      const eventLoopLagMs = eventLoopDelay ? Number(eventLoopDelay.max || 0) / 1e6 : 0;
      aggregate.requestCount += 1;
      if (Number(statusCode) >= 400) aggregate.errorCount += 1;
      aggregate.sheetsReadCount += context.sheetsReadCount;
      aggregate.sheetsWriteCount += context.sheetsWriteCount;
      aggregate.driveCallCount += context.driveCallCount;
      aggregate.cacheHit += context.cacheHit;
      aggregate.cacheMiss += context.cacheMiss;
      aggregate.cacheEvictions += context.cacheEvictions;
      aggregate.responseSize.add(Math.max(0, Number(responseSize) || 0));
      aggregate.queueWaitMs.add(queueWaitMs);
      aggregate.handlerDurationMs.add(handlerDurationMs);
      aggregate.totalDurationMs.add(performance.now() - startedAt);
      aggregate.eventLoopLagMs.add(eventLoopLagMs);

      aggregate.memory.rssLatest = memory.rss;
      aggregate.memory.rssPeak = Math.max(aggregate.memory.rssPeak, memory.rss);
      aggregate.memory.heapUsedLatest = memory.heapUsed;
      aggregate.memory.heapUsedPeak = Math.max(aggregate.memory.heapUsedPeak, memory.heapUsed);
      aggregate.memory.externalLatest = memory.external;
      aggregate.memory.externalPeak = Math.max(aggregate.memory.externalPeak, memory.external);
      aggregate.memory.arrayBuffersLatest = memory.arrayBuffers;
      aggregate.memory.arrayBuffersPeak = Math.max(aggregate.memory.arrayBuffersPeak, memory.arrayBuffers);
    },
  };
}

export function performanceMetricsSnapshot() {
  return {
    generatedAt: new Date().toISOString(),
    enabled: enabled(),
    routeCount: routeAggregates.size,
    routes: [...routeAggregates.values()]
      .map(snapshotAggregate)
      .sort((left, right) => left.routeName.localeCompare(right.routeName)),
  };
}

export function resetPerformanceMetricsForTests() {
  routeAggregates.clear();
  eventLoopDelay?.reset();
}

export const PERFORMANCE_METRICS_POLICY = Object.freeze({
  maxRouteKeys: MAX_ROUTE_KEYS,
  samplesPerMetric: SAMPLE_LIMIT,
  defaultLogIntervalMs: DEFAULT_LOG_INTERVAL_MS,
  storesPayloads: false,
  storesUserIdentifiers: false,
});
