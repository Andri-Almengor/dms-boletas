import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = readFileSync(
  path.join(ROOT, 'backend/src/services/ticket-signature-request.service.js'),
  'utf8',
);
const publicPageSource = readFileSync(
  path.join(ROOT, 'src/pages/tickets/PublicSignaturePage.jsx'),
  'utf8',
);

test('APP_PUBLIC_URL es la fuente canónica para los enlaces de firma de boletas', () => {
  const block = source.match(/function publicBaseUrl\(origin = ''\) \{[\s\S]*?\n\}/)?.[0] || '';
  const appPublicUrlIndex = block.indexOf('process.env.APP_PUBLIC_URL');

  assert.ok(appPublicUrlIndex >= 0, 'Debe considerar APP_PUBLIC_URL.');
  assert.ok(block.lastIndexOf('origin') >= 0, 'Debe conservar origin como fallback.');
  assert.ok(
    appPublicUrlIndex < block.lastIndexOf('origin'),
    'APP_PUBLIC_URL debe evaluarse antes que el origin recibido del navegador.',
  );
  assert.match(source, /function publicSignatureUrl\(token, origin = ''\)/);
});

test('una boleta pendiente conserva su token y corrige solamente FirmaURLPublica', () => {
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

test('las nuevas solicitudes de firma de boleta usan la URL pública canónica', () => {
  assert.match(source, /const url = publicSignatureUrl\(token, origin\);/);
  assert.match(source, /FirmaURLPublica: url/);
});

test('la firma pública reconcilia UNKNOWN_RESULT con una sola lectura autoritativa sin caché', () => {
  const catchBlock = publicPageSource.match(/catch \(saveError\) \{[\s\S]*?\n    \} finally \{/)?.[0] || '';

  assert.match(catchBlock, /saveError\.code === 'UNKNOWN_RESULT'/);
  assert.match(
    catchBlock,
    /requestAvailable\([\s\S]*?PUBLIC_GET_ROUTES,[\s\S]*?\{ token \},[\s\S]*?'',[\s\S]*?\{ cache: 'no-store' \}/,
    'La reconciliación debe consultar el estado público real sin reutilizar una lectura anterior.',
  );
  assert.match(catchBlock, /isConfirmedPublicSignature\(confirmation\)/);
  assert.match(catchBlock, /setSigned\(true\)/);
  assert.match(catchBlock, /setSignature\(''\)/);
  assert.doesNotMatch(
    catchBlock,
    /requestAvailable\(PUBLIC_SUBMIT_ROUTES/,
    'Un resultado incierto nunca debe reenviar automáticamente la firma.',
  );
});

test('si la reconciliación no confirma, conserva la firma y muestra un mensaje recuperable', () => {
  const helper = publicPageSource.match(/function isConfirmedPublicSignature\([\s\S]*?\n\}/)?.[0] || '';
  const catchBlock = publicPageSource.match(/catch \(saveError\) \{[\s\S]*?\n    \} finally \{/)?.[0] || '';

  assert.match(helper, /Boolean\(data\?\.alreadySigned\)/);
  assert.match(helper, /status === 'FIRMADA'/);
  assert.match(catchBlock, /Su firma sigue en pantalla/);

  const uncertainBranch = catchBlock.match(/else if \(saveError\.code === 'UNKNOWN_RESULT'\) \{[\s\S]*?\n      \} else \{/)?.[0] || '';
  const successClearIndex = uncertainBranch.indexOf("setSignature('')");
  const pendingMessageIndex = uncertainBranch.indexOf('Su firma sigue en pantalla');
  assert.ok(successClearIndex >= 0, 'La firma puede limpiarse después de una confirmación autoritativa.');
  assert.ok(pendingMessageIndex > successClearIndex, 'El caso pendiente debe conservar el trazo y ofrecer reintento manual.');
});
