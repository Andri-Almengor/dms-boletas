import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decodeWeeklyBackupSlot,
  encodeWeeklyBackupSlot,
  shouldRunAutomaticBackup,
} from '../../backend/src/services/weekly-backup-slot.js';
import { AsyncSemaphore } from '../../backend/src/core/semaphore.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function gitBlobSha(text) {
  return crypto
    .createHash('sha1')
    .update(`blob ${Buffer.byteLength(text)}\0`)
    .update(text)
    .digest('hex');
}

test('weekly backup slot is persisted as an opaque non-date value', () => {
  assert.equal(encodeWeeklyBackupSlot('2026-09-06'), 'WEEK_SLOT:2026-09-06');
  assert.equal(decodeWeeklyBackupSlot('WEEK_SLOT:2026-09-06'), '2026-09-06');
});

test('weekly backup slot survives Google Sheets USER_ENTERED date coercion', () => {
  // Google Sheets/Excel serial for 2026-09-06 with the 1899-12-30 epoch.
  assert.equal(decodeWeeklyBackupSlot(46271), '2026-09-06');
  assert.equal(decodeWeeklyBackupSlot('46271'), '2026-09-06');
});

test('three cold starts in the same weekly slot schedule one automatic backup at most', () => {
  const slot = '2026-09-06';
  let persistedLastSlot = '';
  let persistedLastStatus = '';
  let automaticBackups = 0;

  for (let startup = 0; startup < 3; startup += 1) {
    if (shouldRunAutomaticBackup({
      slot,
      lastSlot: decodeWeeklyBackupSlot(persistedLastSlot),
      lastStatus: persistedLastStatus,
    })) {
      automaticBackups += 1;
      persistedLastSlot = encodeWeeklyBackupSlot(slot);
      persistedLastStatus = 'COMPLETADO';
    }
  }

  assert.equal(automaticBackups, 1);
});

test('/api/health stays before application middleware and has no Sheets/Drive dependency', () => {
  const source = read('backend/src/server.js');
  const healthStart = source.indexOf("requestPath === '/api/health'");
  const gateStart = source.indexOf('concurrencyMiddleware(req, res');
  const appStart = source.indexOf('app(req, res)');
  assert.ok(healthStart >= 0 && gateStart > healthStart && appStart > gateStart);

  const sendHealthStart = source.indexOf('function sendHealth');
  const requestHandlerStart = source.indexOf('function requestHandler');
  const healthBlock = source.slice(sendHealthStart, requestHandlerStart);
  assert.match(healthBlock, /bootId/);
  assert.match(healthBlock, /uptimeSeconds/);
  assert.doesNotMatch(healthBlock, /readTable|readTables|copyDriveFile|createFolder|googleapis|SMTP|Gemini|sendChat/i);
});

test('large requests are backpressured before Express parses the body', () => {
  const server = read('backend/src/server.js');
  const app = read('backend/src/app.js');
  const env = read('backend/src/config/env.js');
  assert.ok(server.indexOf('concurrencyMiddleware(req, res') < server.indexOf('app(req, res)'));
  assert.match(app, /express\.json\(/);
  assert.match(env, /HTTP_MAX_CONCURRENT_LARGE_REQUESTS[^\n]*1/);
  assert.match(env, /HTTP_MAX_QUEUED_LARGE_REQUESTS[^\n]*2/);
});

test('a single-slot semaphore does not process multiple large jobs simultaneously', async () => {
  const gate = new AsyncSemaphore({ name: 'test-large', max: 1, queueLimit: 2, timeoutMs: 1000 });
  let active = 0;
  let maxActive = 0;
  const job = async () => {
    const release = await gate.acquire();
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    release();
  };
  await Promise.all([job(), job(), job()]);
  assert.equal(maxActive, 1);
});

test('queued work can be aborted instead of surviving a disconnected client', async () => {
  const gate = new AsyncSemaphore({ name: 'test-abort', max: 1, queueLimit: 2, timeoutMs: 1000 });
  const release = await gate.acquire();
  const controller = new AbortController();
  const queued = gate.acquire({ signal: controller.signal });
  controller.abort();
  await assert.rejects(queued, (error) => error?.code === 'QUEUE_ABORTED');
  assert.equal(gate.snapshot().waiting, 0);
  release();
});

test('auth.login and auth.me use centralized bounded request timeouts', () => {
  const source = read('src/api.js');
  assert.match(source, /REQUEST_TIMEOUTS_MS/);
  assert.match(source, /'auth\.login'/);
  assert.match(source, /'auth\.me'/);
  assert.match(source, /AbortController/);
  assert.match(source, /REQUEST_TIMEOUT/);
});

test('auth.me transient network failures do not clear a cached valid session', () => {
  const source = read('src/context/AuthContext.jsx');
  assert.match(source, /status\s*===\s*401|code\s*===\s*['"]UNAUTHORIZED['"]/);
  assert.match(source, /catch\s*\(.*\)[\s\S]*setLoading\(false\)/);
  assert.doesNotMatch(source, /catch\s*\([^)]*\)\s*\{\s*clearSession\(\)\s*;?\s*\}/);
});

test('auth.me real 401 still clears the session', () => {
  const source = read('src/context/AuthContext.jsx');
  assert.match(source, /401/);
  assert.match(source, /clearSession\(/);
});

test('502/503/504 are classified as temporary backend unavailability', () => {
  const source = read('src/api.js');
  assert.match(source, /new Set\(\[502, 503, 504\]\)/);
  assert.match(source, /BACKEND_TEMPORARILY_UNAVAILABLE/);
  assert.match(source, /retryable\s*=\s*temporary/);
});

test('temporary backend unavailability has visible login recovery instead of a blank screen', () => {
  const login = read('src/pages/LoginPage.jsx');
  const boundary = read('src/components/system/AppErrorBoundary.jsx');
  assert.match(login, /servidor.*reconect/i);
  assert.match(boundary, /ChunkLoadError|dynamic import/i);
  assert.match(boundary, /sessionStorage/);
  assert.match(boundary, /reload/);
});

test('service worker does not replace failed hashed JS/CSS with stale versioned code', () => {
  const source = read('public/sw.js');
  assert.match(source, /isVersionedAssetRequest|assets\//);
  assert.match(source, /networkFirstVersionedAsset|fetchVersionedAsset/);
  assert.doesNotMatch(source, /VERSIONED_ASSET[\s\S]{0,600}return cachedResponse/);
});

test('large evidence transport preserves original bytes without compression/downscaling', () => {
  const source = read('backend/src/services/large-evidence-upload.service.js');
  assert.match(source, /Buffer\.from\([^\n]*base64/);
  assert.doesNotMatch(source, /sharp\(|jimp|resize\(|compress|quality\s*:/i);
});

test('security-sensitive route guards are byte-for-byte unchanged from incident baseline', () => {
  assert.equal(gitBlobSha(read('src/routes/PermissionRoute.jsx')), '0857878059208472b18318977732431fa38a6e25');
  assert.equal(gitBlobSha(read('src/routes/ProtectedRoute.jsx')), '7669f2af9ada5ab89142b4886a0bf3c603c604b6');
});
