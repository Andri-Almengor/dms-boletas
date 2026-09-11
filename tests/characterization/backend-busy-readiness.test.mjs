import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('un error temporal propio de DMS no marca el backend como caído', () => {
  const api = source('src/api.js');
  assert.match(api, /error\.backendReached\s*=\s*Boolean\(appRequestId\)/);
  assert.match(api, /const backendReached = error\?\.backendReached === true/);
  assert.match(api, /if \(retryable && !backendReached\) markBackendUnavailable\(error\)/);
  assert.match(api, /if \(!backendReached\) await waitForBackendReady\(signal\)/);
  assert.match(api, /if \(retryable && !backendReached && !isOfflineModeEnabled\(\)\) throw onlineRequiredError\(error\)/);
});

test('una respuesta DMS con X-Request-ID confirma que Node está vivo', () => {
  const api = source('src/api.js');
  assert.match(api, /const appRequestId = responseHeader\(response, 'x-request-id'\)/);
  assert.match(api, /if \(response\.ok \|\| appRequestId\) markBackendReady\(\)/);
});

test('assets y navegaciones no consumen los slots reservados para API', () => {
  const server = source('backend/src/server.js');
  assert.match(server, /!requestPath\.startsWith\('\/api\/'\)/);
  assert.match(server, /method === 'GET' \|\| method === 'HEAD'/);
  const staticBypass = server.indexOf("!requestPath.startsWith('/api/')");
  const concurrency = server.indexOf('concurrencyMiddleware(req, res');
  assert.ok(staticBypass >= 0 && concurrency > staticBypass, 'el bypass de frontend debe ocurrir antes del semáforo HTTP');
});
