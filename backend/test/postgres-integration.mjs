import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = String(process.env.TEST_DATABASE_URL || '').trim();
if (!testDatabaseUrl) {
  throw new Error('postgres-integration.mjs requires TEST_DATABASE_URL. Production DATABASE_URL is never accepted by this destructive test.');
}
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testDatabaseUrl;

const { appendRow, findById, readTable, updateRow } = await import('../src/infra/postgres.repository.js');
const { closePostgres, query } = await import('../src/infra/postgres.js');
const { appendSyncChanges, getSyncCursor, readSyncChangesAfter } = await import('../src/services/sync-change.service.js');

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

test('duplicate-tolerant repository preserves Sheets first-read / last-update semantics', async () => {
  const key = `TEST_DUP_${suffix}`;
  await appendRow('Configuracion', { Clave: key, Valor: 'first' });
  await appendRow('Configuracion', { Clave: key, Valor: 'last' });
  assert.equal((await findById('Configuracion', key)).Valor, 'first');
  await updateRow('Configuracion', key, { Valor: 'updated-last' });
  const rows = (await readTable('Configuracion')).filter((row) => row.Clave === key);
  assert.deepEqual(rows.map((row) => row.Valor), ['first', 'updated-last']);
  await query('DELETE FROM "Configuracion" WHERE "Clave"=$1', [key], { label: 'test.cleanup', write: true });
});

test('ticket numbering is atomic in PostgreSQL and keeps full maintenance prefix', async () => {
  await query('DELETE FROM "Boletas" WHERE "BoletaUID" LIKE $1 OR "BoletaUID" LIKE $2', [`test-${suffix}-%`, `mnt-test-${suffix}%`], { label: 'test.cleanup', write: true });
  await query("DELETE FROM runtime_sequences WHERE entity IN ('BOLETA','MANTENIMIENTO_BOLETA')", [], { label: 'test.cleanup', write: true });
  await query(
    'INSERT INTO "Boletas" ("BoletaUID","BoletaID","Estado","__payload") VALUES ($1,$2,$3,$4::jsonb)',
    [`test-${suffix}-seed`, '499', 'PENDIENTE', JSON.stringify({ BoletaUID: `test-${suffix}-seed`, BoletaID: '499', Estado: 'PENDIENTE' })],
    { label: 'test.seed', write: true },
  );
  const first = { BoletaUID: `test-${suffix}-a`, BoletaID: 1, Titulo: 'A', ClienteID: 'x', Estado: 'PENDIENTE' };
  const second = { BoletaUID: `test-${suffix}-b`, BoletaID: 1, Titulo: 'B', ClienteID: 'x', Estado: 'PENDIENTE' };
  await Promise.all([appendRow('Boletas', first), appendRow('Boletas', second)]);
  assert.deepEqual(new Set([String(first.BoletaID), String(second.BoletaID)]), new Set(['500', '501']));

  await query(
    'INSERT INTO "Boletas" ("BoletaUID","BoletaID","Estado","__payload") VALUES ($1,$2,$3,$4::jsonb)',
    [`mnt-test-${suffix}-seed`, 'M205', 'PENDIENTE', JSON.stringify({ BoletaUID: `mnt-test-${suffix}-seed`, BoletaID: 'M205', Estado: 'PENDIENTE' })],
    { label: 'test.seed.maintenance', write: true },
  );
  const maintenance = { BoletaUID: `mnt-test-${suffix}`, BoletaID: 'M01', Titulo: 'M', ClienteID: 'x', Estado: 'PENDIENTE' };
  await appendRow('Boletas', maintenance);
  assert.equal(String(maintenance.BoletaID), 'M206');

  const testTicket = { BoletaUID: `test-${suffix}-custom`, BoletaID: `PRUEBA-${suffix}`, Titulo: 'Prueba', ClienteID: 'x', Estado: 'PENDIENTE', EsPrueba: true };
  await appendRow('Boletas', testTicket);
  assert.equal(testTicket.BoletaID, `PRUEBA-${suffix}`);
  await query('DELETE FROM "Boletas" WHERE "BoletaUID" LIKE $1 OR "BoletaUID" LIKE $2', [`test-${suffix}-%`, `mnt-test-${suffix}%`], { label: 'test.cleanup', write: true });
  await query("DELETE FROM runtime_sequences WHERE entity IN ('BOLETA','MANTENIMIENTO_BOLETA')", [], { label: 'test.cleanup', write: true });
});

test('SyncChanges uses a monotonic database cursor', async () => {
  const before = await getSyncCursor();
  await appendSyncChanges([
    { resource: 'ticket', entityId: `sync-${suffix}-1`, operation: 'UPSERT', sourceRoute: 'test' },
    { resource: 'ticket', entityId: `sync-${suffix}-2`, operation: 'UPSERT', sourceRoute: 'test' },
  ]);
  const after = await getSyncCursor();
  assert.ok(after >= before + 2);
  const delta = await readSyncChangesAfter(before, { limit: 10 });
  assert.equal(delta.invalidCursor, false);
  assert.ok(delta.events.some((event) => event.EntityID === `sync-${suffix}-1`));
});

test.after(async () => { await closePostgres(); });
