import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { concurrencyMiddleware, concurrencySnapshot } from '../src/middleware/concurrency.middleware.js';

function mockRequest(workload = '') {
  return {
    method: 'POST',
    url: '/api/action',
    headers: {
      'content-length': '300',
      ...(workload ? { 'x-dms-workload': workload } : {}),
    },
  };
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
  // The third AI request waits on assistant admission instead of occupying http-all.
  await new Promise((resolve) => setImmediate(resolve));
  const during = concurrencySnapshot();
  assert.equal(during.assistantRequests.active, 2);
  assert.equal(during.assistantRequests.waiting, 1);
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
  assert.equal(await c.passed, null);
  c.close();
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
