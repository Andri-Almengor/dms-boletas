import crypto from 'node:crypto';
import { scriptPool } from './db-script.js';

const pool = scriptPool();
const client = await pool.connect();

const safeHash = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex');

try {
  const searchPathResult = await client.query('SHOW search_path');
  const currentSchemasResult = await client.query('SELECT current_schemas(TRUE) AS schemas');
  const functionsResult = await client.query(`
    SELECT n.nspname AS schema_name,
           p.oid::regprocedure::text AS identity,
           pg_get_function_identity_arguments(p.oid) AS identity_arguments,
           pg_get_function_result(p.oid) AS result_type,
           pg_get_functiondef(p.oid) AS definition
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE p.proname='dms_next_ticket_number'
     ORDER BY n.nspname, p.oid
  `);
  const functions = functionsResult.rows.map((row) => ({
    schema: row.schema_name,
    identity: row.identity,
    identityArguments: row.identity_arguments,
    resultType: row.result_type,
    definitionSha256: safeHash(row.definition),
    hasReconcileGreatest: String(row.definition).includes('GREATEST(runtime_sequences.next_value, EXCLUDED.next_value)'),
    hasMaintenanceAlias: String(row.definition).includes("'MAINTENANCE', 'MANTENIMIENTO', 'M'"),
  }));

  const resolvedResult = await client.query(`
    SELECT to_regprocedure('dms_next_ticket_number(text)')::text AS text_signature,
           to_regprocedure('dms_next_ticket_number(text)')::oid AS oid
  `);

  const sequenceRows = await client.query(`
    SELECT entity,next_value
      FROM runtime_sequences
     WHERE entity IN ('BOLETA','MANTENIMIENTO_BOLETA')
     ORDER BY entity
  `);

  const history = await client.query(`
    SELECT COALESCE(MAX("BoletaID"::BIGINT),0) AS standard_max,
           (SELECT COALESCE(MAX(SUBSTRING("BoletaID" FROM 2)::BIGINT),0)
              FROM "Boletas"
             WHERE "__valid"=TRUE AND COALESCE("BoletaID",'') ~ '^M[0-9]+$') AS maintenance_max
      FROM "Boletas"
     WHERE "__valid"=TRUE AND COALESCE("BoletaID",'') ~ '^[0-9]+$'
  `);

  let directUpsertNext = null;
  await client.query('BEGIN');
  try {
    const direct = await client.query(`
      INSERT INTO runtime_sequences(entity,next_value,updated_at)
      VALUES ('MANTENIMIENTO_BOLETA', 206, NOW())
      ON CONFLICT (entity) DO UPDATE
         SET next_value=GREATEST(runtime_sequences.next_value, EXCLUDED.next_value),
             updated_at=NOW()
      RETURNING next_value
    `);
    directUpsertNext = String(direct.rows[0]?.next_value ?? '');
  } finally {
    await client.query('ROLLBACK');
  }

  let functionResult = null;
  let inTxSequence = null;
  await client.query('BEGIN');
  try {
    const call = await client.query("SELECT dms_next_ticket_number('MAINTENANCE') AS value");
    functionResult = String(call.rows[0]?.value ?? '');
    const seq = await client.query(`
      SELECT next_value
        FROM runtime_sequences
       WHERE entity='MANTENIMIENTO_BOLETA'
    `);
    inTxSequence = seq.rowCount ? String(seq.rows[0].next_value) : null;
  } finally {
    await client.query('ROLLBACK');
  }

  const triggers = await client.query(`
    SELECT c.relname AS table_name,
           t.tgname AS trigger_name,
           p.proname AS function_name
      FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_proc p ON p.oid=t.tgfoid
     WHERE NOT t.tgisinternal
       AND c.relname IN ('runtime_sequences','Boletas')
     ORDER BY c.relname,t.tgname
  `);

  console.log(JSON.stringify({
    step: 'stage3-sequence-diagnose',
    searchPath: searchPathResult.rows[0]?.search_path || null,
    currentSchemas: currentSchemasResult.rows[0]?.schemas || [],
    functions,
    resolved: resolvedResult.rows[0] || null,
    persistedSequences: sequenceRows.rows.map((row) => ({ entity: row.entity, nextValue: String(row.next_value) })),
    history: {
      standardMax: String(history.rows[0]?.standard_max ?? ''),
      maintenanceMax: String(history.rows[0]?.maintenance_max ?? ''),
    },
    directUpsertProbe: { nextValue: directUpsertNext, rolledBack: true },
    functionProbe: { result: functionResult, inTransactionNextValue: inTxSequence, rolledBack: true },
    triggers: triggers.rows,
  }, null, 2));
} finally {
  client.release();
  await pool.end();
}
