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
    if (next.hang) return new Promise((resolve, reject) => {
      // Timer de prueba referenciado para simular una conexión que no responde.
      const slow = setTimeout(() => resolve(new Response('{}', { status: 504 })), 1_000);
      const abort = () => {
        clearTimeout(slow);
        reject(init.signal.reason || new DOMException('Aborted', 'AbortError'));
      };
      if (init.signal.aborted) abort();
      else init.signal.addEventListener('abort', abort, { once: true });
    });
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
  const perform = async (responses, fetchOptions = {}) => {
    calls.length = 0;
    scriptedResponses = [...responses];
    state.activeIndex = 0;
    state.cooldowns.clear();
    state.quotaStrikes.clear();
    state.unavailableModels.clear();
    const response = await globalThis.fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      body: JSON.stringify({ model:'gemini-test-primary', input:'hola' }), ...fetchOptions,
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

  // La primera llamada nunca responde: el router cancela ese intento,
  // rota al siguiente y conserva el presupuesto global (sin tocar un COMMIT).
  const timedOut = await perform([
    {hang:true},
    {status:200,body:{output_text:'Fallback después de timeout'}},
  // 90 ms era menor que el jitter de CI bajo carga: un plazo agotado no
  // obliga a ejecutar otro modelo. Dar margen real para verificar el fallback.
  ], {__dmsGeminiTimeoutMs: 1_200});
  assert.equal(timedOut.status,200);
  assert.deepEqual(calls,['gemini-test-primary','gemini-test-fallback']);
  assert.equal(timedOut.__dmsGeminiFallbackCount,1);

  // Si el llamador cancela la petición completa, no se rota a otro modelo.
  state.activeIndex=0;
  state.cooldowns.clear();
  state.quotaStrikes.clear();
  state.unavailableModels.clear();
  calls.length=0;
  scriptedResponses=[{hang:true},{status:200,body:{output_text:'No debería usarse'}}];
  const aborted=new AbortController();
  const abortTimer=setTimeout(()=>aborted.abort(new DOMException('Cancelled','AbortError')),10);
  try {
    await assert.rejects(
      globalThis.fetch('https://generativelanguage.googleapis.com/v1beta/interactions',{
        method:'POST',signal:aborted.signal,__dmsGeminiTimeoutMs:90,
        body:JSON.stringify({model:'gemini-test-primary',input:'cancelar'}),
      }),
      error=>error?.name==='AbortError',
    );
    assert.deepEqual(calls,['gemini-test-primary']);
  } finally {
    clearTimeout(abortTimer);
  }

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
