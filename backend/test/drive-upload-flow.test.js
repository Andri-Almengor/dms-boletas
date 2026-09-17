import test from 'node:test';
import assert from 'node:assert/strict';
import { createObservedDriveApi, OBSERVED_DRIVE_METHODS } from '../src/infra/drive-observer.js';

process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'fixture@example.invalid';
process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = 'fixture-not-a-key';
const testDatabaseUrl = String(process.env.TEST_DATABASE_URL || '').trim();
if (testDatabaseUrl) {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = testDatabaseUrl;
}

const { driveApi, sheetsApi } = await import('../src/infra/google.js');
const { uploadBase64, uploadBuffer } = await import('../src/infra/drive.repository.js');
const { appendRow } = await import('../src/infra/postgres.repository.js');
const { query } = await import('../src/infra/postgres.js');
const { ticketHandlers } = await import('../src/modules/tickets.module.js');

function installDrive(create) {
  const raw = {};
  const metrics = [];
  for (const [name, methods] of Object.entries(OBSERVED_DRIVE_METHODS)) {
    const resource = Object.fromEntries(methods.map((method) => [method, method === 'create' && name === 'files'
      ? create : () => { throw new Error(`Unexpected Drive call ${name}.${method}`); }]));
    Object.defineProperty(raw, name, { value: Object.freeze(resource), configurable: false, writable: false });
  }
  const facade = createObservedDriveApi(raw, { record: (metric) => metrics.push(metric) });
  Object.assign(driveApi.files, facade.files);
  Object.assign(driveApi.permissions, facade.permissions);
  return metrics;
}

test('evidence and signature upload preserve bytes/metadata; returnPending updates PostgreSQL only', { skip: !testDatabaseUrl }, async () => {
  const uploaded = [];
  const metrics = installDrive(async (request) => {
    const chunks = [];
    for await (const chunk of request.media.body) chunks.push(chunk);
    uploaded.push({ body: Buffer.concat(chunks), request });
    return { data: { id: `file-${uploaded.length}`, name: request.requestBody.name } };
  });
  const evidence = Buffer.from([0, 255, 21, 200, 8]);
  const signature = Buffer.from([137, 80, 78, 71, 0, 1, 2, 3]);
  assert.equal((await uploadBuffer({ buffer: evidence, mimeType: 'application/pdf', fileName: 'evidence.pdf', folderId: 'private-folder' })).id, 'file-1');
  assert.equal((await uploadBase64({ base64: signature.toString('base64'), mimeType: 'image/png', fileName: 'signature.png' })).id, 'file-2');
  assert.deepEqual(uploaded.map((entry) => entry.body), [evidence, signature]);
  assert.deepEqual(uploaded[0].request.requestBody.parents, ['private-folder']);
  assert.equal(uploaded[1].request.media.mimeType, 'image/png');
  assert.equal(metrics.length, 2);

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const boletaUid = `drive-flow-${suffix}`;
  await appendRow('Boletas', {
    BoletaUID: boletaUid,
    BoletaID: `PRUEBA-DRIVE-${suffix}`,
    EsPrueba: true,
    Estado: 'FINALIZADA',
    ActualizadoPor: 'U1',
    FechaActualizacion: '2026-09-16',
  });

  let sheetsCalls = 0;
  sheetsApi.spreadsheets.values.get = async () => { sheetsCalls += 1; throw new Error('Operational Sheets read is forbidden'); };
  sheetsApi.spreadsheets.values.batchGet = async () => { sheetsCalls += 1; throw new Error('Operational Sheets read is forbidden'); };
  sheetsApi.spreadsheets.values.batchUpdate = async () => { sheetsCalls += 1; throw new Error('Operational Sheets write is forbidden'); };

  try {
    const result = await ticketHandlers.returnPending({ payload: { boletaUid }, user: { UsuarioID: 'U1' } });
    assert.equal(result.boleta.Estado, 'PENDIENTE');
    assert.equal(result.boleta.BoletaUID, boletaUid);
    assert.equal(sheetsCalls, 0);
    assert.equal(metrics.length, 2, 'returnPending performs no Drive operation');
    const persisted = await query('SELECT "Estado" FROM "Boletas" WHERE "BoletaUID"=$1 ORDER BY "__source_row_number" DESC NULLS LAST LIMIT 1', [boletaUid], { label: 'test.drive-flow.verify' });
    assert.equal(persisted.rows[0]?.Estado, 'PENDIENTE');
  } finally {
    await query('DELETE FROM "Boletas" WHERE "BoletaUID"=$1', [boletaUid], { label: 'test.drive-flow.cleanup', write: true });
  }
});

test('nonretryable Drive failure retains its identity and records one upload attempt', async () => {
  const error = new TypeError('Drive fixture failure');
  const metrics = installDrive(() => { throw error; });
  await assert.rejects(uploadBase64({ base64: 'c2lnbmF0dXJl' }), (actual) => actual === error);
  assert.equal(metrics.length, 1);
  assert.equal(error.code, undefined, 'failure is not converted to UNAUTHORIZED');
});
