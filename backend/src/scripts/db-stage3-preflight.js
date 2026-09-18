import { DATABASE_TABLES } from '../config/database-tables.js';
import { scriptPool, quoted } from './db-script.js';

function sourceShaArg(argv) {
  const index = argv.indexOf('--source-sha');
  if (index < 0 || !argv[index + 1]) throw new Error('Use --source-sha <sha256>.');
  return argv[index + 1];
}

const sourceSha = sourceShaArg(process.argv.slice(2));
const pool = scriptPool();
let ok = true;
const problems = [];

try {
  const tableCounts = [];
  let operationalRows = 0;
  for (const name of Object.keys(DATABASE_TABLES)) {
    const result = await pool.query(`SELECT COUNT(*)::bigint AS count FROM ${quoted(name)}`);
    const count = Number(result.rows[0]?.count || 0);
    operationalRows += count;
    if (count) tableCounts.push({ table: name, count });
  }

  if (operationalRows !== 0) {
    ok = false;
    problems.push(`operational database is not empty (${operationalRows} rows)`);
  }

  const prior = await pool.query(
    "SELECT COUNT(*)::int AS count FROM migration_runs WHERE source_sha256=$1 AND status='APPLIED'",
    [sourceSha],
  );
  const priorAppliedRuns = Number(prior.rows[0]?.count || 0);
  if (priorAppliedRuns !== 0) {
    ok = false;
    problems.push(`source SHA already has ${priorAppliedRuns} APPLIED migration run(s)`);
  }

  const raw = await pool.query('SELECT COUNT(*)::bigint AS count FROM migration_sheet_rows');
  const rawRows = Number(raw.rows[0]?.count || 0);
  if (rawRows !== 0) {
    ok = false;
    problems.push(`migration_sheet_rows is not empty (${rawRows} rows)`);
  }

  const sequences = await pool.query('SELECT entity,next_value FROM runtime_sequences ORDER BY entity');
  if (sequences.rowCount !== 0) {
    ok = false;
    problems.push(`runtime_sequences must be empty before the first XLSX import (${sequences.rowCount} rows)`);
  }

  const syncState = await pool.query(
    'SELECT generation,schema_version,migration_run_id FROM sync_state WHERE singleton=TRUE',
  );
  const state = syncState.rows[0] || null;
  if (!state || Number(state.schema_version) < 2 || state.migration_run_id) {
    ok = false;
    problems.push('sync_state is not in the expected pre-import state');
  }

  console.log(JSON.stringify({
    step: 'stage3-preflight',
    ok,
    sourceSha256: sourceSha,
    operationalRows,
    nonEmptyOperationalTables: tableCounts,
    priorAppliedRuns,
    rawRows,
    runtimeSequenceRows: sequences.rowCount,
    syncState: state ? {
      generation: state.generation,
      schemaVersion: Number(state.schema_version),
      migrationRunAssigned: Boolean(state.migration_run_id),
    } : null,
    problems,
  }, null, 2));

  if (!ok) process.exitCode = 1;
} finally {
  await pool.end();
}
