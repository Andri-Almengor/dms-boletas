import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isNetworkError } from '../../src/services/requestErrors.js';

const apiSource = readFileSync(new URL('../../src/api.js', import.meta.url), 'utf8');

test('429 no-JSON sin X-Request-ID se clasifica como throttling externo reintentable', () => {
  assert.match(apiSource, /const backendReached\s*=\s*Boolean\(appRequestId\)/);
  assert.match(apiSource, /edgeThrottled\s*=\s*status\s*===\s*429\s*&&\s*!backendReached/);
  assert.match(apiSource, /BACKEND_EDGE_THROTTLED/);
  assert.match(apiSource, /retry-after/i);
  assert.match(apiSource, /retryDelayMs\(error, attempt\)/);
  assert.equal(isNetworkError({ status: 429, code: 'BACKEND_EDGE_THROTTLED' }), true);
});

test('429 JSON propio de DMS no se convierte en reintento ciego', () => {
  assert.equal(isNetworkError({ status: 429, code: 'RATE_LIMITED', retryable: false }), false);
  assert.equal(isNetworkError({ status: 429, code: 'SHEETS_QUOTA_EXCEEDED', retryable: false }), false);
  assert.match(apiSource, /TRANSIENT_BACKEND_STATUSES\s*=\s*new Set\(\[502, 503, 504\]\)/);
});

test('la identificación del edge depende de ausencia del request id de la app', () => {
  assert.match(apiSource, /responseHeader\(response, 'x-request-id'\)/);
  assert.match(apiSource, /DMS siempre agrega X-Request-ID/);
});
