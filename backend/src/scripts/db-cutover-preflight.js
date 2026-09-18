import { DATABASE_TABLES } from '../config/database-tables.js';
import { scriptPool, quoted } from './db-script.js';

function requiredArg(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? String(process.argv[index + 1] || '').trim() : '';
  if (!value) throw new Error(`Falta ${name} <sha256>.`);
  return value;
}

const currentSha = requiredArg('--current-source-sha');
const nextSha = requiredArg('--next-source-sha');
if (currentSha === nextSha) throw new Error('El SHA actual y el nuevo no pueden ser iguales.');

const pool = scriptPool();
const client = await pool.connect();
let ok = true;
const problems = [];
const tables = [];

function fail(message) {
  ok = false;
  problems.push(message);
}

try {
  const currentRuns = await client.query(
    `SELECT migration_run_id,status,completed_at
       FROM migration_runs
      WHERE source_sha256=$1 AND status='APPLIED'
      ORDER BY completed_at DESC NULLS LAST`,
    [currentSha],
  );
  if (currentRuns.rowCount !== 1) fail(`expected one current APPLIED run, got ${currentRuns.rowCount}`);
  const currentRunId = currentRuns.rows[0]?.migration_run_id;
  if (!currentRunId) throw new Error('No se encontró el run APPLIED del snapshot actual.');

  const nextRuns = await client.query(
    `SELECT migration_run_id,status
       FROM migration_runs
      WHERE source_sha256=$1 AND status='APPLIED'`,
    [nextSha],
  );
  if (nextRuns.rowCount !== 0) fail(`new source SHA is already APPLIED (${nextRuns.rowCount} run(s))`);

  const sync = await client.query(
    'SELECT generation,schema_version,migration_run_id,unsafe,unsafe_reason FROM sync_state WHERE singleton=TRUE',
  );
  const syncRow = sync.rows[0];
  if (!syncRow) fail('sync_state row missing');
  else {
    if (Number(syncRow.schema_version) !== 2) fail(`sync_state schema_version ${syncRow.schema_version} != 2`);
    if (String(syncRow.migration_run_id || '') !== String(currentRunId)) fail('sync_state migration_run_id does not match current import');
    if (Boolean(syncRow.unsafe)) fail(`sync_state is unsafe: ${syncRow.unsafe_reason || 'unknown'}`);
  }

  const reconciliation = await client.query(
    `SELECT sheet_name,canonical_rows,valid_canonical_rows
       FROM migration_reconciliation
      WHERE migration_run_id=$1`,
    [currentRunId],
  );
  const reconByTable = new Map(reconciliation.rows.map((row) => [row.sheet_name, row]));

  for (const name of Object.keys(DATABASE_TABLES)) {
    const recon = reconByTable.get(name);
    if (!recon) {
      fail(`missing reconciliation row for ${name}`);
      continue;
    }
    const result = await client.query(
      `SELECT
         COUNT(*)::bigint AS total,
         COUNT(*) FILTER (WHERE c."__migration_run_id"=$1)::bigint AS imported,
         COUNT(*) FILTER (WHERE c."__migration_run_id" IS DISTINCT FROM $1)::bigint AS divergent,
         COUNT(*) FILTER (
           WHERE c."__migration_run_id"=$1
             AND (
               r.source_row_number IS NULL
               OR NOT (COALESCE(c."__payload",'{}'::jsonb) @> COALESCE(r.row_data,'{}'::jsonb))
             )
         )::bigint AS payload_divergent
       FROM ${quoted(name)} c
       LEFT JOIN migration_sheet_rows r
         ON r.migration_run_id=c."__migration_run_id"
        AND r.sheet_name=$2
        AND r.source_row_number=c."__source_row_number"`,
      [currentRunId, name],
    );
    const row = result.rows[0] || {};
    const summary = {
      table: name,
      expected: Number(recon.canonical_rows || 0),
      total: Number(row.total || 0),
      imported: Number(row.imported || 0),
      divergent: Number(row.divergent || 0),
      payloadDivergent: Number(row.payload_divergent || 0),
    };
    tables.push(summary);
    if (summary.total !== summary.expected) fail(`${name} total ${summary.total} != imported snapshot ${summary.expected}`);
    if (summary.imported !== summary.expected) fail(`${name} imported rows ${summary.imported} != ${summary.expected}`);
    if (summary.divergent !== 0) fail(`${name} has ${summary.divergent} post-import/runtime row(s)`);
    if (summary.payloadDivergent !== 0) fail(`${name} has ${summary.payloadDivergent} row(s) changed since import`);
  }

  console.log(JSON.stringify({
    step: 'cutover-preflight',
    ok,
    safeToReplace: ok,
    currentSourceSha: currentSha,
    nextSourceSha: nextSha,
    currentRunId,
    syncState: syncRow ? {
      schemaVersion: Number(syncRow.schema_version),
      migrationRunMatches: String(syncRow.migration_run_id || '') === String(currentRunId),
      unsafe: Boolean(syncRow.unsafe),
    } : null,
    checkedOperationalTables: tables.length,
    divergentTables: tables.filter((row) => row.total !== row.expected || row.divergent || row.payloadDivergent),
    problems: problems.slice(0, 100),
  }, null, 2));

  if (!ok) process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
