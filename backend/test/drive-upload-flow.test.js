import test from 'node:test';
import assert from 'node:assert/strict';
import { createObservedDriveApi, OBSERVED_DRIVE_METHODS } from '../src/infra/drive-observer.js';

process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'fixture@example.invalid';
process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = 'fixture-not-a-key';
process.env.SHEETS_WRITE_MIN_INTERVAL_MS = '0';
process.env.SHEETS_BATCH_WINDOW_MS = '0';
const { driveApi, sheetsApi } = await import('../src/infra/google.js');
const { uploadBase64, uploadBuffer } = await import('../src/infra/drive.repository.js');
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

test('evidence and signature upload preserve bytes/metadata; returnPending still updates only the ticket', async () => {
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

  const headers = ['BoletaUID', 'Estado', 'ActualizadoPor', 'FechaActualizacion'];
  const row = ['B1', 'FINALIZADA', 'U1', '2026-09-16'];
  const writes = [];
  sheetsApi.spreadsheets.values.get = async ({ range }) => {
    assert.equal(range, "'Boletas'!1:1");
    return { data: { values: [headers] } };
  };
  sheetsApi.spreadsheets.values.batchGet = async () => ({ data: { valueRanges: [{ values: [headers, row] }] } });
  sheetsApi.spreadsheets.values.batchUpdate = async (request) => { writes.push(request); return { data: {} }; };
  const result = await ticketHandlers.returnPending({ payload: { boletaUid: 'B1' }, user: { UsuarioID: 'U1' } });
  assert.equal(result.boleta.Estado, 'PENDIENTE');
  assert.equal(result.boleta.BoletaUID, 'B1');
  assert.equal(writes.length, 1);
  assert.ok(writes[0].requestBody.data.every((item) => item.range.startsWith("'Boletas'!")));
  assert.equal(metrics.length, 2, 'returnPending performs no Drive operation');
});

test('nonretryable Drive failure retains its identity and records one upload attempt', async () => {
  const error = new TypeError('Drive fixture failure');
  const metrics = installDrive(() => { throw error; });
  await assert.rejects(uploadBase64({ base64: 'c2lnbmF0dXJl' }), (actual) => actual === error);
  assert.equal(metrics.length, 1);
  assert.equal(error.code, undefined, 'failure is not converted to UNAUTHORIZED');
});
