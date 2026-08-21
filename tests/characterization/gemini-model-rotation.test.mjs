import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('Gemini rota al siguiente modelo cuando el activo alcanza cuota', () => {
  const router = source('backend/src/services/gemini-model-router.bootstrap.js');

  assert.match(router, /DEFAULT_FALLBACK_MODELS = \['gemini-3\.1-flash-lite', 'gemini-2\.5-flash-lite'\]/);
  assert.match(router, /response\.status !== 429/);
  assert.match(router, /markQuotaExhausted\(model, response, message\)/);
  assert.match(router, /routerState\.activeIndex = \(index \+ 1\) % models\.length/);
  assert.match(router, /Cambiando a \$\{nextModel\}/);
  assert.match(router, /candidateOrder\(models\)/);
});

test('un modelo agotado entra en cooldown exponencial y deja de recibir llamadas', () => {
  const router = source('backend/src/services/gemini-model-router.bootstrap.js');

  assert.match(router, /DEFAULT_BASE_COOLDOWN_MS = 15 \* 60 \* 1000/);
  assert.match(router, /DEFAULT_MAX_COOLDOWN_MS = 2 \* 60 \* 60 \* 1000/);
  assert.match(router, /GEMINI_MODEL_QUOTA_COOLDOWN_MS/);
  assert.match(router, /GEMINI_MODEL_MAX_QUOTA_COOLDOWN_MS/);
  assert.match(router, /2 \*\* Math\.max\(0, strikes - 1\)/);
  assert.match(router, /ordered\.filter\(\(model\) => cooldownRemaining\(model\) === 0\)/);
  assert.match(router, /routerState\.quotaStrikes\.delete\(model\)/);
});

test('el router se instala antes de arrancar el servidor de producción', () => {
  const backendPackage = JSON.parse(source('backend/package.json'));

  assert.match(backendPackage.scripts.start, /--import \.\/src\/services\/gemini-model-router\.bootstrap\.js/);
  assert.match(backendPackage.scripts.dev, /--import \.\/src\/services\/gemini-model-router\.bootstrap\.js/);
  assert.match(backendPackage.scripts.check, /gemini-model-router\.bootstrap\.js/);
});
