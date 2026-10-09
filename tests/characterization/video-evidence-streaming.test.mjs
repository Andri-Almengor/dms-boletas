import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { TICKET_EVIDENCE_VIDEO_MAX_BYTES, validateEvidenceMediaPayload } from '../../backend/src/services/evidence-media-policy.service.js';
import { requestTimeoutMs } from '../../src/services/requestPolicy.js';

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

test('imágenes y videos de mantenimiento usan streaming protegido en lugar de Base64', () => {
  const patch = source('backend/src/services/protected-media-stream.patch.js');
  const maintenance = source('backend/src/modules/maintenance.module.js');

  assert.match(patch, /if \(isActive\(row\) && fileId\) return maintenanceStreamResult\(row, ctx\)/);
  assert.match(patch, /kind: 'maintenance-media'/);
  assert.match(patch, /fileName: clean\(row\.Nombre\)/);
  assert.match(maintenance, /downloadAsDataUrl/);
  assert.doesNotMatch(patch, /downloadAsDataUrl/);
});

test('visores priorizan streamUrl para videos', () => {
  const ticketSource = source('src/services/ticketMediaSource.js');
  const ticketPreview = source('src/components/tickets/MediaPreview.jsx');
  const maintenancePreview = source('src/components/maintenance/MaintenanceEvidenceImage.jsx');

  assert.match(ticketSource, /data\?\.streamUrl \|\| data\?\.dataUrl/);
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

test('boletas aceptan videos de 18 segundos de hasta 3 GiB sin cargar todo el archivo en memoria', () => {
  const max = 3 * 1024 * 1024 * 1024;
  assert.equal(TICKET_EVIDENCE_VIDEO_MAX_BYTES, max);
  const payload = { fileName: 'video-18s.mp4', mimeType: 'video/mp4', mediaType: 'video', durationSeconds: 18, size: max };
  assert.equal(validateEvidenceMediaPayload(payload, {
    requireData: false, maxVideoBytes: TICKET_EVIDENCE_VIDEO_MAX_BYTES,
  }).size, max);
  assert.throws(() => validateEvidenceMediaPayload({ ...payload, size: max + 1 }, {
    requireData: false, maxVideoBytes: TICKET_EVIDENCE_VIDEO_MAX_BYTES,
  }), /límite/);
  const browser = source('src/utils/evidenceMedia.js');
  assert.match(browser, /TICKET_EVIDENCE_VIDEO_MAX_BYTES = 3 \* 1024 \* 1024 \* 1024/);
  const api = source('backend/src/app.js');
  assert.match(api, /express\.json\(\{ limit: '50mb' \}\)/, 'el servidor no acepta cuerpos HTTP de 3 GB');
});

test('videos de boleta reutilizan sesiones Drive y consultan el offset tras respuestas inciertas 502', () => {
  const client = source('src/services/largeEvidenceUpload.js');
  const batch = source('src/services/ticketEvidenceBatch.js');
  const backend = source('backend/src/services/large-evidence-upload.service.js');
  assert.match(backend, /TICKET_VIDEO_CHUNK_BYTES = 4 \* 1024 \* 1024/);
  assert.match(backend, /resumeUploadToken/);
  assert.match(backend, /const status = await resumableOffset\(token\)/);
  assert.match(backend, /status\.evidence \|\| await appendTicketEvidence\(token, status\.file\)/);
  assert.match(backend, /const chunkLimit = Math\.min\(/);
  assert.match(client, /resumeUploadToken: uploadToken/);
  assert.match(client, /if \(!ticketSessionKey \|\| !uncertainChunkFailure\(error\)\) throw error/);
  assert.match(client, /storedTicketSession\(ticketSessionKey\)/);
  assert.match(client, /clearTicketSession\(ticketSessionKey\)/);
  assert.match(client, /unchangedProbes > 2/);
  assert.match(client, /alwaysVideo = false/);
  assert.match(batch, /alwaysVideo: true/);
  assert.match(batch, /resumableTicketEvidenceId\(boletaUid, item\)/);
});

test('presupuestos de red superan los límites internos sin bloquear por tamaño el hilo de finalización', () => {
  assert.ok(requestTimeoutMs('boletas.finalize') > 360_000);
  assert.ok(requestTimeoutMs('boletas.evidence.large.chunk') > 120_000);
  assert.equal(requestTimeoutMs('auth.login'), 20_000);
  assert.equal(requestTimeoutMs('auth.me'), 25_000);
});
