import test from 'node:test';
import assert from 'node:assert/strict';

// Exercise the real service/repository against a bounded in-memory Sheets transport.
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test@example.invalid';
process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = 'test-only';
process.env.SHEETS_BATCH_WINDOW_MS = '0';
process.env.SHEETS_WRITE_MIN_INTERVAL_MS = '0';
process.env.SHEETS_QUOTA_RETRIES = '0';
const { sheetsApi } = await import('../src/infra/google.js');
let sequence = 0;
async function fixture({ cursor = 4, rows = [] } = {}) {
  const service = await import(`../src/services/sync-change.service.js?fixture=${++sequence}`);
  const calls = { reads: [], writes: [] };
  sheetsApi.spreadsheets.get = async () => ({ data: { sheets: [{ properties: {
    title: 'SyncChanges', sheetId: 1, gridProperties: { rowCount: 1000, columnCount: 12 },
  } }] } });
  sheetsApi.spreadsheets.values.get = async ({ range }) => {
    calls.reads.push(range);
    if (range === "'SyncChanges'!1:1") return { data: { values: [service.SYNC_CHANGE_HEADERS] } };
    if (range === "'SyncChanges'!L1:L2") return { data: { values: [['Cursor'], [cursor]] } };
    if (range === "'Configuracion'!1:1") return { data: { values: [['Clave', 'Valor', 'Descripcion']] } };
    if (/^'SyncChanges'!A\d+:K\d+$/.test(range)) return { data: { values: rows } };
    throw new Error(`Unexpected read ${range}`);
  };
  sheetsApi.spreadsheets.values.batchGet = async () => ({ data: { valueRanges: [{ values: [
    ['Clave', 'Valor', 'Descripcion'], ['INCREMENTAL_SYNC_GENERATION', 'persisted-generation', ''],
  ] }] } });
  sheetsApi.spreadsheets.values.batchUpdate = async (args) => {
    calls.writes.push(args);
    return { data: {} };
  };
  return { service, calls };
}
const event = (id) => [`event-${id}`, 'ticket', id, 'UPSERT', '', '2026-09-16', 'U1', 'boletas.update', '', 1, ''];

test('empty delta makes no Sheets call after initialization', async () => {
  const { service, calls } = await fixture();
  await service.ensureSyncInfrastructure();
  calls.reads.length = 0;
  const scan = await service.readSyncChangesAfter(4);
  assert.deepEqual(scan.events, []);
  assert.equal(scan.cursor, 4);
  assert.equal(calls.reads.length, 0);
});

test('bounded suffix scan never reads history before the cursor', async () => {
  const { service, calls } = await fixture({ rows: [event('B2'), event('B3')] });
  const scan = await service.readSyncChangesAfter(1, { limit: 2 });
  assert.equal(scan.cursor, 3);
  assert.equal(scan.hasMore, true);
  assert.deepEqual(scan.events.map((row) => row.EntityID), ['B2', 'B3']);
  assert.equal(calls.reads.at(-1), "'SyncChanges'!A2:K3");
});

for (const [label, rows] of [
  ['missing tail', [event('B2')]],
  ['interior hole', [event('B2'), [], event('B4')]],
  ['malformed identity', [event('B2'), ['bad'], event('B4')]],
]) {
  test(`${label} forces reconciliation instead of silently advancing`, async () => {
    const { service } = await fixture({ rows });
    const scan = await service.readSyncChangesAfter(1);
    assert.equal(scan.invalidCursor, true);
    assert.equal(scan.reason, 'changelog_gap');
    assert.deepEqual(scan.events, []);
  });
}

test('corrupt persisted cursor cannot overwrite committed history', async () => {
  const { service, calls } = await fixture({ cursor: 'broken' });
  await assert.rejects(service.ensureSyncInfrastructure(), { code: 'SYNC_CURSOR_CORRUPT' });
  assert.equal(calls.writes.length, 0);
});

test('restart invalidates old snapshots even if unsafe marker could not persist', async () => {
  const first = await fixture();
  const before = await first.service.getSyncDescriptor();
  sheetsApi.spreadsheets.values.batchUpdate = async () => { throw new Error('quota'); };
  await first.service.markSyncUnsafe('write_failed');
  assert.equal((await first.service.getSyncDescriptor()).unsafe, true);
  const restarted = await fixture();
  const after = await restarted.service.getSyncDescriptor();
  assert.notEqual(before.generation, after.generation);
  assert.equal(after.unsafe, false);
});

test('primary and derived changes dedupe into one Google write including cursor', async () => {
  const { service, calls } = await fixture();
  const classification = { classification: 'SYNC_RESOURCE', resource: 'ticket', entityId: 'B1', operation: 'UPSERT' };
  const events = await service.recordClassifiedSyncChanges([
    classification, classification,
    { ...classification, resource: 'agenda', entityId: 'A1' },
  ], { route: 'boletas.update', user: { UsuarioID: 'U1' } });
  assert.equal(events.length, 2);
  assert.equal(calls.writes.length, 1);
  assert.equal(calls.writes[0].requestBody.data[0].values.length, 2);
  assert.equal(calls.writes[0].requestBody.data[1].values[0][0], 6);
});

test('unresolved confirmed mutation explicitly invalidates the resource', async () => {
  const { service } = await fixture();
  const events = await service.recordClassifiedSyncChanges([
    { classification: 'SYNC_RESOURCE', resource: 'ticket', entityId: '' },
  ]);
  assert.equal(events[0].EntityID, '*');
  assert.equal(events[0].Operation, 'INVALIDATE');
});
