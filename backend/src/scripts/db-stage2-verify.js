import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATABASE_TABLES } from '../config/database-tables.js';
import { scriptPool } from './db-script.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, '../../migrations');
const pool = scriptPool();
const checksum = (value) => createHash('sha256').update(value).digest('hex');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function report(step, detail = {}) {
  console.log(JSON.stringify({ step, ok: true, ...detail }));
}

try {
  const connection = await pool.query(`
    SELECT current_database() AS database_name,
           current_user AS database_user,
           current_setting('server_version') AS server_version
  `);
  report('connection', {
    database: connection.rows[0].database_name,
    user: connection.rows[0].database_user,
    serverVersion: connection.rows[0].server_version,
  });

  const schemaRelation = await pool.query("SELECT to_regclass('public.schema_migrations') AS name");
  assert(schemaRelation.rows[0]?.name, 'schema_migrations no existe; ejecute db:migrate antes de esta verificación.');

  const migrationFiles = (await readdir(migrationsDir)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  const applied = await pool.query('SELECT version, checksum FROM schema_migrations ORDER BY version');
  const appliedByVersion = new Map(applied.rows.map((row) => [row.version, row.checksum]));
  for (const file of migrationFiles) {
    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    const actualChecksum = appliedByVersion.get(file);
    assert(actualChecksum, `Falta la migración aplicada ${file}.`);
    assert(actualChecksum === checksum(sql), `Checksum distinto para la migración aplicada ${file}.`);
  }
  report('schema_migrations', { expected: migrationFiles.length, applied: applied.rows.length });

  const expectedTables = new Set([
    ...Object.keys(DATABASE_TABLES),
    'schema_migrations',
    'migration_runs',
    'migration_sheet_rows',
    'migration_anomalies',
    'migration_reconciliation',
    'sync_state',
    'runtime_sequences',
  ]);
  const tables = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
  const existingTables = new Set(tables.rows.map((row) => row.tablename));
  const missingTables = [...expectedTables].filter((name) => !existingTables.has(name));
  assert(!missingTables.length, `Faltan tablas PostgreSQL: ${missingTables.join(', ')}`);
  report('tables', { expectedAtLeast: expectedTables.size, present: existingTables.size });

  const requiredIndexes = [
    'ix_boletas_estado',
    'ix_boletas_fecha',
    'ix_boletas_clienteid',
    'ix_boletaasignados_boletauid',
    'ix_boletaasignados_usuarioid',
    'ix_evidenciasboleta_boletauid',
    'ix_clientes_clienteid',
    'ix_clienteubicaciones_clienteid',
    'ix_agendas_fecha',
    'ix_casosclientes_casoid',
    'ix_sesiones_tokenhash',
    'ix_sesiones_usuarioid',
    'ix_sesiones_revocada',
    'ix_syncchanges_resource_entityid',
    'ux_syncchanges_cursor',
  ];
  const indexes = await pool.query("SELECT indexname FROM pg_indexes WHERE schemaname='public'");
  const existingIndexes = new Set(indexes.rows.map((row) => row.indexname));
  const missingIndexes = requiredIndexes.filter((name) => !existingIndexes.has(name));
  assert(!missingIndexes.length, `Faltan índices críticos: ${missingIndexes.join(', ')}`);
  report('indexes', { required: requiredIndexes.length, present: indexes.rows.length });

  const syncState = await pool.query(`
    SELECT singleton, generation, schema_version, legacy_sheets_cursor, migration_run_id, unsafe, unsafe_reason
    FROM sync_state
  `);
  assert(syncState.rows.length === 1, `sync_state debe tener exactamente una fila; tiene ${syncState.rows.length}.`);
  const state = syncState.rows[0];
  assert(state.singleton === true, 'sync_state.singleton debe ser TRUE.');
  assert(Number(state.schema_version) >= 2, `sync_state.schema_version inválido: ${state.schema_version}.`);
  assert(String(state.generation || '').trim(), 'sync_state.generation está vacío.');
  report('sync_state', {
    schemaVersion: Number(state.schema_version),
    generation: String(state.generation),
    unsafe: Boolean(state.unsafe),
    migrationRunAssigned: Boolean(state.migration_run_id),
  });

  const client = await pool.connect();
  try {
    await client.query('CREATE TEMP TABLE stage2_transaction_probe (id INTEGER PRIMARY KEY) ON COMMIT PRESERVE ROWS');

    await client.query('BEGIN');
    await client.query('INSERT INTO stage2_transaction_probe(id) VALUES (1)');
    await client.query('ROLLBACK');
    const afterRollback = await client.query('SELECT COUNT(*)::int AS count FROM stage2_transaction_probe');
    assert(afterRollback.rows[0].count === 0, 'ROLLBACK no revirtió la escritura temporal de prueba.');

    await client.query('BEGIN');
    await client.query('INSERT INTO stage2_transaction_probe(id) VALUES (2)');
    await client.query('COMMIT');
    const afterCommit = await client.query('SELECT COUNT(*)::int AS count FROM stage2_transaction_probe');
    assert(afterCommit.rows[0].count === 1, 'COMMIT no conservó la escritura temporal de prueba.');
    await client.query('DROP TABLE stage2_transaction_probe');
    report('transactions', { rollback: 'ok', commit: 'ok' });
  } finally {
    client.release();
  }

  const configuredMax = Number(pool.options?.max || 0);
  assert(configuredMax >= 1 && configuredMax <= 4, `Pool fuera del límite conservador esperado: ${configuredMax}.`);
  const fanout = Math.min(configuredMax, 3);
  await Promise.all(Array.from({ length: fanout }, () => pool.query('SELECT pg_sleep(0.05)')));
  const activity = await pool.query(`
    SELECT COUNT(*)::int AS count
    FROM pg_stat_activity
    WHERE datname=current_database()
      AND application_name='dms-boletas-migration'
  `);
  assert(pool.totalCount <= configuredMax, `El pool abrió ${pool.totalCount} conexiones con máximo ${configuredMax}.`);
  assert(pool.waitingCount === 0, `El pool dejó ${pool.waitingCount} solicitudes esperando.`);
  report('pool', {
    configuredMax,
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
    visibleDatabaseConnections: activity.rows[0].count,
  });

  report('stage2', { status: 'PASS' });
} finally {
  await pool.end();
}
