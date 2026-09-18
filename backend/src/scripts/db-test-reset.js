import 'dotenv/config';
import pg from 'pg';
import { postgresSslConfig } from '../infra/postgres-ssl.js';

const testDatabaseUrl = String(process.env.TEST_DATABASE_URL || '').trim();
const productionDatabaseUrl = String(process.env.DATABASE_URL || '').trim();

if (!testDatabaseUrl) {
  throw new Error('db-test-reset requires TEST_DATABASE_URL. DATABASE_URL is never accepted for destructive resets.');
}
if (productionDatabaseUrl && productionDatabaseUrl === testDatabaseUrl) {
  throw new Error('Refusing destructive reset: TEST_DATABASE_URL must not be identical to DATABASE_URL.');
}

const { Pool } = pg;
const pool = new Pool({
  connectionString: testDatabaseUrl,
  ssl: postgresSslConfig(process.env.PG_SSL_MODE),
  max: 1,
  application_name: 'dms-boletas-test-reset',
});

try {
  await pool.query('DROP SCHEMA public CASCADE');
  await pool.query('CREATE SCHEMA public');
  console.log(JSON.stringify({ ok: true, target: 'TEST_DATABASE_URL', schema: 'public' }));
} finally {
  await pool.end();
}
