import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (file) => readFileSync(path.join(ROOT, file), 'utf8');

function backendProcess(script, environment = {}) {
  return execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATABASE_URL: 'postgres://unconnected:unconnected@127.0.0.1:5432/characterization',
      ...environment,
    },
    encoding: 'utf8',
    timeout: 10_000,
  }).trim();
}

test('assistant.chat uses the existing AI lane while heavy finalization remains available', () => {
  const script = `
    import assert from 'node:assert/strict';
    const {runWithActionConcurrency, actionConcurrencySnapshot} =
      await import('./backend/src/services/action-concurrency.service.js');
    let finishHeavy, finishAi;
    const heavy = runWithActionConcurrency('maintenance.finalize', () =>
      new Promise(resolve => { finishHeavy = resolve; }));
    await new Promise(resolve => setImmediate(resolve));
    const ai = runWithActionConcurrency('assistant.chat', () =>
      new Promise(resolve => { finishAi = resolve; }));
    await new Promise(resolve => setImmediate(resolve));
    const snapshot = actionConcurrencySnapshot();
    assert.equal(snapshot.heavy.active, 1);
    assert.equal(snapshot.ai.active, 1);
    assert.equal(snapshot.writes.active, 0);
    finishAi('ai ok');
    assert.equal(await ai, 'ai ok');
    assert.equal(actionConcurrencySnapshot().heavy.active, 1);
    finishHeavy('heavy ok');
    assert.equal(await heavy, 'heavy ok');
    assert.equal(actionConcurrencySnapshot().ai.active, 0);
    assert.equal(actionConcurrencySnapshot().heavy.active, 0);
    console.log('ok');
  `;
  assert.equal(backendProcess(script), 'ok');
});

test('AI backlog rejects its fifth simultaneous chat rather than accumulating indefinitely', () => {
  const script = `
    import assert from 'node:assert/strict';
    const {runWithActionConcurrency, actionConcurrencySnapshot} =
      await import('./backend/src/services/action-concurrency.service.js');
    const resolvers = [];
    const hold = () => new Promise(resolve => { resolvers.push(resolve); });
    const first = runWithActionConcurrency('assistant.chat', hold);
    const second = runWithActionConcurrency('asistente.chat', hold);
    await new Promise(resolve => setImmediate(resolve));
    const third = runWithActionConcurrency('assistant.chat', hold);
    const fourth = runWithActionConcurrency('assistant.chat', hold);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(actionConcurrencySnapshot().ai.active, 2);
    assert.equal(actionConcurrencySnapshot().ai.waiting, 2);
    await assert.rejects(
      () => runWithActionConcurrency('assistant.chat', hold),
      error => error.code === 'SERVER_BUSY' && error.status === 503
    );
    resolvers.shift()('first');
    resolvers.shift()('second');
    await new Promise(resolve => setImmediate(resolve));
    resolvers.shift()('third');
    resolvers.shift()('fourth');
    assert.deepEqual(await Promise.all([first,second,third,fourth]),
      ['first','second','third','fourth']);
    assert.equal(actionConcurrencySnapshot().ai.active, 0);
    console.log('ok');
  `;
  assert.equal(backendProcess(script, {
    HTTP_QUEUE_LIMIT: '12',
    HTTP_MAX_CONCURRENT_REQUESTS: '6',
    AI_ACTION_MAX_CONCURRENT: '2',
  }), 'ok');
});

test('request HTTP queue time feeds existing per-route metrics without sensitive payload logging', () => {
  const middleware = source('backend/src/middleware/concurrency.middleware.js');
  const app = source('backend/src/app.js');
  assert.match(middleware, /req\.dmsHttpQueueWaitMs = Math\.max\(0, performance\.now\(\) - httpQueuedAt\)/);
  assert.match(app, /observation\.markQueueWait\(req\.dmsHttpQueueWaitMs \|\| 0\)/);
});

test('Gemini timeout aliases in render.yaml are effective and explicit AI values win', () => {
  const render = source('render.yaml');
  assert.match(render, /GEMINI_TIMEOUT_MS/);
  assert.match(render, /GEMINI_TOTAL_TIMEOUT_MS/);
  const script = `
    const {aiConfig} = await import('./backend/src/ai/agent.config.js');
    console.log(JSON.stringify({request:aiConfig.requestTimeoutMs, total:aiConfig.totalTimeoutMs}));
  `;
  const legacy = JSON.parse(backendProcess(script, {
    GEMINI_TIMEOUT_MS: '65000', GEMINI_TOTAL_TIMEOUT_MS: '210000',
    AI_GEMINI_TIMEOUT_MS: '', AI_AGENT_TOTAL_TIMEOUT_MS: '',
  }));
  assert.deepEqual(legacy, { request: 65000, total: 180000 });
  const explicit = JSON.parse(backendProcess(script, {
    GEMINI_TIMEOUT_MS: '65000', GEMINI_TOTAL_TIMEOUT_MS: '210000',
    AI_GEMINI_TIMEOUT_MS: '45000', AI_AGENT_TOTAL_TIMEOUT_MS: '100000',
  }));
  assert.deepEqual(explicit, { request: 45000, total: 100000 });
});

test('assistant mixed-action envelope is never automatically replayed or cached', () => {
  const frontend = source('src/api.js');
  const readClassification = frontend.split('function isReadRoute(route) {')[1].split('function isMediaUploadRoute')[0];
  assert.doesNotMatch(readClassification, /assistant\.chat|asistente\.chat/);
  assert.match(frontend, /\['assistant\.chat', 'asistente\.chat'\]\.includes\(String\(route/);
  assert.match(frontend, /return performRequestWithRetry\(route, payload, sessionToken, \{ signal \}\);/);
  assert.match(frontend, /const retrySafe = read \|\| replaySafeAi/);
  assert.match(frontend, /createUnknownResultError/);
  const backend = source('backend/src/services/action-concurrency.service.js');
  assert.match(backend, /isAssistantChatRoute\(route\) \|\| isAiRewriteRoute\(route\)/);
  assert.doesNotMatch(backend.split('function isHeavyRoute(route) {')[1].split('function addBusyContext')[0], /assistant\.chat|asistente\.chat/);
});

test('UI shows neutral progress and elapsed time; uncertain COMMIT checks status without redoing decide', () => {
  const page = source('src/pages/assistant/AssistantPageSecure.jsx');
  assert.match(page, /setElapsedSeconds\(seconds\)/);
  assert.match(page, /elapsedSeconds/);
  assert.match(page, /role="status"/);
  assert.match(page, /sendingRef\.current = true/);
  assert.match(page, /safeStorageSet\(messagesKey/);
  assert.match(page, /safeStorageGet\(conversationKey/);
  assert.match(page, /operationError\?\.code === 'UNKNOWN_RESULT'/);
  assert.match(page, /assistantAction: 'operation\.status'/);
  assert.doesNotMatch(page, /'Buscando evidencias…'|'Consultando Base de Conocimiento…'/);
});
