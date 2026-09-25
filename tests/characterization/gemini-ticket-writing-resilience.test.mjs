import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('las tres vistas de boletas reutilizan el mismo asistente de redacción', () => {
  for (const page of [
    'src/pages/tickets/TicketFormPage.jsx',
    'src/pages/tickets/TicketRelatedVisitPage.jsx',
    'src/pages/tickets/TicketQuickEditPage.jsx',
  ]) {
    const pageSource = source(page);
    assert.match(pageSource, /TechnicalWritingAssistant/);
  }

  const assistant = source('src/components/tickets/TechnicalWritingAssistant.jsx');
  assert.match(assistant, /ai\.technicalRewrite/);
  assert.match(assistant, /gemini\.technicalRewrite/);
  assert.match(assistant, /boletas\.ai\.rewrite/);
});

test('la redacción Gemini tiene una ventana mayor que el timeout genérico de 45 segundos', () => {
  const policy = source('src/services/requestPolicy.js');

  assert.match(policy, /'ai\.technicalrewrite'/);
  assert.match(policy, /'gemini\.technicalrewrite'/);
  assert.match(policy, /'boletas\.ai\.rewrite'/);
  assert.match(policy, /return 240_000/);
  assert.match(policy, /return 45_000/);
});

test('las rutas Gemini son reintentables sin tratarse como mutaciones ni cachearse', () => {
  const api = source('src/api.js');

  assert.match(api, /function isReplaySafeAiRoute/);
  assert.match(api, /const retrySafe = read \|\| replaySafeAi/);
  assert.match(api, /if \(isReplaySafeAiRoute\(route\)\) \{\s*return performRequestWithRetry/);
  assert.match(api, /const ambiguousMutation = !retrySafe/);
});

test('el backend rota de modelo en timeout, cuota o modelo no disponible dentro de un presupuesto total', () => {
  const gemini = source('backend/src/services/gemini.service.js');

  assert.match(gemini, /DEFAULT_MODEL_TIMEOUT_MS = 65_000/);
  assert.match(gemini, /DEFAULT_TOTAL_TIMEOUT_MS = 210_000/);
  assert.match(gemini, /GEMINI_TOTAL_TIMEOUT_MS/);
  assert.match(gemini, /GEMINI_TIMEOUT_MS/);
  assert.match(gemini, /GEMINI_MODEL_UNAVAILABLE/);
  assert.match(gemini, /lastFailure\?\.code === 'GEMINI_TIMEOUT'/);
  assert.match(gemini, /deadlineAt - Date\.now\(\) <= 1_000/);
  assert.match(gemini, /Cambiando al siguiente modelo disponible/);
});

test('la redacción Gemini usa un carril de concurrencia separado de las escrituras', () => {
  const concurrency = source('backend/src/services/action-concurrency.service.js');
  const env = source('backend/src/config/env.js');
  const render = source('render.yaml');

  assert.match(concurrency, /name: 'action-ai'/);
  assert.match(concurrency, /isAiRewriteRoute/);
  assert.match(concurrency, /releaseDedicated = await aiActions\.acquire\(\)/);
  assert.match(concurrency, /ai: aiActions\.snapshot\(\)/);
  assert.match(env, /AI_ACTION_MAX_CONCURRENT/);
  assert.match(render, /AI_ACTION_MAX_CONCURRENT/);
  assert.match(render, /GEMINI_TIMEOUT_MS[\s\S]*65000/);
  assert.match(render, /GEMINI_TOTAL_TIMEOUT_MS[\s\S]*210000/);
});
