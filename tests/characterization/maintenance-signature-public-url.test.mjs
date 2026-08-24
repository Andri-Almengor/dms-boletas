import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = readFileSync(
  path.join(ROOT, 'backend/src/services/maintenance-signature-request.service.js'),
  'utf8',
);

test('APP_PUBLIC_URL es la fuente canónica para los enlaces de firma de mantenimiento', () => {
  const block = source.match(/function publicBaseUrl\(origin = ''\) \{[\s\S]*?\n\}/)?.[0] || '';
  const appPublicUrlIndex = block.indexOf('process.env.APP_PUBLIC_URL');
  const originIndex = block.indexOf('origin');

  assert.ok(appPublicUrlIndex >= 0, 'Debe considerar APP_PUBLIC_URL.');
  assert.ok(originIndex >= 0, 'Debe conservar origin como fallback.');
  assert.ok(
    appPublicUrlIndex < block.lastIndexOf('origin'),
    'APP_PUBLIC_URL debe evaluarse antes que el origin recibido del navegador.',
  );
  assert.match(source, /function publicSignatureUrl\(token, origin = ''\)/);
});

test('una solicitud pendiente reutiliza el token y corrige solamente su URL pública cuando cambió el host', () => {
  const helper = source.match(/async function refreshPendingPublicUrl\([\s\S]*?\n\}/)?.[0] || '';

  assert.match(helper, /Estado\)\.toUpperCase\(\) !== 'PENDIENTE'/);
  assert.match(helper, /const token = clean\(row\.Token\)/);
  assert.match(helper, /const expectedUrl = publicSignatureUrl\(token, origin\)/);
  assert.match(helper, /FirmaURLPublica: expectedUrl/);
  assert.doesNotMatch(helper, /Token:/);

  assert.match(
    source,
    /const refreshed = await refreshPendingPublicUrl\(current, origin, actor\);[\s\S]*?return requestView\(refreshed\);/,
  );
});

test('las solicitudes nuevas también se crean con la URL pública canónica', () => {
  assert.match(source, /const url = publicSignatureUrl\(token, origin\);/);
  assert.match(source, /FirmaURLPublica: url/);
});
