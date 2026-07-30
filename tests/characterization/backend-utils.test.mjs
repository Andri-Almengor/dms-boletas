import test from 'node:test';
import assert from 'node:assert/strict';
import {
  asArray,
  asBool,
  escapeHtml,
  hashPassword,
  pick,
  sha256,
  verifyPassword,
} from '../../backend/src/core/utils.js';

test('PBKDF2 valida la contraseña correcta y rechaza una distinta', () => {
  const password = 'DmsPrueba2026!';
  const { salt, hash } = hashPassword(password, '0123456789abcdef0123456789abcdef');

  assert.match(hash, /^pbkdf2\$210000\$/);
  assert.equal(verifyPassword(password, salt, hash), true);
  assert.equal(verifyPassword('OtraClave2026!', salt, hash), false);
});

test('la compatibilidad con hashes heredados se conserva', () => {
  const salt = 'sal-heredada';
  const password = 'ClaveAnterior1';
  assert.equal(verifyPassword(password, salt, sha256(`${salt}${password}`)), true);
});

test('las normalizaciones booleanas y de arreglos conservan aliases actuales', () => {
  assert.equal(asBool('Sí'), true);
  assert.equal(asBool('activo'), true);
  assert.equal(asBool('No'), false);
  assert.deepEqual(asArray('["uno","dos"]'), ['uno', 'dos']);
  assert.deepEqual(asArray('uno, dos'), ['uno', 'dos']);
});

test('pick ignora valores vacíos y escapeHtml neutraliza caracteres HTML', () => {
  assert.equal(pick({ Nombre: '', name: 'DMS' }, ['Nombre', 'name']), 'DMS');
  assert.equal(
    escapeHtml('<script>"DMS" & test</script>'),
    '&lt;script&gt;&quot;DMS&quot; &amp; test&lt;/script&gt;',
  );
});
