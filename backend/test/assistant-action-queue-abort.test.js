import test from 'node:test';
import assert from 'node:assert/strict';
import { runWithActionConcurrency, actionConcurrencySnapshot } from '../src/services/action-concurrency.service.js';

test('disconnected assistant is removed from AI queue before its operation executes', async () => {
  const release = [];
  const hold = () => new Promise(resolve => release.push(resolve));
  const a = runWithActionConcurrency('assistant.chat', hold);
  const b = runWithActionConcurrency('asistente.chat', hold);
  await new Promise(resolve => setImmediate(resolve));
  const controller = new AbortController();
  let executed = false;
  const c = runWithActionConcurrency('assistant.chat', async () => {
    executed = true;
    return 'should not run';
  }, { signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(actionConcurrencySnapshot().ai.waiting, 1);

  controller.abort(new DOMException('Client disconnected', 'AbortError'));
  await assert.rejects(c, error => error?.name === 'AbortError');
  assert.equal(actionConcurrencySnapshot().ai.waiting, 0);
  assert.equal(executed, false);

  release.shift()('a');
  release.shift()('b');
  assert.deepEqual(await Promise.all([a,b]), ['a','b']);
  assert.equal(actionConcurrencySnapshot().ai.active, 0);
});

test('disconnect after a running operation begins never cancels the operation', async () => {
  const controller = new AbortController();
  let settle;
  const action = runWithActionConcurrency('assistant.chat', () =>
    new Promise(resolve => { settle = resolve; }), { signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(actionConcurrencySnapshot().ai.active, 1);
  controller.abort(new DOMException('Disconnected', 'AbortError'));
  settle('completed by backend');
  assert.equal(await action, 'completed by backend');
  assert.equal(actionConcurrencySnapshot().ai.active, 0);
});
