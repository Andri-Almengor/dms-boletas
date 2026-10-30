import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';

import { app } from '../src/app.js';
import { createInteraction } from '../src/ai/agent.gemini.js';
import { aiAgentHandlers } from '../src/ai/agent.module.js';

test('backend health remains available when Gemini credentials are missing', async (t) => {
  const server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  const origin = `http://127.0.0.1:${server.address().port}`;
  const originalKey = process.env.GEMINI_API_KEY;
  try {
    delete process.env.GEMINI_API_KEY;
    await assert.rejects(
      createInteraction({ model: 'gemini-test-primary', systemInstruction:'test', input:[] }),
      error => error?.code === 'GEMINI_NOT_CONFIGURED' && error?.status === 503,
    );

    const response = await fetch(origin + '/api/health', {cache:'no-store'});
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);

    // Los detalles de PostgreSQL/colas no pueden filtrarse por el endpoint
    // de diagnóstico AI si no hay sesión administradora.
    const forbiddenHealth = await fetch(origin + '/api/ai/health', {cache:'no-store'});
    assert.equal(forbiddenHealth.status, 401);
    const unauthenticated = await forbiddenHealth.text();
    assert.doesNotMatch(unauthenticated, /dbPoolWaitMs|dbQueries|ai-tool-work|postgres/i);
  } finally {
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }
});

test('existing admin AI health exposes aggregate HTTP/AI queues without request content', async () => {
  const diagnostic = await aiAgentHandlers.health();
  assert.equal(typeof diagnostic.enabled, 'boolean');
  for (const key of ['count','windowSize','p50Ms','p95Ms','maxMs']) {
    assert.equal(typeof diagnostic.metrics.recentLatency[key], 'number');
    assert.ok(diagnostic.metrics.recentLatency[key] >= 0);
  }
  assert.equal(typeof diagnostic.modelRouter.activeModel, 'string');
  for (const key of ['availableModels','coolingModels','unavailableModels','nextRetrySeconds']) {
    assert.ok(Number.isInteger(diagnostic.modelRouter[key]),key);
    assert.ok(diagnostic.modelRouter[key] >= 0,key);
  }
  assert.ok(diagnostic.modelRouter.availableModels + diagnostic.modelRouter.coolingModels
    + diagnostic.modelRouter.unavailableModels >= diagnostic.modelsConfigured,
    'model router diagnostics must account for all configured candidates');
  assert.equal('apiKey' in diagnostic.modelRouter,false);
  assert.equal('session' in diagnostic.modelRouter,false);
  assert.equal(diagnostic.queues.httpAssistant.lane, 'http-assistant');
  assert.equal(diagnostic.queues.aiActions.lane, 'action-ai');
  assert.equal(diagnostic.queues.aiTools.lane, 'ai-tool-work');
  assert.equal(Number.isInteger(diagnostic.uptimeSeconds),true);
  assert.ok(diagnostic.uptimeSeconds >= 0);
  const expectedDbKeys = [
    'totalCount','idleCount','waitingCount','dbQueries','dbQueryMs',
    'dbRowsRead','dbRowsWritten','dbPoolWaitMs','dbErrors','dbSlowQueries',
  ];
  assert.deepEqual(Object.keys(diagnostic.postgres).sort(),expectedDbKeys.sort());
  for (const key of expectedDbKeys) {
    assert.equal(typeof diagnostic.postgres[key], 'number');
    assert.ok(Number.isFinite(diagnostic.postgres[key]));
    assert.ok(diagnostic.postgres[key] >= 0);
  }
  for (const queue of Object.values(diagnostic.queues)) {
    assert.ok(Number.isInteger(queue.active));
    assert.ok(Number.isInteger(queue.waiting));
    assert.ok(Number.isInteger(queue.max));
    assert.ok(queue.max >= 1);
    assert.equal('sessionToken' in queue, false);
    assert.equal('user' in queue, false);
    assert.equal('payload' in queue, false);
  }
});

test('admin health reflects Gemini quota cooldown without exposing API credentials or user data', async () => {
  const state=globalThis.__DMS_GEMINI_MODEL_ROUTER_STATE__;
  assert.ok(state?.cooldowns instanceof Map);
  const base=await aiAgentHandlers.health();
  const {geminiModelRouterSnapshot}=await import('../src/services/gemini-model-router.bootstrap.js');
  const target=geminiModelRouterSnapshot().models[0];
  assert.ok(target);
  const previous=state.cooldowns.get(target);
  try {
    state.cooldowns.set(target, Date.now() + 30_000);
    const diagnostics=await aiAgentHandlers.health();
    assert.ok(diagnostics.modelRouter.coolingModels>=1);
    assert.ok(diagnostics.modelRouter.nextRetrySeconds>=1);
    assert.ok(diagnostics.modelRouter.availableModels<=base.modelRouter.availableModels);
    const serialized=JSON.stringify(diagnostics);
    assert.equal(serialized.includes('apiKey'),false);
    assert.equal(serialized.includes('sessionToken'),false);
    assert.equal(serialized.includes('DATABASE_URL'),false);
  } finally {
    if(previous===undefined) state.cooldowns.delete(target);
    else state.cooldowns.set(target,previous);
  }
});
