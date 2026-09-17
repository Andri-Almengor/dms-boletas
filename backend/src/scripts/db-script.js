import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;
export function databaseUrl() {
  const value = String((process.env.NODE_ENV === 'test' && process.env.TEST_DATABASE_URL) || process.env.DATABASE_URL || '').trim();
  if (!value) throw new Error('Falta DATABASE_URL (o TEST_DATABASE_URL cuando NODE_ENV=test).');
  return value;
}
export function scriptPool() {
  return new Pool({
    connectionString: databaseUrl(),
    max: Math.max(1, Math.min(4, Number(process.env.PG_POOL_MAX || 2))),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS || 8_000),
    application_name: 'dms-boletas-migration',
  });
}
export function quoted(value) { return `"${String(value).replace(/"/g, '""')}"`; }
