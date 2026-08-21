import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  isSheetsTransientError,
  sheetsErrorStatus,
  sheetsRetryAfterMs,
  sheetsTransientDelayMs,
  withSheetsTransientRetry,
} from '../../backend/src/infra/sheets-transient-retry.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

function sheetsError(status, reason = '', message = 'Internal error encountered.') {
  return {
    status,
    code: status,
    message,
    errors: reason ? [{ reason }] : [],
    response: {
      status,
      statusText: status >= 500 ? 'Internal Server Error' : 'Error',
      data: {
        error: {
          code: status,
          message,
          errors: reason ? [{ reason }] : [],
        },
      },
      headers: {},
    },
  };
}

test('clasifica backendError, HTTP 5xx y fallos de transporte como transitorios', () => {
  assert.equal(sheetsErrorStatus(sheetsError(500, 'backendError')), 500);
  assert.equal(isSheetsTransientError(sheetsError(500, 'backendError')), true);
  assert.equal(isSheetsTransientError(sheetsError(503, 'serviceUnavailable')), true);
  assert.equal(isSheetsTransientError({ code: 'ECONNRESET', message: 'socket hang up' }), true);
  assert.equal(isSheetsTransientError({ code: 'ETIMEDOUT', message: 'timed out' }), true);
});

test('no duplica la política de cuota ni reintenta errores permanentes', () => {
  assert.equal(isSheetsTransientError(sheetsError(429, 'rateLimitExceeded')), false);
  assert.equal(isSheetsTransientError(sheetsError(403, 'forbidden', 'Permission denied')), false);
  assert.equal(isSheetsTransientError(sheetsError(404, 'notFound', 'Sheet not found')), false);
});

test('reintenta una lectura 500 y conserva backoff exponencial acotado', async () => {
  let calls = 0;
  const delays = [];
  const result = await withSheetsTransientRetry(async () => {
    calls += 1;
    if (calls < 3) throw sheetsError(500, 'backendError');
    return { ok: true };
  }, {
    retries: 2,
    baseMs: 800,
    maxMs: 8_000,
    random: () => 0,
    sleepFn: async (milliseconds) => { delays.push(milliseconds); },
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 3);
  assert.deepEqual(delays, [800, 1600]);
});

test('respeta Retry-After y entrega el último error al agotar intentos', async () => {
  const error = sheetsError(503, 'serviceUnavailable');
  error.response.headers['retry-after'] = '3';
  assert.equal(sheetsRetryAfterMs(error), 3000);
  assert.equal(sheetsTransientDelayMs({
    attempt: 0,
    baseMs: 800,
    maxMs: 8_000,
    retryAfterMs: 3000,
    random: () => 0,
  }), 3000);

  let calls = 0;
  await assert.rejects(
    withSheetsTransientRetry(async () => {
      calls += 1;
      throw error;
    }, {
      retries: 1,
      sleepFn: async () => {},
      random: () => 0,
    }),
    (caught) => caught === error,
  );
  assert.equal(calls, 2);
});

test('la integración reintenta solo lecturas, usa caché stale y devuelve 503 controlado', () => {
  const googleSource = source('backend/src/infra/google.js');
  const envSource = source('backend/src/config/env.js');
  const readStart = googleSource.indexOf('function wrapRead');
  const writeStart = googleSource.indexOf('function wrapWrite');
  const readSection = googleSource.slice(readStart, writeStart);
  const writeSection = googleSource.slice(writeStart);

  assert.match(readSection, /withSheetsTransientRetry/);
  assert.match(readSection, /readStaleHits/);
  assert.match(readSection, /SHEETS_TEMPORARILY_UNAVAILABLE/);
  assert.match(readSection, /503/);
  assert.doesNotMatch(writeSection, /withSheetsTransientRetry/);
  assert.match(envSource, /SHEETS_TRANSIENT_RETRIES/);
  assert.match(envSource, /SHEETS_TRANSIENT_BACKOFF_MS/);
  assert.match(envSource, /SHEETS_TRANSIENT_MAX_BACKOFF_MS/);
  assert.match(envSource, /SHEETS_GLOBAL_READ_STALE_MS/);
});

test('si una hoja alcanza su límite físico, agrega solo las columnas faltantes y escribe encabezados en el mismo batch', () => {
  const columnsSource = source('backend/src/services/sheet-columns.service.js');

  assert.match(columnsSource, /exceeds grid limits/);
  assert.match(columnsSource, /range: `\$\{quote\(sheetName\)\}!1:1`/);
  assert.match(columnsSource, /const requiredColumns = startColumnIndex \+ missing\.length/);
  assert.match(columnsSource, /length: requiredColumns - currentColumns/);
  assert.match(columnsSource, /appendDimension/);
  assert.match(columnsSource, /updateCells/);
  assert.match(columnsSource, /requestBody: \{ requests \}/);
  assert.match(columnsSource, /return ensureColumns\(sheetName, requested\)/);
  assert.doesNotMatch(columnsSource, /AS1:BB1|AS:BB/);
});
