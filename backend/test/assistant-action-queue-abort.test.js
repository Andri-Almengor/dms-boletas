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

test('operation.status remains readable while the Gemini action lane is saturated', async () => {
  const release = [];
  const hold = () => new Promise(resolve => { release.push(resolve); });
  const active = [
    runWithActionConcurrency('assistant.chat',hold),
    runWithActionConcurrency('asistente.chat',hold),
  ];
  await new Promise(resolve=>setImmediate(resolve));
  const waiting = [
    runWithActionConcurrency('assistant.chat',hold),
    runWithActionConcurrency('assistant.chat',hold),
  ];
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(actionConcurrencySnapshot().ai.active,2);
  assert.equal(actionConcurrencySnapshot().ai.waiting,2);
  try {
    // Estado y autorización se resuelven en action-router/findOperation;
    // la selección del carril no concede acceso a una operación.
    const status = await runWithActionConcurrency('assistant.chat',async()=> 'COMMITTING',
      {assistantAction:'operation.status'});
    assert.equal(status,'COMMITTING');
    assert.equal(actionConcurrencySnapshot().ai.active,2);
    assert.equal(actionConcurrencySnapshot().ai.waiting,2);
    await assert.rejects(
      () => runWithActionConcurrency('assistant.chat',async()=> 'must-not-commit',
        {assistantAction:'operation.decide'}),
      error=>error.code==='SERVER_BUSY' && error.status===503,
    );
    await assert.rejects(
      () => runWithActionConcurrency('assistant.chat',async()=> 'must-not-revise',
        {assistantAction:'operation.revise'}),
      error=>error.code==='SERVER_BUSY' && error.status===503,
    );
  } finally {
    release.splice(0,2).forEach(resolve=>resolve('completed'));
    await new Promise(resolve=>setImmediate(resolve));
    release.splice(0,2).forEach(resolve=>resolve('queued-completed'));
    await Promise.all([...active,...waiting]);
  }
  assert.equal(actionConcurrencySnapshot().ai.active,0);
  assert.equal(actionConcurrencySnapshot().ai.waiting,0);
});

test('assistant attachment transfers use existing upload lane even when Gemini queue is full', async () => {
  const resolveAi=[];
  const hold=()=>new Promise(resolve=>{resolveAi.push(resolve);});
  const active=[
    runWithActionConcurrency('assistant.chat',hold),
    runWithActionConcurrency('asistente.chat',hold),
  ];
  await new Promise(resolve=>setImmediate(resolve));
  const waiting=[
    runWithActionConcurrency('assistant.chat',hold),
    runWithActionConcurrency('assistant.chat',hold),
  ];
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(actionConcurrencySnapshot().ai.active,2);
  assert.equal(actionConcurrencySnapshot().ai.waiting,2);

  try {
    const init=await runWithActionConcurrency('assistant.chat',async()=>{
      assert.equal(actionConcurrencySnapshot().uploads.active,1);
      return 'upload initialized';
    },{assistantAction:'attachment.init'});
    const chunk=await runWithActionConcurrency('asistente.chat',async()=>{
      assert.equal(actionConcurrencySnapshot().uploads.active,1);
      return 'chunk saved';
    },{assistantAction:'attachment.chunk'});
    assert.equal(init,'upload initialized');
    assert.equal(chunk,'chunk saved');
    assert.equal(actionConcurrencySnapshot().ai.active,2);
    assert.equal(actionConcurrencySnapshot().ai.waiting,2);
    assert.equal(actionConcurrencySnapshot().uploads.active,0);
  } finally {
    resolveAi.splice(0,2).forEach(resolve=>resolve('active finished'));
    await new Promise(resolve=>setImmediate(resolve));
    resolveAi.splice(0,2).forEach(resolve=>resolve('queued finished'));
    await Promise.all([...active,...waiting]);
  }
  assert.equal(actionConcurrencySnapshot().ai.active,0);
});
