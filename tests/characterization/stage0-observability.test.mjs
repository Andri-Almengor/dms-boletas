import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PERFORMANCE_METRICS_POLICY,
  performanceMetricsSnapshot,
  recordCacheEvictions,
  recordCacheHit,
  recordCacheMiss,
  recordDriveCall,
  recordSheetsRead,
  recordSheetsWrite,
  resetPerformanceMetricsForTests,
  startRouteObservation,
} from '../../backend/src/services/performance-observability.service.js';

function withMetricsEnabled(operation) {
  const previous = process.env.PERF_METRICS_ENABLED;
  process.env.PERF_METRICS_ENABLED = '1';
  resetPerformanceMetricsForTests();
  return Promise.resolve()
    .then(operation)
    .finally(() => {
      resetPerformanceMetricsForTests();
      if (previous === undefined) delete process.env.PERF_METRICS_ENABLED;
      else process.env.PERF_METRICS_ENABLED = previous;
    });
}

test('Stage 0 observability remains disabled unless explicitly enabled', async () => {
  const previous = process.env.PERF_METRICS_ENABLED;
  delete process.env.PERF_METRICS_ENABLED;
  resetPerformanceMetricsForTests();
  try {
    const observation = startRouteObservation('maintenance.list');
    assert.equal(observation.enabled, false);
    await observation.run(async () => 'ok');
    observation.finish({ statusCode: 200, responseSize: 100 });
    assert.equal(performanceMetricsSnapshot().routes.length, 0);
  } finally {
    if (previous === undefined) delete process.env.PERF_METRICS_ENABLED;
    else process.env.PERF_METRICS_ENABLED = previous;
  }
});

test('Stage 0 observability aggregates only technical counters by route', () => withMetricsEnabled(async () => {
  const secretPayloadValue = 'usuario@example.invalid-token-123';
  const observation = startRouteObservation('maintenance.list');
  await observation.run(async () => {
    void secretPayloadValue;
    recordSheetsRead(2);
    recordSheetsWrite();
    recordDriveCall(3);
    recordCacheHit(4);
    recordCacheMiss(5);
    recordCacheEvictions(2);
  });
  observation.markQueueWait(7.5);
  observation.markHandlerDuration(12.5);
  observation.finish({ statusCode: 200, responseSize: 321 });

  const snapshot = performanceMetricsSnapshot();
  assert.equal(snapshot.routeCount, 1);
  const route = snapshot.routes[0];
  assert.equal(route.routeName, 'maintenance.list');
  assert.equal(route.requestCount, 1);
  assert.equal(route.errorCount, 0);
  assert.equal(route.sheetsReadCount, 2);
  assert.equal(route.sheetsWriteCount, 1);
  assert.equal(route.driveCallCount, 3);
  assert.equal(route.cacheHit, 4);
  assert.equal(route.cacheMiss, 5);
  assert.equal(route.cacheEvictions, 2);
  assert.equal(route.responseSize.p50, 321);
  assert.equal(route.queueWaitMs.p50, 7.5);
  assert.equal(route.handlerDurationMs.p50, 12.5);
  assert.ok(route.totalDurationMs.max >= 0);
  assert.ok(route.memory.rssLatest > 0);
  assert.equal(JSON.stringify(snapshot).includes(secretPayloadValue), false);
  assert.equal(PERFORMANCE_METRICS_POLICY.storesPayloads, false);
  assert.equal(PERFORMANCE_METRICS_POLICY.storesUserIdentifiers, false);
}));

test('Stage 0 observability isolates concurrent request counters', () => withMetricsEnabled(async () => {
  const left = startRouteObservation('agenda.list');
  const right = startRouteObservation('knowledge.list');

  await Promise.all([
    left.run(async () => {
      recordSheetsRead(2);
      await new Promise((resolve) => setTimeout(resolve, 5));
      recordDriveCall();
    }),
    right.run(async () => {
      recordSheetsWrite(3);
      recordCacheHit();
      await Promise.resolve();
    }),
  ]);

  left.finish({ statusCode: 200 });
  right.finish({ statusCode: 503 });
  const routes = new Map(performanceMetricsSnapshot().routes.map((route) => [route.routeName, route]));
  assert.equal(routes.get('agenda.list').sheetsReadCount, 2);
  assert.equal(routes.get('agenda.list').sheetsWriteCount, 0);
  assert.equal(routes.get('agenda.list').driveCallCount, 1);
  assert.equal(routes.get('knowledge.list').sheetsReadCount, 0);
  assert.equal(routes.get('knowledge.list').sheetsWriteCount, 3);
  assert.equal(routes.get('knowledge.list').cacheHit, 1);
  assert.equal(routes.get('knowledge.list').errorCount, 1);
}));

test('Stage 0 observability keeps route cardinality bounded', () => withMetricsEnabled(async () => {
  for (let index = 0; index < PERFORMANCE_METRICS_POLICY.maxRouteKeys + 25; index += 1) {
    const observation = startRouteObservation(`test.route.${index}`);
    observation.finish({ statusCode: 200 });
  }
  const snapshot = performanceMetricsSnapshot();
  assert.ok(snapshot.routeCount <= PERFORMANCE_METRICS_POLICY.maxRouteKeys);
  assert.ok(snapshot.routes.some((route) => route.routeName === '__other__'));
}));
