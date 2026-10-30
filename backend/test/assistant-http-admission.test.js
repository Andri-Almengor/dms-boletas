import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { concurrencyMiddleware, concurrencySnapshot } from '../src/middleware/concurrency.middleware.js';

function mockRequest(workload = '') {
  return Object.assign(new EventEmitter(), {
    method: 'POST',
    url: '/api/action',
    headers: {
      'content-length': '300',
      ...(workload ? { 'x-dms-workload': workload } : {}),
    },
  });
}

function startRequest(workload = '') {
  const req = mockRequest(workload);
  const res = new EventEmitter();
  const passed = new Promise((resolve) => {
    void concurrencyMiddleware(req, res, (error) => resolve(error || null));
  });
  return {req, res, passed, close: () => res.emit('finish')};
}

test('AI waits before the global HTTP gate and foreground requests remain admissible', async () => {
  const initial = concurrencySnapshot();
  assert.equal(initial.requests.active, 0);
  assert.equal(initial.assistantRequests.active, 0);

  const a = startRequest('assistant');
  const b = startRequest('assistant');
  await Promise.all([a.passed, b.passed]);
  const c = startRequest('assistant');
  const d = startRequest('assistant');
  // 2 concurrent + 2 queued. The fifth receives a bounded 503 instead
  // of taking another global HTTP slot or waiting without limit.
  await new Promise((resolve) => setImmediate(resolve));
  const e = startRequest('assistant');
  const fifthFailure = await e.passed;
  assert.equal(fifthFailure?.code, 'SERVER_BUSY');
  assert.equal(fifthFailure?.status, 503);
  const during = concurrencySnapshot();
  assert.equal(during.assistantRequests.active, 2);
  assert.equal(during.assistantRequests.waiting, 2);
  assert.equal(during.requests.active, 2);
  assert.equal(during.requests.waiting, 0);

  const foreground = startRequest();
  try {
    assert.equal(await foreground.passed, null);
    assert.equal(concurrencySnapshot().requests.active, 3);
  } finally {
    foreground.close();
    a.close();
    b.close();
  }
  assert.deepEqual(await Promise.all([c.passed, d.passed]), [null, null]);
  c.close();
  d.close();
  assert.equal(concurrencySnapshot().assistantRequests.active, 0);
  assert.equal(concurrencySnapshot().requests.active, 0);
});

test('hint does not apply to other routes and does not change backend authorization', async () => {
  const req = mockRequest('assistant');
  req.url = '/api/media/stream';
  req.method = 'GET';
  const res = new EventEmitter();
  const passed = new Promise((resolve) => {
    void concurrencyMiddleware(req, res, (error) => resolve(error || null));
  });
  assert.equal(await passed, null);
  assert.equal(concurrencySnapshot().assistantRequests.active, 0);
  res.emit('finish');
});

test('disconnect while a COMMIT-like action is running retains HTTP resources until backend settles', async () => {
  const committing=startRequest('assistant');
  assert.equal(await committing.passed,null);
  committing.req.dmsActionRunning=true;
  assert.equal(concurrencySnapshot().assistantRequests.active,1);
  assert.equal(concurrencySnapshot().requests.active,1);

  // The client socket disappeared AFTER the backend admitted the write.
  committing.res.emit('close');
  assert.equal(committing.req.dmsHttpAbortSignal.aborted,true);
  assert.equal(concurrencySnapshot().assistantRequests.active,1,
    'HTTP gate cannot be recycled while the critical operation is still executing');
  assert.equal(concurrencySnapshot().requests.active,1);

  // Other non-AI requests still have capacity while COMMIT works.
  const foreground=startRequest();
  assert.equal(await foreground.passed,null);
  foreground.close();
  assert.equal(concurrencySnapshot().requests.active,1);

  // Equivalent to the existing app.js finally event: only then can the
  // server release both http-all and http-assistant.
  committing.req.emit('dms-action-settled');
  assert.equal(concurrencySnapshot().assistantRequests.active,0);
  assert.equal(concurrencySnapshot().requests.active,0);
});
