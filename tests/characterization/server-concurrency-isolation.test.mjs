import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { AsyncSemaphore } from '../../backend/src/core/semaphore.js';
import { runWithActionSingleFlight } from '../../backend/src/services/action-single-flight.service.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('el semáforo identifica el carril que se saturó', async () => {
  const semaphore = new AsyncSemaphore({ name: 'test-lane', max: 1, queueLimit: 0, timeoutMs: 100 });
  const release = await semaphore.acquire();
  await assert.rejects(
    () => semaphore.acquire(),
    (error) => {
      assert.equal(error.code, 'SERVER_BUSY');
      assert.equal(error.status, 503);
      assert.equal(error.semaphoreLane, 'test-lane');
      assert.equal(error.details?.lane, 'test-lane');
      assert.equal(error.details?.active, 1);
      return true;
    },
  );
  release();
});

test('una acción pesada no reserva además el carril de escrituras normales', () => {
  const contents = source('backend/src/services/action-concurrency.service.js');
  assert.match(contents, /name:\s*'action-heavy'/);
  assert.match(contents, /name:\s*'action-write'/);
  assert.match(contents, /if \(heavy\) \{[\s\S]*?heavyActions\.acquire\(\);[\s\S]*?\} else if \(write\) \{[\s\S]*?writeActions\.acquire\(\);/);
  assert.match(contents, /route:\s*normalizedRoute\(route\)/);
});

test('las finalizaciones duplicadas de la misma sesión comparten una sola ejecución', async () => {
  let calls = 0;
  let finish;
  const operation = () => {
    calls += 1;
    return new Promise((resolve) => { finish = resolve; });
  };
  const context = {
    route: 'maintenance.finalize',
    payload: { maintenanceId: 'M-001' },
    sessionToken: 'session-test',
  };

  const first = runWithActionSingleFlight(context, operation);
  const second = runWithActionSingleFlight(context, operation);
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);

  finish({ ok: true });
  assert.deepEqual(await first, { ok: true });
  assert.deepEqual(await second, { ok: true });

  const third = runWithActionSingleFlight(context, async () => {
    calls += 1;
    return { ok: 'again' };
  });
  assert.deepEqual(await third, { ok: 'again' });
  assert.equal(calls, 2);
});

test('modo prueba y finalización real no se mezclan en single-flight', async () => {
  let calls = 0;
  const live = runWithActionSingleFlight({
    route: 'mantenimientos.finalize',
    payload: { MantenimientoID: 'M-002' },
    sessionToken: 'same-session',
  }, async () => {
    calls += 1;
    return 'live';
  });
  const testRun = runWithActionSingleFlight({
    route: 'maintenance.finalize',
    payload: { maintenanceId: 'M-002', testMode: true },
    sessionToken: 'same-session',
  }, async () => {
    calls += 1;
    return 'test';
  });

  assert.equal(await live, 'live');
  assert.equal(await testRun, 'test');
  assert.equal(calls, 2);
});

test('el endpoint aplica single-flight antes del semáforo de acciones', () => {
  const contents = source('backend/src/app.js');
  const singleFlight = contents.indexOf('runWithActionSingleFlight({');
  const concurrency = contents.indexOf('runWithActionConcurrency(envelope.route');
  assert.ok(singleFlight >= 0, 'falta single-flight en /api/action');
  assert.ok(concurrency >= 0, 'falta el control de concurrencia de acciones');
  assert.ok(singleFlight > concurrency, 'el código debe construir la operación con concurrencia y ejecutarla a través de single-flight');
  assert.match(contents, /const execute = \(\) => runWithSheetsRouteReadCache/);
  assert.match(contents, /runWithActionSingleFlight\(\{[\s\S]*?route: envelope\.route,[\s\S]*?payload: envelope\.payload,[\s\S]*?sessionToken,/);
});
