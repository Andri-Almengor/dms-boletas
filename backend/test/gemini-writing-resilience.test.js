import test from 'node:test';
import assert from 'node:assert/strict';
import { rewriteTechnicalReport } from '../src/services/gemini.service.js';

function geminiResponse(fields, status = 200, headers = {}) {
  return new Response(JSON.stringify(
    status >= 400
      ? { error: { message: fields.message || 'Gemini error' } }
      : { output_text: JSON.stringify(fields) },
  ), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

test('redacción técnica rota al fallback cuando el modelo principal alcanza cuota', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL,
    GEMINI_FALLBACK_MODELS: process.env.GEMINI_FALLBACK_MODELS,
    GEMINI_MAX_RETRIES: process.env.GEMINI_MAX_RETRIES,
    GEMINI_TIMEOUT_MS: process.env.GEMINI_TIMEOUT_MS,
    GEMINI_TOTAL_TIMEOUT_MS: process.env.GEMINI_TOTAL_TIMEOUT_MS,
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
    Object.entries(originalEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  });

  process.env.GEMINI_API_KEY = 'test-key';
  process.env.GEMINI_MODEL = 'gemini-test-primary';
  process.env.GEMINI_FALLBACK_MODELS = 'gemini-test-fallback';
  process.env.GEMINI_MAX_RETRIES = '0';
  process.env.GEMINI_TIMEOUT_MS = '15000';
  process.env.GEMINI_TOTAL_TIMEOUT_MS = '60000';

  const attempted = [];
  globalThis.fetch = async (_url, init = {}) => {
    const body = JSON.parse(init.body || '{}');
    attempted.push(body.model);

    if (body.model === 'gemini-test-primary') {
      return geminiResponse(
        { message: 'Resource exhausted. Retry in 60s.' },
        429,
        { 'retry-after': '60' },
      );
    }

    return geminiResponse({
      titulo: 'Revisión de cámara en acceso principal',
      razonVisita: 'Se atendió una falla de visualización en la cámara.',
      descripcion: '',
      pruebasRealizadas: '',
      resultado: '',
      recomendaciones: '',
    });
  };

  const result = await rewriteTechnicalReport({
    titulo: 'Cámara',
    razonVisita: 'camara no se ve',
  });

  assert.deepEqual(attempted, ['gemini-test-primary', 'gemini-test-fallback']);
  assert.equal(result.model, 'gemini-test-fallback');
  assert.equal(result.titulo, 'Revisión de cámara en acceso principal');
  assert.match(result.fields.razonVisita, /falla de visualización/);
});
