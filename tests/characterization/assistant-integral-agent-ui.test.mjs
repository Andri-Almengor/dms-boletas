import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { requestTimeoutMs } from '../../src/services/requestPolicy.js';

test('assistant frontend deadline stays above backend total agent timeout', () => {
  assert.equal(requestTimeoutMs('assistant.chat'), 240_000);
  assert.equal(requestTimeoutMs('asistente.chat'), 240_000);
  assert.equal(requestTimeoutMs('assistant.operations.decide'), 90_000);
  assert.ok(requestTimeoutMs('assistant.chat') > 180_000);
});

test('AssistantPageSecure exposes secure attachments and controlled confirmations', async () => {
  const source = await readFile(new URL('../../src/pages/assistant/AssistantPageSecure.jsx', import.meta.url), 'utf8');
  assert.match(source, /assistantAction:\s*'attachment\.init'/);
  assert.match(source, /assistantAction:\s*'attachment\.chunk'/);
  assert.match(source, /assistantAction:\s*'operation\.decide'/);
  assert.match(source, /apiRequest\('assistant\.chat'/);
  assert.match(source, /attachmentIds/);
  assert.match(source, /Confirmar/);
  assert.match(source, /Cancelar/);
  assert.match(source, /Reintentar pendientes/);
  assert.match(source, /ANTES|DESPUES|operación controlada/i);
  assert.doesNotMatch(source, /readAsDataURL|localStorage\.setItem\([^\n]*base64/i);
});

test('assistant UI reports only confirmed frontend states, not invented backend stages', async () => {
  const source = await readFile(new URL('../../src/pages/assistant/AssistantPageSecure.jsx', import.meta.url), 'utf8');
  for (const label of [
    'Preparando consulta',
    'Esperando respuesta del servidor',
    'La consulta sigue en curso',
    'La respuesta está tardando más de lo habitual',
  ]) {
    assert.match(source, new RegExp(label, 'i'));
  }
  assert.doesNotMatch(source, /progressPercent|\b\d{1,3}%\b/);
  assert.doesNotMatch(source, /'Buscando evidencias…'|'Consultando Base de Conocimiento…'/);
});
