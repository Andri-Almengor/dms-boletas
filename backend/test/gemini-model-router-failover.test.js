import test from 'node:test';
import assert from 'node:assert/strict';

test('router Gemini rota ante saturación y JSON inválido, sin reintentar errores de solicitud', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalModel = process.env.GEMINI_MODEL;
  const originalFallbacks = process.env.GEMINI_FALLBACK_MODELS;
  process.env.GEMINI_MODEL = 'gemini-test-primary';
  process.env.GEMINI_FALLBACK_MODELS = 'gemini-test-fallback';
  const calls = [];
  let scriptedResponses = [];
  globalThis.fetch = async (_url, init) => {
    calls.push(JSON.parse(init.body).model);
    const next = scriptedResponses.shift();
    assert.ok(next, 'No debe repetir indefinidamente un modelo');
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'content-type': 'application/json' },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = originalModel;
    if (originalFallbacks === undefined) delete process.env.GEMINI_FALLBACK_MODELS;
    else process.env.GEMINI_FALLBACK_MODELS = originalFallbacks;
    delete globalThis.__DMS_GEMINI_MODEL_ROUTER_STATE__;
  });

  await import('../src/services/gemini-model-router.bootstrap.js');
  const state = globalThis.__DMS_GEMINI_MODEL_ROUTER_STATE__;
  const perform = async (responses) => {
    calls.length = 0;
    scriptedResponses = [...responses];
    state.activeIndex = 0;
    state.cooldowns.clear();
    state.quotaStrikes.clear();
    const response = await globalThis.fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      body: JSON.stringify({ model:'gemini-test-primary', input:'hola' }),
    });
    return response;
  };

  const overload = await perform([
    {status:503,body:{error:{message:'gemini-test-primary is currently overloaded'}}},
    {status:200,body:{output_text:'Respuesta recuperada'}},
  ]);
  assert.equal(overload.status,200);
  assert.deepEqual(calls,['gemini-test-primary','gemini-test-fallback']);

  const invalidJson = await perform([
    {status:502,body:{error:{message:'Model generated invalid JSON syntax and the output could not be parsed.'}}},
    {status:200,body:{output_text:'Respuesta recuperada'}},
  ]);
  assert.equal(invalidJson.status,200);
  assert.deepEqual(calls,['gemini-test-primary','gemini-test-fallback']);

  const invalidRequest = await perform([
    {status:400,body:{error:{message:'Invalid tool schema'}}},
  ]);
  assert.equal(invalidRequest.status,400);
  assert.deepEqual(calls,['gemini-test-primary']);

  const quota = await perform([
    {status:429,body:{error:{message:'Resource exhausted'}}},
    {status:200,body:{output_text:'Respuesta recuperada'}},
  ]);
  assert.equal(quota.status,200);
  assert.deepEqual(calls,['gemini-test-primary','gemini-test-fallback']);
  assert.ok(state.cooldowns.get('gemini-test-primary') > Date.now());
});
