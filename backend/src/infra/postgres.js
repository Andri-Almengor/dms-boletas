import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import pg from 'pg';
import { env } from '../config/env.js';
import { postgresSslConfig } from './postgres-ssl.js';

const { Pool } = pg;
const txStorage = new AsyncLocalStorage();
const requestMetricsStorage = new AsyncLocalStorage();
let pool;
let totals = { queries: 0, queryMs: 0, rowsRead: 0, rowsWritten: 0, poolWaitMs: 0, errors: 0, slowQueries: 0 };

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: env.databaseUrl,
      ssl: postgresSslConfig(process.env.PG_SSL_MODE),
      max: env.pgPoolMax,
      idleTimeoutMillis: env.pgIdleTimeoutMs,
      connectionTimeoutMillis: env.pgConnectionTimeoutMs,
      statement_timeout: env.pgStatementTimeoutMs,
      application_name: 'dms-boletas',
      allowExitOnIdle: false,
    });
    pool.on('error', (error) => {
      totals.errors += 1;
      console.error(`[postgres] idle_client_error code=${String(error?.code || 'UNKNOWN').slice(0, 40)}`);
    });
  }
  return pool;
}

function addMetric(name, value) {
  totals[name] = Number(totals[name] || 0) + Number(value || 0);
  const local = requestMetricsStorage.getStore();
  if (local) local[name] = Number(local[name] || 0) + Number(value || 0);
}

function safeLabel(label) {
  return String(label || 'query').replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 100);
}

export async function query(text, params = [], { label = 'query', write = false } = {}) {
  const client = txStorage.getStore();
  const executor = client || getPool();
  const started = performance.now();
  try {
    const result = await executor.query(text, params);
    const elapsed = performance.now() - started;
    addMetric('queries', 1);
    addMetric('queryMs', elapsed);
    addMetric(write ? 'rowsWritten' : 'rowsRead', Number(result.rowCount || 0));
    if (elapsed >= env.pgSlowQueryMs) {
      addMetric('slowQueries', 1);
      console.warn(`[postgres] slow_query label=${safeLabel(label)} durationMs=${Math.round(elapsed)} rows=${Number(result.rowCount || 0)}`);
    }
    return result;
  } catch (error) {
    addMetric('errors', 1);
    const wrapped = new Error('No se pudo completar la operación de base de datos.');
    wrapped.code = String(error?.code || 'DATABASE_ERROR');
    wrapped.cause = error;
    throw wrapped;
  }
}

export async function withTransaction(operation) {
  const existing = txStorage.getStore();
  if (existing) return operation(existing);
  const waitStarted = performance.now();
  const client = await getPool().connect();
  addMetric('poolWaitMs', performance.now() - waitStarted);
  try {
    await client.query('BEGIN');
    const result = await txStorage.run(client, () => operation(client));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* preserve original error */ }
    throw error;
  } finally {
    client.release();
  }
}

export function inTransaction() { return Boolean(txStorage.getStore()); }

export async function withDbRequestMetrics(operation) {
  const metrics = { queries: 0, queryMs: 0, rowsRead: 0, rowsWritten: 0, poolWaitMs: 0, errors: 0, slowQueries: 0 };
  const result = await requestMetricsStorage.run(metrics, operation);
  return { result, metrics: { ...metrics, queryMs: Math.round(metrics.queryMs * 100) / 100, poolWaitMs: Math.round(metrics.poolWaitMs * 100) / 100 } };
}

export function postgresSnapshot() {
  const current = getPool();
  return {
    totalCount: current.totalCount,
    idleCount: current.idleCount,
    waitingCount: current.waitingCount,
    dbQueries: totals.queries,
    dbQueryMs: Math.round(totals.queryMs),
    dbRowsRead: totals.rowsRead,
    dbRowsWritten: totals.rowsWritten,
    dbPoolWaitMs: Math.round(totals.poolWaitMs),
    dbErrors: totals.errors,
    dbSlowQueries: totals.slowQueries,
  };
}

export async function closePostgres() {
  if (!pool) return;
  const current = pool;
  pool = undefined;
  await current.end();
}

export function _resetPostgresMetricsForTests() {
  totals = { queries: 0, queryMs: 0, rowsRead: 0, rowsWritten: 0, poolWaitMs: 0, errors: 0, slowQueries: 0 };
}
