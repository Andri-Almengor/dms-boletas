import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('el asistente y las lecturas de credenciales usan una caché de Sheets aislada por ruta', () => {
  const app = source('backend/src/app.js');
  const cache = source('backend/src/services/sheets-route-read-cache.patch.js');

  assert.match(app, /runWithSheetsRouteReadCache/);
  assert.match(app, /runWithSheetsRouteReadCache\(envelope\.route/);
  assert.match(cache, /AsyncLocalStorage/);
  assert.match(cache, /assistant\.chat/);
  assert.match(cache, /passwordVault\.dashboard\.get/);
  assert.match(cache, /passwordVault\.credentials\.reveal/);
  assert.match(cache, /requestCache:\s*new Map\(\)/);
  assert.match(cache, /inflightReads/);
  assert.match(cache, /ASSISTANT_OPERATIONAL_TTL_MS\s*=\s*60_000/);
  assert.match(cache, /ASSISTANT_CATALOG_TTL_MS\s*=\s*10 \* 60_000/);
  assert.match(cache, /PASSWORD_VAULT_TTL_MS\s*=\s*5 \* 60_000/);
});

test('las escrituras invalidan únicamente las hojas afectadas y una auditoría no vacía todo el caché', () => {
  const cache = source('backend/src/services/sheets-route-read-cache.patch.js');

  assert.match(cache, /writeSheetNames/);
  assert.match(cache, /intersects\(entry\.sheetNames, sheetNames\)/);
  assert.match(cache, /invalidateReadCache\(writeSheetNames\(method, args\)\)/);
  assert.match(cache, /selectiveInvalidations/);
  assert.doesNotMatch(cache, /owner\[property\][\s\S]*responseCache\.clear\(\)[\s\S]*return result/);
});

test('la caché de contraseñas conserva únicamente filas cifradas y nunca respuestas descifradas', () => {
  const cache = source('backend/src/services/sheets-route-read-cache.patch.js');

  assert.match(cache, /CredencialesClientes/);
  assert.match(cache, /encryptedRowsOnly:\s*true/);
  assert.match(cache, /passwordVaultWritesCached:\s*false/);
  assert.match(cache, /completedAssistantResponsesCached:\s*false/);
  assert.doesNotMatch(cache, /decryptVaultSecret|PasswordCiphertext\s*:/);
  assert.doesNotMatch(cache, /PASSWORD_VAULT_PREFIXES/);
});
