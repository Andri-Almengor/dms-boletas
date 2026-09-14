import { AsyncLocalStorage } from 'node:async_hooks';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

const requestMetricsStorage = new AsyncLocalStorage();
const routeAggregates = new Map();
const tableAggregates = new Map();
const MAX_ROUTE_KEYS = 200;
const MAX_TABLE_KEYS = 120;
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

function safeRequestId(value) {
  const requestId = String(value || '').trim();
  return /^[a-zA-Z0-9._:-]{1,100}$/.test(requestId) ? requestId : '';
}

function canonicalTableName(value) {
  const table = String(value || '').trim();
  if (!table || table.length > 100 || !/^[\p{L}\p{N} _.-]+$/u.test(table)) return '__other__';
  return table;
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
    sheetsReadMs: new FixedSamples(),
    sheetsQueueMs: new FixedSamples(),
    driveMs: new FixedSamples(),
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

function tableAggregateFor(tableName) {
  const key = canonicalTableName(tableName);
  if (tableAggregates.has(key)) return tableAggregates.get(key);
  if (tableAggregates.size >= MAX_TABLE_KEYS - 1) {
    if (!tableAggregates.has('__other__')) tableAggregates.set('__other__', {
      tableName: '__other__', apiCalls: 0, requestedReads: 0, cacheHits: 0, cacheMisses: 0, inflightHits: 0, staleHits: 0, estimatedBytes: 0,
    });
    return tableAggregates.get('__other__');
  }
  const aggregate = {
    tableName: key,
    apiCalls: 0,
    requestedReads: 0,
    cacheHits: 0,
    cacheMisses: 0,
    inflightHits: 0,
    staleHits: 0,
    estimatedBytes: 0,
  };
  tableAggregates.set(key, aggregate);
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
    sheetsReadMs: value.sheetsReadMs.snapshot(),
    sheetsQueueMs: value.sheetsQueueMs.snapshot(),
    driveMs: value.driveMs.snapshot(),
    eventLoopLagMs: value.eventLoopLagMs.snapshot(),
    memory: { ...value.memory },
  };
}

function topBy(items, selector, limit = 12) {
  return [...items].sort((left, right) => selector(right) - selector(left)).slice(0, limit);
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

function numberInput(input, fallback = 0) {
  const value = Number(input);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function recordSheetsRead(input = 1) {
  const detail = typeof input === 'object' && input !== null ? input : { count: input };
  const count = numberInput(detail.count, 1);
  const durationMs = numberInput(detail.durationMs);
  const queueMs = numberInput(detail.queueMs);
  const tables = [...new Set((detail.tables || []).map(canonicalTableName).filter(Boolean))];
  const context = currentContext();
  if (context) {
    context.sheetsReadCount += count;
    context.sheetsReadMs += durationMs;
    context.sheetsQueueMs += queueMs;
    for (const table of tables) context.tables.add(table);
  }
  for (const table of tables) tableAggregateFor(table).apiCalls += count;
}

export function recordSheetsRepositoryRead({ table, source = 'miss', estimatedBytes = 0 } = {}) {
  const aggregate = tableAggregateFor(table);
  aggregate.requestedReads += 1;
  aggregate.estimatedBytes = Math.max(aggregate.estimatedBytes, numberInput(estimatedBytes));
  if (source === 'cache') aggregate.cacheHits += 1;
  else if (source === 'inflight') aggregate.inflightHits += 1;
  else if (source === 'stale') aggregate.staleHits += 1;
  else aggregate.cacheMisses += 1;
  const context = currentContext();
  context?.tables.add(canonicalTableName(table));
}

export function recordSheetsWrite(count = 1) {
  const context = currentContext();
  if (context) context.sheetsWriteCount += Math.max(0, Number(count) || 0);
}

export function recordDriveCall(input = 1) {
  const detail = typeof input === 'object' && input !== null ? input : { count: input };
  const count = numberInput(detail.count, 1);
  const durationMs = numberInput(detail.durationMs);
  const context = currentContext();
  if (context) {
    context.driveCallCount += count;
    context.driveMs += durationMs;
  }
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

export function startRouteObservation(routeName, { requestId = '' } = {}) {
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
    requestId: safeRequestId(requestId),
    sheetsReadCount: 0,
    sheetsReadMs: 0,
    sheetsQueueMs: 0,
    sheetsWriteCount: 0,
    driveCallCount: 0,
    driveMs: 0,
    cacheHit: 0,
    cacheMiss: 0,
    cacheEvictions: 0,
    tables: new Set(),
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

      const totalDurationMs = performance.now() - startedAt;
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
      aggregate.totalDurationMs.add(totalDurationMs);
      aggregate.sheetsReadMs.add(context.sheetsReadMs);
      aggregate.sheetsQueueMs.add(context.sheetsQueueMs);
      aggregate.driveMs.add(context.driveMs);
      aggregate.eventLoopLagMs.add(eventLoopLagMs);

      aggregate.memory.rssLatest = memory.rss;
      aggregate.memory.rssPeak = Math.max(aggregate.memory.rssPeak, memory.rss);
      aggregate.memory.heapUsedLatest = memory.heapUsed;
      aggregate.memory.heapUsedPeak = Math.max(aggregate.memory.heapUsedPeak, memory.heapUsed);
      aggregate.memory.externalLatest = memory.external;
      aggregate.memory.externalPeak = Math.max(aggregate.memory.externalPeak, memory.external);
      aggregate.memory.arrayBuffersLatest = memory.arrayBuffers;
      aggregate.memory.arrayBuffersPeak = Math.max(aggregate.memory.arrayBuffersPeak, memory.arrayBuffers);

      const event = totalDurationMs > 10_000 ? 'very_slow_action' : totalDurationMs > 3_000 ? 'slow_action' : 'action_perf';
      console.info(JSON.stringify({
        event,
        requestId: context.requestId || undefined,
        action: context.routeName,
        durationMs: Number(totalDurationMs.toFixed(2)),
        queueWaitMs: Number(queueWaitMs.toFixed(2)),
        handlerMs: Number(handlerDurationMs.toFixed(2)),
        sheetsReads: context.sheetsReadCount,
        sheetsReadMs: Number(context.sheetsReadMs.toFixed(2)),
        sheetsQueueMs: Number(context.sheetsQueueMs.toFixed(2)),
        sheetTables: [...context.tables].sort(),
        driveCalls: context.driveCallCount,
        driveMs: Number(context.driveMs.toFixed(2)),
        responseBytes: Math.max(0, Number(responseSize) || 0),
        status: Number(statusCode) || 0,
      }));
    },
  };
}

export function performanceMetricsSnapshot() {
  const routes = [...routeAggregates.values()].map(snapshotAggregate);
  const tables = [...tableAggregates.values()].map((entry) => ({ ...entry }));
  return {
    generatedAt: new Date().toISOString(),
    enabled: enabled(),
    routeCount: routeAggregates.size,
    routes: routes.sort((left, right) => left.routeName.localeCompare(right.routeName)),
    tables: tables.sort((left, right) => left.tableName.localeCompare(right.tableName)),
    topActionsBySheetsReads: topBy(routes, (item) => item.sheetsReadCount).map((item) => ({ action: item.routeName, sheetsReads: item.sheetsReadCount })),
    topActionsByP95: topBy(routes, (item) => item.totalDurationMs.p95).map((item) => ({ action: item.routeName, p95Ms: item.totalDurationMs.p95 })),
    topTablesByApiCalls: topBy(tables, (item) => item.apiCalls).map((item) => ({ table: item.tableName, apiCalls: item.apiCalls })),
    topTablesByBytes: topBy(tables, (item) => item.estimatedBytes).map((item) => ({ table: item.tableName, estimatedBytes: item.estimatedBytes })),
  };
}

export function resetPerformanceMetricsForTests() {
  routeAggregates.clear();
  tableAggregates.clear();
  eventLoopDelay?.reset();
}

export const PERFORMANCE_METRICS_POLICY = Object.freeze({
  maxRouteKeys: MAX_ROUTE_KEYS,
  maxTableKeys: MAX_TABLE_KEYS,
  samplesPerMetric: SAMPLE_LIMIT,
  defaultLogIntervalMs: DEFAULT_LOG_INTERVAL_MS,
  storesPayloads: false,
  storesUserIdentifiers: false,
});
