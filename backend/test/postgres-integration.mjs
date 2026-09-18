import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const testDatabaseUrl = String(process.env.TEST_DATABASE_URL || '').trim();
if (!testDatabaseUrl) {
  throw new Error('postgres-integration.mjs requires TEST_DATABASE_URL. Production DATABASE_URL is never accepted by this destructive test.');
}
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testDatabaseUrl;

const { appendRow, findById, nextCustomerCaseNumber, queryTicketPage, readTable, updateRow } = await import('../src/infra/postgres.repository.js');
const { closePostgres, query, withTransaction } = await import('../src/infra/postgres.js');
const { appendSyncChanges, getSyncCursor, readSyncChangesAfter } = await import('../src/services/sync-change.service.js');
const { createPortablePostgresBackupFile, cleanupPortableBackup } = await import('../src/services/postgres-backup.service.js');
const { reconcileCustomerCases } = await import('../src/services/customer-case-sync.service.js');

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

test('customer case numbering is serialized through the same transaction as the insert', async () => {
  const ids = [`case-number-${suffix}-a`, `case-number-${suffix}-b`];
  const create = (caseId) => withTransaction(async () => {
    const caseNumber = await nextCustomerCaseNumber();
    await appendRow('CasosClientes', {
      CasoID: caseId,
      CasoNumero: caseNumber,
      Estado: 'EN_ESPERA',
      Activo: true,
      FechaCreacion: new Date().toISOString(),
    });
    return caseNumber;
  });

  try {
    const numbers = await Promise.all(ids.map(create));
    const numeric = numbers.map((value) => Number(String(value).replace(/\D/g, '')));
    assert.equal(new Set(numbers).size, 2);
    assert.equal(Math.abs(numeric[0] - numeric[1]), 1);
  } finally {
    await query(
      'DELETE FROM "CasosClientes" WHERE "CasoID" = ANY($1::text[])',
      [ids],
      { label: 'test.caseNumber.cleanup', write: true },
    ).catch(() => {});
  }
});

test('customer case reconciliation keeps both historical matching paths with bounded SQL candidates', async () => {
  const directCaseId = `reconcile-direct-${suffix}`;
  const originCaseId = `reconcile-origin-${suffix}`;
  const directTicketId = `reconcile-ticket-direct-${suffix}`;
  const originTicketId = `reconcile-ticket-origin-${suffix}`;
  const finalizedAt = '2026-09-17T18:00:00.000Z';

  try {
    await appendRow('CasosClientes', {
      CasoID: directCaseId,
      CasoNumero: `TEST-DIRECT-${suffix}`,
      Estado: 'EN_PROCESO',
      BoletaUID: directTicketId,
      Activo: true,
    });
    await appendRow('CasosClientes', {
      CasoID: originCaseId,
      CasoNumero: `TEST-ORIGIN-${suffix}`,
      Estado: 'EN_ESPERA',
      BoletaUID: '',
      BoletaID: '',
      Activo: true,
    });
    await appendRow('Boletas', {
      BoletaUID: directTicketId,
      BoletaID: `PRUEBA-RECON-DIRECT-${suffix}`,
      EsPrueba: true,
      Estado: 'FINALIZADA',
      FinalizadaEn: finalizedAt,
      Activo: true,
    });
    await appendRow('Boletas', {
      BoletaUID: originTicketId,
      BoletaID: `PRUEBA-RECON-ORIGIN-${suffix}`,
      EsPrueba: true,
      Estado: 'FINALIZADA',
      OrigenCasoID: originCaseId,
      FinalizadaEn: finalizedAt,
      Activo: true,
    });

    const updated = await reconcileCustomerCases('TEST');
    assert.equal(updated, 2);

    const direct = await findById('CasosClientes', directCaseId);
    assert.equal(direct.Estado, 'FINALIZADO');
    assert.equal(direct.FechaFinalizacion, finalizedAt);

    const origin = await findById('CasosClientes', originCaseId);
    assert.equal(origin.Estado, 'FINALIZADO');
    assert.equal(origin.BoletaUID, originTicketId);
    assert.equal(origin.BoletaID, `PRUEBA-RECON-ORIGIN-${suffix}`);
    assert.equal(origin.FechaFinalizacion, finalizedAt);
  } finally {
    await query(
      'DELETE FROM "Boletas" WHERE "BoletaUID" = ANY($1::text[])',
      [[directTicketId, originTicketId]],
      { label: 'test.caseReconcile.ticketCleanup', write: true },
    ).catch(() => {});
    await query(
      'DELETE FROM "CasosClientes" WHERE "CasoID" = ANY($1::text[])',
      [[directCaseId, originCaseId]],
      { label: 'test.caseReconcile.caseCleanup', write: true },
    ).catch(() => {});
  }
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



test('SyncChanges participates atomically in an ambient PostgreSQL transaction', async () => {
  const entityId = `sync-rollback-${suffix}`;
  const before = await getSyncCursor();
  await assert.rejects(
    withTransaction(async () => {
      await appendSyncChanges([
        { resource: 'ticket', entityId, operation: 'UPSERT', sourceRoute: 'test.rollback' },
      ]);
      throw new Error('force rollback');
    }),
    /force rollback/,
  );
  const after = await getSyncCursor();
  assert.equal(after, before);
  const persisted = await query(
    'SELECT COUNT(*)::int AS total FROM "SyncChanges" WHERE "__valid"=TRUE AND "EntityID"=$1',
    [entityId],
    { label: 'test.sync.rollback.verify' },
  );
  assert.equal(Number(persisted.rows[0]?.total || 0), 0);
});

test('ticket SQL paging preserves allowedIds authorization and home summary scope', async () => {
  const firstId = `authz-${suffix}-pending`;
  const secondId = `authz-${suffix}-finished`;
  try {
    await appendRow('Boletas', {
      BoletaUID: firstId,
      BoletaID: `PRUEBA-AUTHZ-${suffix}-1`,
      EsPrueba: true,
      Titulo: 'Visible',
      Estado: 'PENDIENTE',
      Activo: true,
      Fecha: '2026-09-17',
    });
    await appendRow('Boletas', {
      BoletaUID: secondId,
      BoletaID: `PRUEBA-AUTHZ-${suffix}-2`,
      EsPrueba: true,
      Titulo: 'Oculta',
      Estado: 'FINALIZADA',
      Activo: true,
      Fecha: '2026-09-17',
    });

    const visible = await queryTicketPage(
      { page: 1, pageSize: 20, homeSummary: true },
      { allowedIds: new Set([firstId]) },
    );
    assert.equal(visible.total, 1);
    assert.deepEqual(visible.items.map((row) => row.BoletaUID), [firstId]);
    assert.deepEqual(visible.homeSummary, { pending: 1, finished: 0 });

    const none = await queryTicketPage(
      { page: 1, pageSize: 20, homeSummary: true },
      { allowedIds: new Set() },
    );
    assert.deepEqual(none, {
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      homeSummary: { pending: 0, finished: 0 },
    });
  } finally {
    await query('DELETE FROM "Boletas" WHERE "BoletaUID" = ANY($1::text[])', [[firstId, secondId]], { label: 'test.authz.cleanup', write: true });
  }
});

test('portable PostgreSQL backup verifies and restores a controlled mutation', async () => {
  const key = `BACKUP_RESTORE_TEST_${suffix}`;
  const verifyScript = fileURLToPath(new URL('../src/scripts/db-backup-verify.js', import.meta.url));
  const restoreScript = fileURLToPath(new URL('../src/scripts/db-backup-restore.js', import.meta.url));
  let backup;
  try {
    await appendRow('Configuracion', { Clave: key, Valor: 'before-backup', Descripcion: 'integration restore test' });
    backup = await createPortablePostgresBackupFile();

    const verifyOutput = execFileSync(process.execPath, [verifyScript, '--file', backup.outputPath], {
      env: process.env,
      encoding: 'utf8',
    });
    assert.equal(JSON.parse(verifyOutput).ok, true);

    await updateRow('Configuracion', key, { Valor: 'after-backup' });
    assert.equal((await findById('Configuracion', key)).Valor, 'after-backup');

    const restoreOutput = execFileSync(process.execPath, [restoreScript, '--file', backup.outputPath, '--apply', '--replace'], {
      env: process.env,
      encoding: 'utf8',
    });
    const restored = JSON.parse(restoreOutput);
    assert.equal(restored.ok, true);
    assert.ok(restored.tables > 0);
    assert.ok(restored.rows >= 1);
    assert.equal((await findById('Configuracion', key)).Valor, 'before-backup');
  } finally {
    await query('DELETE FROM "Configuracion" WHERE "Clave"=$1', [key], { label: 'test.backup.cleanup', write: true }).catch(() => {});
    await cleanupPortableBackup(backup).catch(() => {});
  }
});

test.after(async () => { await closePostgres(); });
