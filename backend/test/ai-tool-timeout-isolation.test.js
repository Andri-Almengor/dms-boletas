import test from 'node:test';
import assert from 'node:assert/strict';

import { withTimeout, aiToolWorkSnapshot, loadDiagnosticImageInputs } from '../src/ai/agent.service.js';

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

test('a stalled Drive image never blocks later images or frees its in-flight slot early', async () => {
  let completeDrive;
  const ids = [];
  const images = [
    {__file:'fake-image-one',mimeType:'image/jpeg',size:500},
    {__file:'fake-image-two',mimeType:'image/png',size:500},
  ];
  const driveApiOverride = {files:{get:async ({fileId}) => {
    ids.push(fileId);
    if(fileId === 'fake-image-one') {
      return new Promise((resolve) => {completeDrive = resolve;});
    }
    return {data:Buffer.from('test-image')};
  }}};
  const result = await loadDiagnosticImageInputs(images, {driveApiOverride,timeoutMs:30});
  assert.deepEqual(ids,['fake-image-one','fake-image-two']);
  assert.equal(result.length,1);
  assert.equal(result[0].mime_type,'image/png');
  assert.equal(aiToolWorkSnapshot().active,1, 'the timed-out Drive request remains counted');
  completeDrive({data:Buffer.from('late-image')});
  await tick();
  assert.equal(aiToolWorkSnapshot().active,0);
});

test('when Drive supplies no usable image the assistant reports a recoverable image error', async () => {
  const input=[{__file:'fake-image-one',mimeType:'image/jpeg',size:300}];
  const driveApiOverride={files:{get:async () => {throw new Error('unavailable');}}};
  await assert.rejects(
    loadDiagnosticImageInputs(input,{driveApiOverride,timeoutMs:40}),
    error => error.code==='AI_IMAGE_UNAVAILABLE' && error.status===503,
  );
  assert.deepEqual(await loadDiagnosticImageInputs([]),[]);
});
