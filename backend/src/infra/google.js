import { createObservedDriveApi } from './drive-observer.js';
import { observeSyncWrite } from '../core/sync-write-observer.js';
import { performance } from 'node:perf_hooks';
import { BoundedCache } from '../core/bounded-cache.js';
import {
  readSheetNames,
  SheetRevisionTracker,
  sheetSetsIntersect,
  writeSheetNames,
} from '../core/sheet-cache-coherence.js';
import { google } from 'googleapis';
import { env } from '../config/env.js';
import { AppError } from '../core/errors.js';
import {
  recordCacheEvictions,
  recordCacheHit,
  recordCacheMiss,
  recordSheetsRead,
  recordSheetsWrite,
} from '../services/performance-observability.service.js';
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
      if (this.queue.length >= 100) {
        reject(new AppError('SERVER_BUSY', 'Google Sheets está ocupado. Reintente en unos segundos.', 503));
        return;
      }
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
    const queueWaitMs = Math.max(0, Date.now() - entry.queuedAt);

    Promise.resolve()
      .then(() => entry.task({ queueWaitMs }))
      .then(entry.resolve, entry.reject)
      .finally(() => {
        this.active = Math.max(0, this.active - 1);
        this.completed += 1;
        this.drain();
      });

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
const readCache = new BoundedCache({maxBytes:env.memoryBudgetMb * 1024 * 1024 / 64});
export const sheetsRevisionTracker = new SheetRevisionTracker();
const stats = {
  readCacheHits: 0,
  readStaleHits: 0,
  readInflightHits: 0,
  readInflightBypasses: 0,
  readCacheWriteSkips: 0,
  readApiCalls: 0,
  readTransientRetries: 0,
  readTransientFailures: 0,
  writeApiCalls: 0,
  selectiveInvalidations: 0,
  fullInvalidations: 0,
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
    if (entry.staleUntil <= now || !sheetsRevisionTracker.isCurrent(entry.revision)) readCache.delete(key);
  }
}

function invalidateReadCache(sheetNames = null) {
  if (!sheetNames) {
    readCache.clear();
    stats.fullInvalidations += 1;
    return;
  }
  for (const [key, entry] of readCache.entries()) {
    if (sheetSetsIntersect(entry.sheetNames, sheetNames)) readCache.delete(key);
  }
  stats.selectiveInvalidations += 1;
}

function wrapRead(method, fn) {
  return async (args = {}) => {
    const key = stableKey(method, args);
    const now = Date.now();
    const headerRead = method === 'spreadsheets.values.get' && /!1:1$/.test(args.range || '');
    const sheetNames = readSheetNames(method, args);
    const cachedCandidate = headerRead ? null : readCache.get(key);
    const cached = cachedCandidate && sheetsRevisionTracker.isCurrent(cachedCandidate.revision)
      ? cachedCandidate
      : null;
    if (cachedCandidate && !cached) readCache.delete(key);
    if (cached && cached.expiresAt > now) {
      stats.readCacheHits += 1;
      recordCacheHit();
      return cached.value;
    }

    recordCacheMiss();
    const stale = cached && cached.staleUntil > now ? cached : null;
    if (cached && !stale) readCache.delete(key);

    const existing = readInflight.get(key);
    if (existing && sheetsRevisionTracker.isCurrent(existing.revision)) {
      stats.readInflightHits += 1;
      return existing.promise;
    }
    if (existing) stats.readInflightBypasses += 1;

    const revision = sheetsRevisionTracker.snapshot(sheetNames);
    const entry = { revision, sheetNames, promise: null };
    const request = readGate.run(async ({ queueWaitMs = 0 } = {}) => {
      stats.readApiCalls += 1;
      let firstAttempt = true;
      try {
        const value = await withSheetsTransientRetry(
          () => {
            const startedAt = performance.now();
            const queuedMs = firstAttempt ? queueWaitMs : 0;
            firstAttempt = false;
            return Promise.resolve(fn(args)).finally(() => {
              recordSheetsRead({
                count: 1,
                durationMs: performance.now() - startedAt,
                queueMs: queuedMs,
                tables: [...sheetNames],
              });
            });
          },
          {
            retries: env.sheetsTransientRetries,
            baseMs: env.sheetsTransientBackoffMs,
            maxMs: env.sheetsTransientMaxBackoffMs,
            onRetry: () => { stats.readTransientRetries += 1; },
          },
        );

        const repositoryRead = method === 'spreadsheets.values.batchGet'
          && args.valueRenderOption === 'UNFORMATTED_VALUE'
          && Array.isArray(args.ranges) && args.ranges.every(range => /!A:[A-Z]+$/i.test(range));
        if (!repositoryRead && !headerRead && (env.sheetsGlobalReadCacheMs > 0 || env.sheetsGlobalReadStaleMs > 0)) {
          if (sheetsRevisionTracker.isCurrent(revision)) {
            const storedAt = Date.now();
            const expiresAt = storedAt + env.sheetsGlobalReadCacheMs;
            const evictionsBefore = readCache.evictions;
            readCache.set(key, {
              value: { data: value.data },
              expiresAt,
              staleUntil: expiresAt + env.sheetsGlobalReadStaleMs,
              sheetNames,
              revision,
            });
            recordCacheEvictions(readCache.evictions - evictionsBefore);
            clearExpiredReadCache();
            while (readCache.size > 100) readCache.delete(readCache.keys().next().value);
          } else {
            stats.readCacheWriteSkips += 1;
          }
        }
        return value;
      } catch (error) {
        if (stale && stale.staleUntil > Date.now() && sheetsRevisionTracker.isCurrent(stale.revision)) {
          stats.readStaleHits += 1;
          recordCacheHit();
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
    }).finally(() => {
      if (readInflight.get(key) === entry) readInflight.delete(key);
    });

    entry.promise = request;
    readInflight.set(key, entry);
    return request;
  };
}

function wrapWrite(method, fn) {
  return async (args = {}) => writeGate.run(async () => {
    stats.writeApiCalls += 1;
    recordSheetsWrite();
    const sheetNames = writeSheetNames(method, args);
    observeSyncWrite(sheetNames);
    let result;
    try { result = await fn(args); }
    finally { observeSyncWrite(sheetNames); }
    sheetsRevisionTracker.advance(sheetNames);
    invalidateReadCache(sheetNames);
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
    cache: readCache.snapshot(),
    inflightReads: readInflight.size,
    revisionTracker: sheetsRevisionTracker.snapshotState(),
    ...stats,
  };
}

const rawDriveApi = google.drive({ version: 'v3', auth });
export const driveApi = createObservedDriveApi(rawDriveApi);
export const docsApi = google.docs({ version: 'v1', auth });
export const slidesApi = google.slides({ version: 'v1', auth });
