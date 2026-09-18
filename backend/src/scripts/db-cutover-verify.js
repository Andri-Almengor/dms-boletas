import { DATABASE_TABLES, DUPLICATE_TOLERANT_TABLES } from '../config/database-tables.js';
import { scriptPool, quoted } from './db-script.js';

function requiredArg(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? String(process.argv[index + 1] || '').trim() : '';
  if (!value) throw new Error(`Falta ${name} <sha256>.`);
  return value;
}

const sourceSha = requiredArg('--source-sha');
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
  const runs = await client.query(
    `SELECT migration_run_id,source_row_count,source_sheet_count,report,status,completed_at
       FROM migration_runs
      WHERE source_sha256=$1 AND status='APPLIED'
      ORDER BY completed_at DESC NULLS LAST`,
    [sourceSha],
  );
  if (runs.rowCount !== 1) fail(`expected exactly one APPLIED run for new source SHA, got ${runs.rowCount}`);
  const run = runs.rows[0];
  if (!run) throw new Error('No se encontró importación APPLIED para el snapshot nuevo.');
  const runId = run.migration_run_id;

  const reconciliation = await client.query(
    `SELECT sheet_name,raw_rows,canonical_rows,valid_canonical_rows,duplicates,malformed,orphans
       FROM migration_reconciliation
      WHERE migration_run_id=$1`,
    [runId],
  );
  const reconByTable = new Map(reconciliation.rows.map((row) => [row.sheet_name, row]));
  const raw = await client.query(
    'SELECT COUNT(*)::bigint AS count FROM migration_sheet_rows WHERE migration_run_id=$1',
    [runId],
  );
  const expectedRaw = reconciliation.rows.reduce((sum, row) => sum + Number(row.raw_rows || 0), 0);
  if (Number(raw.rows[0]?.count || 0) !== expectedRaw) fail('RAW row total does not match reconciliation');

  let canonicalRows = 0;
  let validRows = 0;
  for (const [name, meta] of Object.entries(DATABASE_TABLES)) {
    const recon = reconByTable.get(name);
    if (!recon) {
      fail(`missing reconciliation row for ${name}`);
      continue;
    }
    const result = await client.query(
      `SELECT
         COUNT(*)::bigint AS total,
         COUNT(*) FILTER (WHERE c."__valid"=TRUE)::bigint AS valid,
         COUNT(*) FILTER (WHERE c."__migration_run_id"=$1)::bigint AS current_run,
         COUNT(*) FILTER (WHERE c."__migration_run_id" IS DISTINCT FROM $1)::bigint AS other_run,
         COUNT(*) FILTER (
           WHERE c."__migration_run_id"=$1
             AND (
               r.source_row_number IS NULL
               OR NOT (COALESCE(c."__payload",'{}'::jsonb) @> COALESCE(r.row_data,'{}'::jsonb))
             )
         )::bigint AS payload_mismatch
       FROM ${quoted(name)} c
       LEFT JOIN migration_sheet_rows r
         ON r.migration_run_id=c."__migration_run_id"
        AND r.sheet_name=$2
        AND r.source_row_number=c."__source_row_number"`,
      [runId, name],
    );
    const row = result.rows[0] || {};
    const total = Number(row.total || 0);
    const valid = Number(row.valid || 0);
    const currentRun = Number(row.current_run || 0);
    const otherRun = Number(row.other_run || 0);
    const payloadMismatch = Number(row.payload_mismatch || 0);
    canonicalRows += total;
    validRows += valid;

    let duplicateIds = 0;
    if (!DUPLICATE_TOLERANT_TABLES.has(name)) {
      const duplicateResult = await client.query(
        `SELECT COUNT(*)::int AS groups
           FROM (
             SELECT ${quoted(meta.id)}
               FROM ${quoted(name)}
              WHERE BTRIM(COALESCE(${quoted(meta.id)},'')) <> ''
              GROUP BY ${quoted(meta.id)}
             HAVING COUNT(*) > 1
           ) d`,
      );
      duplicateIds = Number(duplicateResult.rows[0]?.groups || 0);
    }

    const summary = {
      table: name,
      expected: Number(recon.canonical_rows || 0),
      expectedValid: Number(recon.valid_canonical_rows || 0),
      total,
      valid,
      currentRun,
      otherRun,
      payloadMismatch,
      duplicateIds,
    };
    tables.push(summary);
    if (total !== summary.expected) fail(`${name} total ${total} != ${summary.expected}`);
    if (valid !== summary.expectedValid) fail(`${name} valid ${valid} != ${summary.expectedValid}`);
    if (currentRun !== total) fail(`${name} contains rows outside the new migration run`);
    if (otherRun !== 0) fail(`${name} contains ${otherRun} row(s) from another source/runtime`);
    if (payloadMismatch !== 0) fail(`${name} contains ${payloadMismatch} payload mismatch(es)`);
    if (duplicateIds !== 0) fail(`${name} contains ${duplicateIds} unexpected duplicate ID group(s)`);
  }

  const sync = await client.query(
    'SELECT generation,schema_version,migration_run_id,unsafe,unsafe_reason FROM sync_state WHERE singleton=TRUE',
  );
  const syncRow = sync.rows[0];
  if (!syncRow) fail('sync_state row missing');
  else {
    if (Number(syncRow.schema_version) !== 2) fail(`sync_state schema_version ${syncRow.schema_version} != 2`);
    if (String(syncRow.migration_run_id || '') !== String(runId)) fail('sync_state migration_run_id does not match new import');
    if (!String(syncRow.generation || '').startsWith(String(runId))) fail('sync_state generation does not belong to new import');
    if (Boolean(syncRow.unsafe)) fail(`sync_state unsafe: ${syncRow.unsafe_reason || 'unknown'}`);
  }

  const report = run.report && typeof run.report === 'object' ? run.report : {};
  console.log(JSON.stringify({
    step: 'cutover-verify',
    ok,
    sourceSha256: sourceSha,
    runId,
    sourceRows: Number(run.source_row_count || 0),
    sheets: Number(run.source_sheet_count || 0),
    rawRows: Number(raw.rows[0]?.count || 0),
    canonicalRows,
    validCanonicalRows: validRows,
    legacyRows: Number(raw.rows[0]?.count || 0) - canonicalRows,
    anomalyCount: Number(report.anomalyCount || 0),
    anomalyTypes: report.anomalyTypes || {},
    syncState: syncRow ? {
      schemaVersion: Number(syncRow.schema_version),
      migrationRunMatches: String(syncRow.migration_run_id || '') === String(runId),
      generation: String(syncRow.generation || ''),
      unsafe: Boolean(syncRow.unsafe),
    } : null,
    operationalTables: tables.length,
    duplicateFreeOperationalTables: tables.filter((row) => !DUPLICATE_TOLERANT_TABLES.has(row.table)).every((row) => row.duplicateIds === 0),
    exactNewSnapshotOnly: tables.every((row) => row.otherRun === 0 && row.currentRun === row.total),
    problems: problems.slice(0, 100),
  }, null, 2));

  if (!ok) process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
