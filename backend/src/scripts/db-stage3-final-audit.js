import { createHash } from 'node:crypto';
import { DATABASE_TABLES } from '../config/database-tables.js';
import { scriptPool, quoted } from './db-script.js';

const EXPECTED = Object.freeze({
  sourceSha256: '20c811d40231e7c2627fedeb32fcd748056aa77c0ebf5db037e360951e694512',
  sourceSizeBytes: 7961988,
  sheets: 66,
  rawRows: 31345,
  canonicalRows: 15958,
  validCanonicalRows: 15956,
  legacyRows: 15387,
  anomalyCount: 1656,
  anomalyTypes: {
    DUPLICATE_ID: 20,
    MALFORMED_ROW: 2,
    INVALID_JSON: 1352,
    ORPHAN_REFERENCE: 282,
  },
  actividadAppRawRows: 12325,
  nextStandardTicket: '657',
  nextMaintenanceTicket: 'M206',
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

const pool = scriptPool();
const client = await pool.connect();
let ok = true;
const problems = [];

function fail(message) {
  ok = false;
  problems.push(message);
}

try {
  const runs = await client.query(
    `SELECT migration_run_id,source_sha256,source_size_bytes,source_sheet_count,
            source_row_count,status,report,completed_at
       FROM migration_runs
      WHERE source_sha256=$1
      ORDER BY completed_at NULLS LAST, migration_run_id`,
    [EXPECTED.sourceSha256],
  );
  const appliedRuns = runs.rows.filter((row) => row.status === 'APPLIED');
  const runningRuns = runs.rows.filter((row) => row.status === 'RUNNING');
  if (appliedRuns.length !== 1) fail(`expected exactly one APPLIED run for source SHA, got ${appliedRuns.length}`);
  if (runningRuns.length !== 0) fail(`unexpected RUNNING imports for source SHA: ${runningRuns.length}`);
  const run = appliedRuns[0];
  if (!run) throw new Error('No APPLIED Stage 3 migration run found for expected source SHA.');
  const runId = run.migration_run_id;

  if (Number(run.source_size_bytes) !== EXPECTED.sourceSizeBytes) fail('source size mismatch');
  if (Number(run.source_sheet_count) !== EXPECTED.sheets) fail('source sheet count mismatch');
  if (Number(run.source_row_count) !== EXPECTED.rawRows) fail('source row count mismatch');

  const report = run.report && typeof run.report === 'object' ? run.report : {};
  for (const [field, expected] of [
    ['sourceSha256', EXPECTED.sourceSha256],
    ['sourceSizeBytes', EXPECTED.sourceSizeBytes],
    ['sheets', EXPECTED.sheets],
    ['sourceRows', EXPECTED.rawRows],
    ['rawRows', EXPECTED.rawRows],
    ['canonicalRows', EXPECTED.canonicalRows],
    ['validCanonicalRows', EXPECTED.validCanonicalRows],
    ['legacyRows', EXPECTED.legacyRows],
    ['anomalyCount', EXPECTED.anomalyCount],
  ]) {
    if (String(report[field]) !== String(expected)) fail(`stored migration report ${field} mismatch`);
  }
  for (const [type, expected] of Object.entries(EXPECTED.anomalyTypes)) {
    if (Number(report.anomalyTypes?.[type] || 0) !== expected) fail(`stored migration report anomaly ${type} mismatch`);
  }

  const reconciliation = await client.query(
    `SELECT sheet_name,source_rows,raw_rows,canonical_rows,valid_canonical_rows,
            duplicates,malformed,orphans,checksum,status
       FROM migration_reconciliation
      WHERE migration_run_id=$1
      ORDER BY sheet_name`,
    [runId],
  );
  if (reconciliation.rowCount !== EXPECTED.sheets) fail(`reconciliation sheet count ${reconciliation.rowCount} != ${EXPECTED.sheets}`);
  const reconBySheet = new Map(reconciliation.rows.map((row) => [row.sheet_name, row]));

  const raw = await client.query(
    `SELECT sheet_name,source_row_number,row_checksum
       FROM migration_sheet_rows
      WHERE migration_run_id=$1
      ORDER BY sheet_name,source_row_number`,
    [runId],
  );
  if (raw.rowCount !== EXPECTED.rawRows) fail(`raw row total ${raw.rowCount} != ${EXPECTED.rawRows}`);
  const rawBySheet = new Map();
  for (const row of raw.rows) {
    const list = rawBySheet.get(row.sheet_name) || [];
    list.push(row);
    rawBySheet.set(row.sheet_name, list);
    if (!row.row_checksum) fail(`${row.sheet_name}:${row.source_row_number} missing raw checksum`);
  }
  for (const [sheetName, recon] of reconBySheet) {
    const rows = rawBySheet.get(sheetName) || [];
    if (rows.length !== Number(recon.raw_rows)) fail(`${sheetName} raw count ${rows.length} != ${recon.raw_rows}`);
    if (Number(recon.source_rows) !== Number(recon.raw_rows)) fail(`${sheetName} source/raw reconciliation mismatch`);
    const checksum = sha256(rows.map((row) => `${row.source_row_number}:${row.row_checksum}`).join('|'));
    if (checksum !== recon.checksum) fail(`${sheetName} aggregate raw checksum mismatch`);
    if (recon.status !== 'READY') fail(`${sheetName} reconciliation status ${recon.status} != READY`);
  }

  const reconTotals = reconciliation.rows.reduce((acc, row) => {
    acc.raw += Number(row.raw_rows || 0);
    acc.canonical += Number(row.canonical_rows || 0);
    acc.valid += Number(row.valid_canonical_rows || 0);
    acc.duplicates += Number(row.duplicates || 0);
    acc.malformed += Number(row.malformed || 0);
    acc.orphans += Number(row.orphans || 0);
    return acc;
  }, { raw: 0, canonical: 0, valid: 0, duplicates: 0, malformed: 0, orphans: 0 });
  if (reconTotals.raw !== EXPECTED.rawRows) fail(`reconciliation raw total ${reconTotals.raw} != ${EXPECTED.rawRows}`);
  if (reconTotals.canonical !== EXPECTED.canonicalRows) fail(`reconciliation canonical total ${reconTotals.canonical} != ${EXPECTED.canonicalRows}`);
  if (reconTotals.valid !== EXPECTED.validCanonicalRows) fail(`reconciliation valid total ${reconTotals.valid} != ${EXPECTED.validCanonicalRows}`);
  if (reconTotals.duplicates !== EXPECTED.anomalyTypes.DUPLICATE_ID) fail('duplicate reconciliation total mismatch');
  if (reconTotals.malformed !== EXPECTED.anomalyTypes.MALFORMED_ROW) fail('malformed reconciliation total mismatch');
  if (reconTotals.orphans !== EXPECTED.anomalyTypes.ORPHAN_REFERENCE) fail('orphan reconciliation total mismatch');

  let canonicalRows = 0;
  let validCanonicalRows = 0;
  let rawCanonicalChecksumMismatches = 0;
  for (const name of Object.keys(DATABASE_TABLES)) {
    const result = await client.query(
      `SELECT COUNT(*)::bigint AS total,
              COUNT(*) FILTER (WHERE c."__valid"=TRUE)::bigint AS valid,
              COUNT(*) FILTER (
                WHERE r.source_row_number IS NULL
                   OR COALESCE(r.row_checksum,'') <> COALESCE(c."__row_checksum",'')
              )::bigint AS checksum_mismatches
         FROM ${quoted(name)} c
         LEFT JOIN migration_sheet_rows r
           ON r.migration_run_id=c."__migration_run_id"
          AND r.sheet_name=$2
          AND r.source_row_number=c."__source_row_number"
        WHERE c."__migration_run_id"=$1`,
      [runId, name],
    );
    const total = Number(result.rows[0]?.total || 0);
    const valid = Number(result.rows[0]?.valid || 0);
    const mismatches = Number(result.rows[0]?.checksum_mismatches || 0);
    canonicalRows += total;
    validCanonicalRows += valid;
    rawCanonicalChecksumMismatches += mismatches;
    const recon = reconBySheet.get(name);
    if (!recon) fail(`missing reconciliation row for operational table ${name}`);
    else {
      if (total !== Number(recon.canonical_rows)) fail(`${name} canonical count mismatch`);
      if (valid !== Number(recon.valid_canonical_rows)) fail(`${name} valid canonical count mismatch`);
    }
    if (mismatches !== 0) fail(`${name} has ${mismatches} RAW/canonical checksum mismatches`);
  }
  if (canonicalRows !== EXPECTED.canonicalRows) fail(`canonical total ${canonicalRows} != ${EXPECTED.canonicalRows}`);
  if (validCanonicalRows !== EXPECTED.validCanonicalRows) fail(`valid canonical total ${validCanonicalRows} != ${EXPECTED.validCanonicalRows}`);

  const anomalies = await client.query(
    `SELECT anomaly_type,COUNT(*)::bigint AS count
       FROM migration_anomalies
      WHERE migration_run_id=$1
      GROUP BY anomaly_type
      ORDER BY anomaly_type`,
    [runId],
  );
  const anomalyCounts = Object.fromEntries(anomalies.rows.map((row) => [row.anomaly_type, Number(row.count)]));
  const anomalyTotal = Object.values(anomalyCounts).reduce((sum, value) => sum + value, 0);
  if (anomalyTotal !== EXPECTED.anomalyCount) fail(`anomaly total ${anomalyTotal} != ${EXPECTED.anomalyCount}`);
  for (const [type, expected] of Object.entries(EXPECTED.anomalyTypes)) {
    if (Number(anomalyCounts[type] || 0) !== expected) fail(`anomaly ${type} ${anomalyCounts[type] || 0} != ${expected}`);
  }

  const actividadRaw = await client.query(
    `SELECT COUNT(*)::bigint AS count
       FROM migration_sheet_rows
      WHERE migration_run_id=$1 AND sheet_name='ActividadApp'`,
    [runId],
  );
  if (DATABASE_TABLES.ActividadApp) fail('ActividadApp must remain legacy/raw-only');
  if (Number(actividadRaw.rows[0]?.count || 0) !== EXPECTED.actividadAppRawRows) fail('ActividadApp RAW preservation mismatch');

  const sync = await client.query(
    'SELECT generation,schema_version,legacy_sheets_cursor,migration_run_id FROM sync_state WHERE singleton=TRUE',
  );
  const syncRow = sync.rows[0];
  if (!syncRow) fail('sync_state row missing');
  else {
    if (Number(syncRow.schema_version) !== 2) fail(`sync_state schema_version ${syncRow.schema_version} != 2`);
    if (String(syncRow.generation) !== String(runId)) fail('sync_state generation does not match import run');
    if (String(syncRow.migration_run_id) !== String(runId)) fail('sync_state migration_run_id does not match import run');
    if (!String(syncRow.legacy_sheets_cursor || '')) fail('legacy Sheets cursor metadata missing');
  }

  // This is the exact first database gate used by db-import-xlsx.js after the
  // workbook has been analyzed. An APPLIED row for the same SHA makes a rerun
  // exit before checking non-empty operational tables or writing anything.
  const sameShaGate = await client.query(
    `SELECT migration_run_id
       FROM migration_runs
      WHERE source_sha256=$1 AND status='APPLIED'
      ORDER BY completed_at DESC
      LIMIT 1`,
    [EXPECTED.sourceSha256],
  );
  const importerSameShaWouldSkip = String(sameShaGate.rows[0]?.migration_run_id || '') === String(runId);
  if (!importerSameShaWouldSkip) fail('same-SHA importer idempotence gate did not resolve to applied run');

  const beforeSequences = await client.query('SELECT entity,next_value FROM runtime_sequences ORDER BY entity');
  const beforeSnapshot = JSON.stringify(beforeSequences.rows);
  await client.query('BEGIN');
  let standardValue = '';
  let maintenanceValue = '';
  try {
    const standard = await client.query("SELECT dms_next_ticket_number('STANDARD') AS value");
    const maintenance = await client.query("SELECT dms_next_ticket_number('MAINTENANCE') AS value");
    standardValue = String(standard.rows[0]?.value || '');
    maintenanceValue = String(maintenance.rows[0]?.value || '');
    if (standardValue !== EXPECTED.nextStandardTicket) fail(`next standard ticket ${standardValue} != ${EXPECTED.nextStandardTicket}`);
    if (maintenanceValue !== EXPECTED.nextMaintenanceTicket) fail(`next maintenance ticket ${maintenanceValue} != ${EXPECTED.nextMaintenanceTicket}`);
  } finally {
    await client.query('ROLLBACK');
  }
  const afterSequences = await client.query('SELECT entity,next_value FROM runtime_sequences ORDER BY entity');
  const sequenceRolledBack = JSON.stringify(afterSequences.rows) === beforeSnapshot;
  if (!sequenceRolledBack) fail('sequence probe left persistent changes');

  const migration007 = await client.query(
    `SELECT 1
       FROM schema_migrations
      WHERE version='007_preserve_full_maintenance_ticket_number.sql'`,
  );
  if (migration007.rowCount !== 1) fail('migration 007 is not recorded as applied');

  console.log(JSON.stringify({
    step: 'stage3-final-audit',
    ok,
    runId,
    sourceSha256: EXPECTED.sourceSha256,
    sourceSizeBytes: EXPECTED.sourceSizeBytes,
    sheets: reconciliation.rowCount,
    rawRows: raw.rowCount,
    canonicalRows,
    validCanonicalRows,
    legacyRows: EXPECTED.legacyRows,
    anomalies: anomalyTotal,
    anomalyTypes: anomalyCounts,
    actividadAppRawRows: Number(actividadRaw.rows[0]?.count || 0),
    rawCanonicalChecksumMismatches,
    syncState: syncRow ? {
      schemaVersion: Number(syncRow.schema_version),
      generationMatchesRun: String(syncRow.generation) === String(runId),
      migrationRunMatches: String(syncRow.migration_run_id) === String(runId),
      legacySheetsCursorPresent: String(syncRow.legacy_sheets_cursor || '').length > 0,
    } : null,
    idempotence: {
      appliedRunsForSourceSha: appliedRuns.length,
      runningRunsForSourceSha: runningRuns.length,
      importerSameShaWouldSkip,
    },
    sequenceProbe: {
      standard: standardValue,
      maintenance: maintenanceValue,
      rolledBack: sequenceRolledBack,
    },
    migration007Applied: migration007.rowCount === 1,
    problems: problems.slice(0, 100),
  }, null, 2));

  if (!ok) process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
