import { scriptPool } from './db-script.js';
const pool=scriptPool();
try {
  const result=await pool.query('SELECT version, applied_at FROM schema_migrations ORDER BY version');
  for(const row of result.rows) console.log(`${row.version}\t${new Date(row.applied_at).toISOString()}`);
} finally { await pool.end(); }
