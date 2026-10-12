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
    state.unavailableModels.clear();
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
  assert.equal(overload.__dmsGeminiModel,'gemini-test-fallback');
  assert.equal(overload.__dmsGeminiFallbackCount,1);

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

  // Un modelo retirado puede venir también de GEMINI_FALLBACK_MODELS configurado en Render.
  process.env.GEMINI_FALLBACK_MODELS = 'gemini-2.5-flash-lite,gemini-test-fallback';
  const retired = await perform([
    {status:429,body:{error:{message:'Resource exhausted'}}},
    {status:404,body:{error:{message:'This model models/gemini-2.5-flash-lite is no longer available to new users. Please update your code to use models/gemini-3.5-flash-lite.'}}},
    {status:200,body:{output_text:'Respuesta desde modelo disponible'}},
  ]);
  assert.equal(retired.status,200);
  assert.deepEqual(calls,['gemini-test-primary','gemini-2.5-flash-lite','gemini-test-fallback']);
  assert.equal(state.unavailableModels.has('gemini-2.5-flash-lite'),true);

  calls.length=0;
  scriptedResponses=[{status:200,body:{output_text:'Respuesta recuperada'}}];
  state.activeIndex=0;
  const second = await globalThis.fetch('https://generativelanguage.googleapis.com/v1beta/interactions',{
    method:'POST',body:JSON.stringify({model:'gemini-test-primary',input:'segunda consulta'}),
  });
  assert.equal(second.status,200);
  assert.deepEqual(calls,['gemini-test-fallback'], 'No vuelve a consultar modelo retirado ni principal en cooldown');
  assert.equal(second.__dmsGeminiModel,'gemini-test-fallback');

  // La lista por defecto no incluye modelos que ya no se ofrecen para nuevas cuentas.
  process.env.GEMINI_FALLBACK_MODELS='';
  const {geminiModelRouterSnapshot}=await import('../src/services/gemini-model-router.bootstrap.js');
  const snapshot=geminiModelRouterSnapshot();
  assert.deepEqual(snapshot.models,[
    'gemini-test-primary','gemini-3.5-flash-lite','gemini-3.1-flash-lite',
  ]);
  assert.equal(snapshot.models.includes('gemini-2.5-flash-lite'),false);
});
