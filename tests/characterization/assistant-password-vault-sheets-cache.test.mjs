import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('el adaptador histórico de caché de Sheets queda desactivado con PostgreSQL', () => {
  const app = source('backend/src/app.js');
  const cache = source('backend/src/services/sheets-route-read-cache.patch.js');

  assert.match(app, /runWithSheetsRouteReadCache/);
  assert.match(cache, /return operation\(\)/);
  assert.match(cache, /enabled:\s*false/);
  assert.match(cache, /postgres-persistence/);
  assert.doesNotMatch(cache, /AsyncLocalStorage|inflightReads|responseCache|PASSWORD_VAULT_TTL_MS|ASSISTANT_OPERATIONAL_TTL_MS/);
});

test('las lecturas operativas del asistente y password vault no acceden directamente a Google Sheets', () => {
  const cache = source('backend/src/services/sheets-route-read-cache.patch.js');
  const vault = source('backend/src/modules/password-vault.module.js');
  const assistant = source('backend/src/services/password-vault-assistant.patch.js');

  assert.doesNotMatch(cache, /sheetsApi|google\.sheets|spreadsheets\./);
  assert.doesNotMatch(vault, /sheetsApi|google\.sheets|spreadsheets\./);
  assert.doesNotMatch(assistant, /sheetsApi|google\.sheets|spreadsheets\./);
  assert.match(vault, /sheets\.repository\.js|postgres\.repository\.js/);
});

test('ninguna caché de ruta conserva respuestas descifradas de credenciales', () => {
  const cache = source('backend/src/services/sheets-route-read-cache.patch.js');
  const vault = source('backend/src/modules/password-vault.module.js');

  assert.doesNotMatch(cache, /decryptVaultSecret|PasswordCiphertext\s*:/);
  assert.doesNotMatch(cache, /requestCache|completedAssistantResponsesCached|passwordVaultWritesCached/);
  assert.match(vault, /decryptVaultSecret/);
  assert.match(vault, /passwordMasked:\s*'••••••••••••'/);
});
