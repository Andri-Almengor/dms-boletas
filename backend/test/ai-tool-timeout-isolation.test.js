import test from 'node:test';
import assert from 'node:assert/strict';

import { withTimeout, aiToolWorkSnapshot } from '../src/ai/agent.service.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('a timed-out AI tool retains its work slot until the underlying operation settles', async () => {
  let finish;
  const started = withTimeout(
    () => new Promise((resolve) => { finish = resolve; }),
    35, 'search_knowledge_documents',
  );
  await tick();
  assert.equal(aiToolWorkSnapshot().active, 1);
  await assert.rejects(started, (error) =>
    error.code === 'AI_TOOL_TIMEOUT' && error.status === 504);
  assert.equal(aiToolWorkSnapshot().active, 1, 'timeout must not release a live database/Drive operation');
  finish({ rows: [] });
  await tick();
  assert.equal(aiToolWorkSnapshot().active, 0);
});

test('a cancelled queued tool never starts and cannot overbook PostgreSQL slots', async () => {
  const maximum = aiToolWorkSnapshot().max;
  const releases = [];
  const holders = Array.from({length:maximum}, () =>
    withTimeout(() => new Promise((resolve) => releases.push(resolve)), 200, 'held'));
  await tick();
  assert.equal(aiToolWorkSnapshot().active, maximum);
  let executed = false;
  const queued = withTimeout(async () => {
    executed = true;
    return 'unexpected';
  }, 30, 'waiting-tool');
  await tick();
  assert.equal(aiToolWorkSnapshot().waiting, 1);
  await assert.rejects(queued, (error) => error.code === 'AI_TOOL_TIMEOUT');
  assert.equal(executed, false);
  assert.equal(aiToolWorkSnapshot().waiting, 0);
  assert.equal(aiToolWorkSnapshot().active, maximum);
  for (const resolve of releases) resolve('done');
  assert.deepEqual(await Promise.all(holders),Array(maximum).fill('done'));
  await tick();
  assert.equal(aiToolWorkSnapshot().active, 0);
});
