import test from 'node:test';
import assert from 'node:assert/strict';

import { withTimeout, aiToolWorkSnapshot, loadDiagnosticImageInputs, loadChatAttachments } from '../src/ai/agent.service.js';

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

test('slow attachment metadata cannot freeze the assistant and retains its real DB slot', async () => {
  const ctx={user:{UsuarioID:'test-ai-user'},sessionToken:'test-session-token'};
  let releaseQuery;
  const queryFn=(_sql,_params) => new Promise((resolve) => {releaseQuery=resolve;});
  const request=loadChatAttachments(ctx,['fake-upload-id'],{queryFn,timeoutMs:30});
  await assert.rejects(request, error =>
    error.code==='AI_ATTACHMENTS_UNAVAILABLE' && error.status===503);
  assert.equal(aiToolWorkSnapshot().active,1);
  releaseQuery({rows:[{uploadId:'fake-upload-id',mimeType:'image/png',name:'file.png',size:300,__file:'fake-drive-file'}]});
  await tick();
  assert.equal(aiToolWorkSnapshot().active,0);
});

test('attachment metadata queries preserve user and session ownership checks', async () => {
  const ctx={user:{UsuarioID:'test-ai-user'},sessionToken:'test-session-token'};
  const data=await loadChatAttachments(ctx,['upload-a'],{
    queryFn:async (sql,params) => {
      assert.match(sql,/AND "UserID"=\$2 AND "SessionHash"=\$3/);
      assert.deepEqual(params[0],['upload-a']);
      assert.equal(params[1],'test-ai-user');
      assert.notEqual(params[2],ctx.sessionToken);
      return {rows:[{uploadId:'upload-a',mimeType:'image/jpeg',name:'evidence.jpg',size:200,__file:'file-id'}]};
    },
  });
  assert.equal(data.length,1);
  assert.equal(data[0].uploadId,'upload-a');
  await assert.rejects(
    loadChatAttachments(ctx,['not-owned'],{queryFn:async()=>({rows:[]})}),
    error => error.code==='BAD_REQUEST' || error.status===400,
  );
});
