import { google } from 'googleapis';
import { env } from '../config/env.js';
import { AppError } from '../core/errors.js';
import {
  isSheetsTransientError,
  withSheetsTransientRetry,
} from './sheets-transient-retry.js';

const auth = new google.auth.JWT({
  email: env.googleClientEmail,
  key: env.googlePrivateKey,
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/documents',
    'https://www.googleapis.com/auth/presentations',
  ],
});

export const googleAuth = auth;

class ApiGate {
  constructor({ maxConcurrent, minIntervalMs }) {
    this.maxConcurrent = Math.max(1, Number(maxConcurrent || 1));
    this.minIntervalMs = Math.max(0, Number(minIntervalMs || 0));
    this.active = 0;
    this.queue = [];
    this.lastStartedAt = 0;
    this.timer = null;
    this.started = 0;
    this.completed = 0;
  }

  run(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject, queuedAt: Date.now() });
      this.drain();
    });
  }

  drain() {
    if (this.active >= this.maxConcurrent || !this.queue.length) return;
    const wait = Math.max(0, this.minIntervalMs - (Date.now() - this.lastStartedAt));
    if (wait > 0) {
      if (!this.timer) {
        this.timer = setTimeout(() => {
          this.timer = null;
          this.drain();
        }, wait);
        this.timer.unref?.();
      }
      return;
    }

    const entry = this.queue.shift();
    this.active += 1;
    this.started += 1;
    this.lastStartedAt = Date.now();

    Promise.resolve()
      .then(entry.task)
      .then(entry.resolve, entry.reject)
      .finally(() => {
        this.active = Math.max(0, this.active - 1);
        this.completed += 1;
        this.drain();
      });

    // Permite aprovechar la concurrencia configurada, manteniendo la separación
    // mínima entre el inicio de cada llamada.
    if (this.active < this.maxConcurrent) this.drain();
  }

  snapshot() {
    return {
      active: this.active,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent,
      minIntervalMs: this.minIntervalMs,
      started: this.started,
      completed: this.completed,
      oldestQueuedMs: this.queue.length ? Date.now() - this.queue[0].queuedAt : 0,
    };
  }
}

const rawSheetsApi = google.sheets({ version: 'v4', auth });
const readGate = new ApiGate({
  maxConcurrent: env.sheetsGlobalMaxConcurrentReads,
  minIntervalMs: env.sheetsGlobalReadMinIntervalMs,
});
const writeGate = new ApiGate({
  maxConcurrent: env.sheetsGlobalMaxConcurrentWrites,
  minIntervalMs: env.sheetsGlobalWriteMinIntervalMs,
});
const readInflight = new Map();
const readCache = new Map();
const stats = {
  readCacheHits: 0,
  readStaleHits: 0,
  readInflightHits: 0,
  readApiCalls: 0,
  readTransientRetries: 0,
  readTransientFailures: 0,
  writeApiCalls: 0,
};

function stableKey(method, args) {
  let serialized = '';
  try {
    serialized = JSON.stringify(args || {});
  } catch {
    serialized = String(args || '');
  }
  return `${method}|${serialized}`;
}

function clearExpiredReadCache() {
  const now = Date.now();
  for (const [key, entry] of readCache.entries()) {
    if (entry.staleUntil <= now) readCache.delete(key);
  }
}

function wrapRead(method, fn) {
  return async (args = {}) => {
    const key = stableKey(method, args);
    const now = Date.now();
    const cached = readCache.get(key);
    if (cached && cached.expiresAt > now) {
      stats.readCacheHits += 1;
      return cached.value;
    }

    const stale = cached && cached.staleUntil > now ? cached : null;
    if (cached && !stale) readCache.delete(key);
    if (readInflight.has(key)) {
      stats.readInflightHits += 1;
      return readInflight.get(key);
    }

    const request = readGate.run(async () => {
      stats.readApiCalls += 1;
      try {
        const value = await withSheetsTransientRetry(
          () => fn(args),
          {
            retries: env.sheetsTransientRetries,
            baseMs: env.sheetsTransientBackoffMs,
            maxMs: env.sheetsTransientMaxBackoffMs,
            onRetry: () => { stats.readTransientRetries += 1; },
          },
        );

        if (env.sheetsGlobalReadCacheMs > 0 || env.sheetsGlobalReadStaleMs > 0) {
          const storedAt = Date.now();
          const expiresAt = storedAt + env.sheetsGlobalReadCacheMs;
          readCache.set(key, {
            value,
            expiresAt,
            staleUntil: expiresAt + env.sheetsGlobalReadStaleMs,
          });
          if (readCache.size > 500) clearExpiredReadCache();
        }
        return value;
      } catch (error) {
        if (stale && stale.staleUntil > Date.now()) {
          stats.readStaleHits += 1;
          return stale.value;
        }
        if (isSheetsTransientError(error)) {
          stats.readTransientFailures += 1;
          throw new AppError(
            'SHEETS_TEMPORARILY_UNAVAILABLE',
            'Google Sheets presentó un error temporal. La operación puede reintentarse sin perder la información guardada.',
            503,
            {
              retryAfterSeconds: Math.max(2, Math.ceil(env.sheetsTransientMaxBackoffMs / 1000)),
              googleStatus: Number(error?.response?.status || error?.status || error?.code || 0) || 0,
            },
          );
        }
        throw error;
      }
    }).finally(() => readInflight.delete(key));

    readInflight.set(key, request);
    return request;
  };
}

function wrapWrite(method, fn) {
  return async (args = {}) => writeGate.run(async () => {
    stats.writeApiCalls += 1;
    const result = await fn(args);
    // Una escritura puede afectar cualquier lectura previamente cacheada. El
    // repositorio mantiene su propia caché coherente; esta caché global es solo
    // una segunda barrera contra ráfagas y se invalida conservadoramente.
    readCache.clear();
    return result;
  });
}

const rawSpreadsheets = rawSheetsApi.spreadsheets;
const rawValues = rawSpreadsheets.values;

export const sheetsApi = {
  ...rawSheetsApi,
  spreadsheets: {
    ...rawSpreadsheets,
    get: wrapRead('spreadsheets.get', rawSpreadsheets.get.bind(rawSpreadsheets)),
    create: wrapWrite('spreadsheets.create', rawSpreadsheets.create.bind(rawSpreadsheets)),
    batchUpdate: wrapWrite('spreadsheets.batchUpdate', rawSpreadsheets.batchUpdate.bind(rawSpreadsheets)),
    values: {
      ...rawValues,
      get: wrapRead('spreadsheets.values.get', rawValues.get.bind(rawValues)),
      batchGet: wrapRead('spreadsheets.values.batchGet', rawValues.batchGet.bind(rawValues)),
      append: wrapWrite('spreadsheets.values.append', rawValues.append.bind(rawValues)),
      update: wrapWrite('spreadsheets.values.update', rawValues.update.bind(rawValues)),
      batchUpdate: wrapWrite('spreadsheets.values.batchUpdate', rawValues.batchUpdate.bind(rawValues)),
      clear: wrapWrite('spreadsheets.values.clear', rawValues.clear.bind(rawValues)),
      batchClear: wrapWrite('spreadsheets.values.batchClear', rawValues.batchClear.bind(rawValues)),
    },
  },
};

export function googleSheetsGateSnapshot() {
  return {
    reads: readGate.snapshot(),
    writes: writeGate.snapshot(),
    cacheEntries: readCache.size,
    inflightReads: readInflight.size,
    ...stats,
  };
}

export const driveApi = google.drive({ version: 'v3', auth });
export const docsApi = google.docs({ version: 'v1', auth });
export const slidesApi = google.slides({ version: 'v1', auth });
