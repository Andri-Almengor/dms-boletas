import { scriptPool } from './db-script.js';

const pool = scriptPool();
try {
  await pool.query('SELECT 1');
  const relation = await pool.query("SELECT to_regclass('public.schema_migrations') AS name");
  if (!relation.rows[0]?.name) {
    console.log('schema_migrations\tABSENT');
    console.log('pending\tall');
  } else {
    const result = await pool.query('SELECT version, applied_at FROM schema_migrations ORDER BY version');
    if (!result.rows.length) console.log('schema_migrations\tEMPTY');
    for (const row of result.rows) console.log(`${row.version}\t${new Date(row.applied_at).toISOString()}`);
  }
} finally {
  await pool.end();
}
