import 'dotenv/config';
import pg from 'pg';
import { postgresSslConfig } from '../infra/postgres-ssl.js';

const { Pool } = pg;

function positiveInteger(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

export function databaseUrl() {
  const nodeEnv = String(process.env.NODE_ENV || '').trim().toLowerCase();
  if (nodeEnv === 'test') {
    const testUrl = String(process.env.TEST_DATABASE_URL || '').trim();
    if (!testUrl) {
      throw new Error('NODE_ENV=test requiere TEST_DATABASE_URL. DATABASE_URL nunca se usa como fallback para pruebas destructivas.');
    }
    return testUrl;
  }

  const value = String(process.env.DATABASE_URL || '').trim();
  if (!value) throw new Error('Falta DATABASE_URL.');
  return value;
}

export function scriptPool() {
  return new Pool({
    connectionString: databaseUrl(),
    ssl: postgresSslConfig(),
    max: positiveInteger('PG_POOL_MAX', 3, { min: 1, max: 4 }),
    idleTimeoutMillis: positiveInteger('PG_IDLE_TIMEOUT_MS', 30_000, { min: 1_000 }),
    connectionTimeoutMillis: positiveInteger('PG_CONNECTION_TIMEOUT_MS', 8_000, { min: 500 }),
    application_name: 'dms-boletas-migration',
  });
}

export function quoted(value) { return `"${String(value).replace(/"/g, '""')}"`; }
