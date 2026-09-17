import { analyzeWorkbook, publicAnalysis } from './xlsx-migration.js';
import { DATABASE_TABLES } from '../config/database-tables.js';
import { scriptPool, quoted } from './db-script.js';

function fileArg(argv) {
  const index = argv.indexOf('--file');
  if (index < 0 || !argv[index + 1]) throw new Error('Use --file <ruta.xlsx>.');
  return argv[index + 1];
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function anomalyKey(item) {
  return JSON.stringify(stable({
    sheet: item.sheet || item.sheet_name || '',
    row: item.row ?? item.source_row_number ?? null,
    type: item.type || item.anomaly_type || '',
    column: item.column || item.column_name || '',
    referenceTable: item.referenceTable || item.reference_table || '',
    detail: item.detail || {},
  }));
}

const file = fileArg(process.argv.slice(2));
const analysis = await analyzeWorkbook(file);
const expected = publicAnalysis(analysis);
const pool = scriptPool();
const client = await pool.connect();
let ok = true;
const problems = [];

function fail(message) {
  ok = false;
  problems.push(message);
}

try {
  const runResult = await client.query(
    `SELECT migration_run_id,source_file_name,source_sha256,source_size_bytes,
            source_sheet_count,source_row_count,status
       FROM migration_runs
      WHERE source_sha256=$1 AND status='APPLIED'
      ORDER BY completed_at DESC
      LIMIT 1`,
    [analysis.file.sha256],
  );
  const run = runResult.rows[0];
  if (!run) throw new Error('No existe una importación APPLIED para este XLSX.');
  const runId = run.migration_run_id;

  if (run.source_sha256 !== analysis.file.sha256) fail('migration_runs source SHA mismatch');
  if (Number(run.source_size_bytes) !== analysis.file.size) fail('migration_runs source size mismatch');
  if (Number(run.source_sheet_count) !== analysis.workbook.sheetCount) fail('migration_runs sheet count mismatch');
  if (Number(run.source_row_count) !== analysis.workbook.sourceRows) fail('migration_runs source row count mismatch');

  const rawCount = await client.query(
    'SELECT COUNT(*)::bigint AS count FROM migration_sheet_rows WHERE migration_run_id=$1',
    [runId],
  );
  if (Number(rawCount.rows[0]?.count || 0) !== expected.rawRows) fail('raw row total mismatch');

  let canonicalRows = 0;
  let validCanonicalRows = 0;
  for (const [name, sheet] of analysis.sheets) {
    if (!DATABASE_TABLES[name]) continue;
    const result = await client.query(
      `SELECT COUNT(*)::bigint AS total,
              COUNT(*) FILTER (WHERE "__valid"=TRUE)::bigint AS valid
         FROM ${quoted(name)}
        WHERE "__migration_run_id"=$1`,
      [runId],
    );
    const total = Number(result.rows[0]?.total || 0);
    const valid = Number(result.rows[0]?.valid || 0);
    canonicalRows += total;
    validCanonicalRows += valid;
    const expectedSheet = analysis.reconciliation[name];
    if (total !== expectedSheet.canonicalRows) fail(`${name} canonical rows ${total} != ${expectedSheet.canonicalRows}`);
    if (valid !== expectedSheet.validCanonicalRows) fail(`${name} valid rows ${valid} != ${expectedSheet.validCanonicalRows}`);
  }
  if (canonicalRows !== expected.canonicalRows) fail(`canonical total ${canonicalRows} != ${expected.canonicalRows}`);
  if (validCanonicalRows !== expected.validCanonicalRows) fail(`valid canonical total ${validCanonicalRows} != ${expected.validCanonicalRows}`);

  const reconciliation = await client.query(
    `SELECT sheet_name,source_rows,raw_rows,canonical_rows,valid_canonical_rows,
            duplicates,malformed,orphans,checksum,status
       FROM migration_reconciliation
      WHERE migration_run_id=$1
      ORDER BY sheet_name`,
    [runId],
  );
  if (reconciliation.rowCount !== analysis.workbook.sheetCount) fail(`reconciliation sheet count ${reconciliation.rowCount} != ${analysis.workbook.sheetCount}`);
  const reconByName = new Map(reconciliation.rows.map((row) => [row.sheet_name, row]));
  for (const [name, source] of Object.entries(analysis.reconciliation)) {
    const actual = reconByName.get(name);
    if (!actual) { fail(`missing reconciliation row for ${name}`); continue; }
    for (const field of ['source_rows','raw_rows','canonical_rows','valid_canonical_rows','duplicates','malformed','orphans']) {
      const expectedField = {
        source_rows: source.sourceRows,
        raw_rows: source.rawRows,
        canonical_rows: source.canonicalRows,
        valid_canonical_rows: source.validCanonicalRows,
        duplicates: source.duplicates,
        malformed: source.malformed,
        orphans: source.orphans,
      }[field];
      if (Number(actual[field]) !== Number(expectedField)) fail(`${name} reconciliation ${field} mismatch`);
    }
    if (actual.checksum !== source.checksum) fail(`${name} reconciliation checksum mismatch`);
    if (actual.status !== source.status) fail(`${name} reconciliation status mismatch`);
  }

  const dbAnomalies = await client.query(
    `SELECT sheet_name,source_row_number,anomaly_type,column_name,reference_table,detail
       FROM migration_anomalies
      WHERE migration_run_id=$1`,
    [runId],
  );
  const expectedAnomalies = analysis.anomalies.map(anomalyKey).sort();
  const actualAnomalies = dbAnomalies.rows.map(anomalyKey).sort();
  if (actualAnomalies.length !== expectedAnomalies.length) fail(`anomaly count ${actualAnomalies.length} != ${expectedAnomalies.length}`);
  else {
    for (let index = 0; index < expectedAnomalies.length; index += 1) {
      if (actualAnomalies[index] !== expectedAnomalies[index]) { fail(`anomaly reconciliation mismatch at index ${index}`); break; }
    }
  }

  const sync = await client.query(
    'SELECT generation,schema_version,legacy_sheets_cursor,migration_run_id FROM sync_state WHERE singleton=TRUE',
  );
  const syncRow = sync.rows[0];
  if (!syncRow) fail('sync_state row missing');
  else {
    if (Number(syncRow.schema_version) !== 2) fail(`sync_state schema_version ${syncRow.schema_version} != 2`);
    if (String(syncRow.generation) !== String(runId)) fail('sync_state generation does not match migration run');
    if (String(syncRow.migration_run_id) !== String(runId)) fail('sync_state migration_run_id does not match migration run');
  }

  const actividadSource = analysis.sheets.get('ActividadApp')?.rows.length || 0;
  const actividadRaw = await client.query(
    `SELECT COUNT(*)::bigint AS count
       FROM migration_sheet_rows
      WHERE migration_run_id=$1 AND sheet_name='ActividadApp'`,
    [runId],
  );
  if (DATABASE_TABLES.ActividadApp) fail('ActividadApp must remain legacy/raw-only');
  if (Number(actividadRaw.rows[0]?.count || 0) !== actividadSource) fail('ActividadApp raw preservation mismatch');

  const beforeSequences = await client.query('SELECT entity,next_value FROM runtime_sequences ORDER BY entity');
  const beforeSnapshot = JSON.stringify(beforeSequences.rows);
  const standardSeed = await client.query(
    `SELECT COALESCE(MAX("BoletaID"::BIGINT),0)+1 AS next_value
       FROM "Boletas"
      WHERE "__valid"=TRUE AND COALESCE("BoletaID",'') ~ '^[0-9]+$'`,
  );
  const maintenanceSeed = await client.query(
    `SELECT COALESCE(MAX(SUBSTRING("BoletaID" FROM 2)::BIGINT),0)+1 AS next_value
       FROM "Boletas"
      WHERE "__valid"=TRUE AND COALESCE("BoletaID",'') ~ '^M[0-9]+$'`,
  );
  const expectedStandard = String(standardSeed.rows[0]?.next_value || 1);
  const expectedMaintenanceNumber = String(maintenanceSeed.rows[0]?.next_value || 1);
  const expectedMaintenance = `M${expectedMaintenanceNumber.padStart(2, '0')}`;

  await client.query('BEGIN');
  try {
    const standard = await client.query("SELECT dms_next_ticket_number('STANDARD') AS value");
    const maintenance = await client.query("SELECT dms_next_ticket_number('MAINTENANCE') AS value");
    if (String(standard.rows[0]?.value) !== expectedStandard) fail(`next standard ticket ${standard.rows[0]?.value} != ${expectedStandard}`);
    if (String(maintenance.rows[0]?.value) !== expectedMaintenance) fail(`next maintenance ticket ${maintenance.rows[0]?.value} != ${expectedMaintenance}`);
  } finally {
    await client.query('ROLLBACK');
  }
  const afterSequences = await client.query('SELECT entity,next_value FROM runtime_sequences ORDER BY entity');
  if (JSON.stringify(afterSequences.rows) !== beforeSnapshot) fail('ticket sequence verification left persistent changes');

  console.log(JSON.stringify({
    step: 'stage3-verify',
    ok,
    runId,
    sourceSha256: analysis.file.sha256,
    sheets: analysis.workbook.sheetCount,
    rawRows: expected.rawRows,
    canonicalRows,
    validCanonicalRows,
    legacyRows: expected.legacyRows,
    anomalies: expected.anomalyCount,
    anomalyTypes: expected.anomalyTypes,
    actividadAppRawRows: actividadSource,
    syncState: syncRow ? {
      schemaVersion: Number(syncRow.schema_version),
      generationMatchesRun: String(syncRow.generation) === String(runId),
      migrationRunMatches: String(syncRow.migration_run_id) === String(runId),
      legacySheetsCursorPresent: String(syncRow.legacy_sheets_cursor || '').length > 0,
    } : null,
    sequenceProbe: {
      standard: expectedStandard,
      maintenance: expectedMaintenance,
      rolledBack: JSON.stringify(afterSequences.rows) === beforeSnapshot,
    },
    problems: problems.slice(0, 100),
  }, null, 2));

  if (!ok) process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
