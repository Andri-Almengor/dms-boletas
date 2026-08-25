import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('videos protegidos se reproducen por streaming y no como DataURL gigante', () => {
  const patch = source('backend/src/services/protected-media-stream.patch.js');
  const stream = source('backend/src/services/protected-media-stream.service.js');
  const app = source('backend/src/app.js');

  assert.match(app, /protected-media-stream\.patch\.js/);
  assert.match(app, /app\.get\('\/api\/media\/stream', streamProtectedMedia\)/);
  assert.match(patch, /ticketDeliveryHandlers\.mediaGet/);
  assert.match(patch, /maintenanceProgressChatHandlers\.mediaGet/);
  assert.match(patch, /createProtectedMediaStreamUrl/);
  assert.match(patch, /startsWith\('video\/'\)/);
  assert.doesNotMatch(patch, /downloadAsDataUrl/);

  assert.match(stream, /TOKEN_TTL_MS = 60 \* 60 \* 1000/);
  assert.match(stream, /createHmac\('sha256'/);
  assert.match(stream, /\/api\/media\/stream\?token=/);
  assert.match(stream, /Range: range/);
  assert.match(stream, /upstream\.status === 206/);
  assert.match(stream, /Content-Range/i);
  assert.match(stream, /Accept-Ranges/i);
  assert.match(stream, /Readable\.fromWeb\(upstream\.body\)/);
});

test('visores priorizan streamUrl para videos', () => {
  const ticketPreview = source('src/components/tickets/MediaPreview.jsx');
  const maintenancePreview = source('src/components/maintenance/MaintenanceEvidenceImage.jsx');

  assert.match(ticketPreview, /data\?\.streamUrl \|\| data\?\.dataUrl/);
  assert.match(ticketPreview, /<video src=\{source\} controls preload="metadata"/);
  assert.match(maintenancePreview, /\['streamUrl', 'dataUrl', 'DataURL', 'url'\]/);
  assert.match(maintenancePreview, /<video src=\{source\} controls preload="metadata"/);
});

test('streaming conserva el límite JSON de 50 MB porque el binario no viaja por api action', () => {
  const app = source('backend/src/app.js');
  const stream = source('backend/src/services/protected-media-stream.service.js');

  assert.match(app, /express\.json\(\{ limit: '50mb' \}\)/);
  assert.match(stream, /fetch\(url,/);
  assert.match(stream, /stream\.pipe\(res\)/);
  assert.doesNotMatch(stream, /base64/i);
  assert.doesNotMatch(stream, /Buffer\.concat/);
});
