import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../src/core/errors.js';
import { transcribeAssistantAudio } from '../src/ai/agent.module.js';

const audioBase64 = Buffer.alloc(600, 42).toString('base64');
function ctx(overrides = {}) {
  return {
    user: { UsuarioID: 'speech-test-user' },
    sessionToken: 'test-session-token',
    payload: { mimeType: 'audio/webm', audioBase64, ...overrides },
  };
}

test('el backend autentica, valida audio, omite almacenamiento y devuelve solo texto de Gemini', async () => {
  let calls = 0;
  const result = await transcribeAssistantAudio(ctx(), {
    models: ['model-test'],
    createInteraction: async ({ input, tools, model }) => {
      calls += 1;
      assert.equal(model, 'model-test');
      assert.deepEqual(tools, []);
      assert.equal(input[1].type, 'audio');
      assert.equal(input[1].data, audioBase64);
      assert.equal(input[1].mime_type, 'audio/webm');
      return { output_text: 'Cliente DMS, cámara número dos.' };
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { transcript: 'Cliente DMS, cámara número dos.' });
});

test('audio inválido, excesivo, formato no soportado o sesión ausente nunca llaman Gemini', async () => {
  let calls = 0;
  const mocks = { models: ['m'], createInteraction: async () => { calls += 1; return { output_text: 'No' }; } };
  const rejected = [
    ctx({ mimeType: 'video/mp4' }),
    ctx({ audioBase64: '%%%' }),
    ctx({ audioBase64: Buffer.alloc(3 * 1024 * 1024 + 1, 1).toString('base64') }),
    { ...ctx(), user: null },
    { ...ctx(), sessionToken: '' },
  ];
  for (const invalid of rejected) {
    await assert.rejects(() => transcribeAssistantAudio(invalid, mocks), (error) =>
      error instanceof AppError && [400, 401].includes(error.status));
  }
  assert.equal(calls, 0);
});

test('audio de Safari mp4 se normaliza a m4a admitido por Gemini', async () => {
  const result = await transcribeAssistantAudio(ctx({ mimeType: 'audio/mp4' }), {
    models: ['model-test'],
    createInteraction: async ({ input }) => {
      assert.equal(input[1].mime_type, 'audio/m4a');
      return { output_text: 'Una visita en Sabana.' };
    },
  });
  assert.equal(result.transcript, 'Una visita en Sabana.');
});

test('fallo recuperable rota modelo, sin volver a capturar audio', async () => {
  const tried = [];
  const result = await transcribeAssistantAudio(ctx(), {
    models: ['primary-test', 'fallback-test'],
    createInteraction: async ({ model }) => {
      tried.push(model);
      if (model === 'primary-test') throw new AppError('MODEL_RATE_LIMIT', 'Cuota', 429);
      return { output_text: 'Segunda visita' };
    },
  });
  assert.deepEqual(tried, ['primary-test', 'fallback-test']);
  assert.equal(result.transcript, 'Segunda visita');
});
