import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ExcelJS from 'exceljs';
import pg from 'pg';
import { EXPECTED_WORKBOOK_SHEETS } from '../src/config/database-tables.js';

const testDatabaseUrl = String(process.env.TEST_DATABASE_URL || '').trim();
if (!testDatabaseUrl) {
  throw new Error('xlsx-import-idempotence.mjs requires TEST_DATABASE_URL. Production DATABASE_URL is never accepted.');
}

const backendRoot = path.resolve(import.meta.dirname, '..');
const env = {
  ...process.env,
  NODE_ENV: 'test',
  TEST_DATABASE_URL: testDatabaseUrl,
  PG_SSL_MODE: 'disable',
};

function runNode(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: backendRoot,
    env,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `command failed: node ${args.join(' ')}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return result;
}

test('same XLSX SHA is applied once and a second import is a no-op', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dms-xlsx-idempotence-'));
  const file = path.join(dir, 'fixture.xlsx');
  const pool = new pg.Pool({ connectionString: testDatabaseUrl, max: 1 });
  try {
    runNode(['src/scripts/db-migrate.js']);

    const workbook = new ExcelJS.Workbook();
    for (const [name, spec] of Object.entries(EXPECTED_WORKBOOK_SHEETS)) {
      const ws = workbook.addWorksheet(name);
      ws.addRow(spec.columns);
    }
    const config = workbook.getWorksheet('Configuracion');
    const configRow = (value) => config.getRow(1).values.slice(1).map((header) => {
      if (header === 'Clave') return 'IDEMPOTENCE_TEST';
      if (header === 'Valor') return value;
      return '';
    });
    config.addRow(configRow('first'));
    config.addRow(configRow('second'));

    const malformed = workbook.getWorksheet('FirmaMantenimientoSolicitudes');
    malformed.addRow(malformed.getRow(1).values.slice(1).map((header) => {
      if (header === 'Estado') return 'DESPLAZADO';
      return '';
    }));
    await workbook.xlsx.writeFile(file);

    const first = runNode(['src/scripts/db-import-xlsx.js', '--file', file, '--apply']);
    assert.match(first.stdout, /Applied migration run /);

    const before = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM migration_runs WHERE status='APPLIED') AS runs,
        (SELECT COUNT(*)::int FROM migration_sheet_rows) AS raw_rows,
        (SELECT COUNT(*)::int FROM "Configuracion") AS config_rows,
        (SELECT COUNT(*)::int FROM "FirmaMantenimientoSolicitudes") AS signature_rows,
        (SELECT COUNT(*)::int FROM "FirmaMantenimientoSolicitudes" WHERE "__valid"=FALSE) AS invalid_rows,
        (SELECT COUNT(*)::int FROM migration_anomalies WHERE anomaly_type='DUPLICATE_ID') AS duplicate_anomalies,
        (SELECT COUNT(*)::int FROM migration_anomalies WHERE anomaly_type='MALFORMED_ROW') AS malformed_anomalies
    `);

    const second = runNode(['src/scripts/db-import-xlsx.js', '--file', file, '--apply']);
    assert.match(second.stdout, /Workbook already applied: run=/);

    const after = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM migration_runs WHERE status='APPLIED') AS runs,
        (SELECT COUNT(*)::int FROM migration_sheet_rows) AS raw_rows,
        (SELECT COUNT(*)::int FROM "Configuracion") AS config_rows,
        (SELECT COUNT(*)::int FROM "FirmaMantenimientoSolicitudes") AS signature_rows,
        (SELECT COUNT(*)::int FROM "FirmaMantenimientoSolicitudes" WHERE "__valid"=FALSE) AS invalid_rows,
        (SELECT COUNT(*)::int FROM migration_anomalies WHERE anomaly_type='DUPLICATE_ID') AS duplicate_anomalies,
        (SELECT COUNT(*)::int FROM migration_anomalies WHERE anomaly_type='MALFORMED_ROW') AS malformed_anomalies
    `);

    assert.deepEqual(after.rows[0], before.rows[0]);
    assert.equal(after.rows[0].runs, 1);
    assert.equal(after.rows[0].raw_rows, 3);
    assert.equal(after.rows[0].config_rows, 2);
    assert.equal(after.rows[0].signature_rows, 1);
    assert.equal(after.rows[0].invalid_rows, 1);
    assert.equal(after.rows[0].duplicate_anomalies, 1);
    assert.equal(after.rows[0].malformed_anomalies, 1);
  } finally {
    await pool.end();
    await rm(dir, { recursive: true, force: true });
  }
});
