import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const script = readFileSync(new URL('../../apps-script/report-service/Code.gs', import.meta.url), 'utf8');
const builderStart = script.indexOf('function buildDirectEvidenceAttachments_(evidences, options) {');
const builderEnd = script.indexOf('function safeAttachmentName_(', builderStart);
const builderSource = script.slice(builderStart, builderEnd);

function prepareVideo({ name = '20261001_121230.mp4', mime = 'application/octet-stream', size = 0, denyAccess = false } = {}) {
  const viewers = [];
  let blobReads = 0;
  let zipCalls = 0;
  const driveFile = {
    getMimeType: () => mime,
    getSize: () => size,
    getName: () => name,
    addViewer(email) {
      viewers.push(email);
      if (denyAccess) throw new Error('Domain prevents granting viewer permission');
    },
  };
  const ctx = {
    evidence: [{
      ArchivoID: 'video-file-id', Nombre: 'Video de 18 segundos',
      NombreArchivo: name, MimeType: mime, TamanoBytes: size,
      ArchivoURL: '',
    }],
    MAX_EMAIL_BYTES: 17 * 1024 * 1024,
    clean_: (value, fallback = '') => String(value || '').trim() || fallback,
    uniqueEmails_: (items) => [...new Set(items)],
    extractFileId_: (id) => id,
    safeWebUrl_: (url) => /^https:\/\/drive\.google\.com\//.test(url) ? url : '',
    assertRequestBudget_: () => {},
    getDriveFileCached_: () => driveFile,
    getDriveBlob_() { blobReads += 1; throw new Error('Video must not be materialized'); },
    Utilities: { zip() { zipCalls += 1; throw new Error('Video must not be zipped'); } },
    console: { warn: () => {} },
  };
  const run = (options) => runInNewContext(
    builderSource + '\nbuildDirectEvidenceAttachments_(evidence, options)',
    { ...ctx, options },
  );
  return { run, viewers, blobReads: () => blobReads, zipCalls: () => zipCalls };
}

test('el video de 18 segundos se enlaza aunque Drive reporte tamaño 0 y MIME genérico', () => {
  const video = prepareVideo();
  const result = video.run({ linkVideos: true, recipients: ['yehuda.karmona@solutionsdms.com', 'tecnico@example.com'] });
  assert.equal(result.attachments.length, 0);
  assert.equal(result.linkedVideoCount, 1);
  assert.equal(result.rows[0].oversizedVideo, true);
  assert.equal(result.rows[0].attached, false);
  assert.equal(result.rows[0].url, 'https://drive.google.com/file/d/video-file-id/view');
  assert.equal(result.rows[0].driveAccessGranted, true);
  assert.deepEqual(video.viewers, ['yehuda.karmona@solutionsdms.com', 'tecnico@example.com']);
  assert.equal(video.blobReads(), 0);
  assert.equal(video.zipCalls(), 0);
});

test('los videos grandes y los metadatos incompletos no bloquean correo ni generan adjuntos', () => {
  for (const fixture of [
    { name: 'camara.mp4', mime: 'video/mp4', size: 3 * 1024 * 1024 * 1024 },
    { name: 'camara.webm', mime: 'application/octet-stream', size: 7 * 1024 * 1024 },
    { name: 'camara.MOV', mime: 'video/quicktime', size: 1 },
  ]) {
    const video = prepareVideo(fixture);
    const result = video.run({ linkVideos: true, recipients: ['tecnico@example.com'] });
    assert.equal(result.linkedVideoCount, 1);
    assert.equal(result.attachments.length, 0);
    assert.equal(video.blobReads(), 0);
    assert.equal(video.zipCalls(), 0);
  }
});

test('si Google Drive impide agregar un destinatario, no se bloquea el correo y se indica acceso restringido', () => {
  const video = prepareVideo({ denyAccess: true });
  const result = video.run({ linkVideos: true, recipients: ['tecnico@example.com'] });
  assert.equal(result.rows[0].driveAccessGranted, false);
  assert.equal(result.rows[0].oversizedVideo, true);
  assert.equal(video.blobReads(), 0);
  assert.equal(video.zipCalls(), 0);
});

test('se conserva la política de correo: PDF adjunto, videos enlazados y sin enlaces públicos', () => {
  assert.match(script, /const APPS_SCRIPT_VERSION = '2026-10-09-V7\.15-VIDEO-DRIVE-LINK'/);
  assert.match(script, /const attachments = reportBlobs\.concat\(evidenceParts\.attachments\)/);
  assert.match(script, /const attachments = \[data\.pdfBlob\]\.concat\(evidenceParts\.attachments\)/);
  assert.equal((script.match(/linkVideos: true,/g) || []).length, 2, 'ambos flujos de boleta usan la política');
  assert.match(script, /function sendDirectAttachmentEmails_\(data\)/);
  assert.match(script, /videoEvidenceBlock,/);
  assert.match(script, /Abrir video en Google Drive/);
  assert.match(script, /lines\.push\('Video: ' \+ item\.name \+ ' - ' \+ item\.url\)/);
  assert.match(script, /file\.addViewer\(email\)/);
  assert.doesNotMatch(builderSource, /setSharing\(/, 'no se hacen públicos los videos');
  assert.match(script, /MAX_EMAIL_BYTES = 17 \* 1024 \* 1024/, 'el límite de adjuntos no cambia');
  assert.match(script, /if \(isVideo && \(linkVideos \|\| fileSize > MAX_EMAIL_BYTES\)\)/);
  assert.ok(builderSource.indexOf('if (isVideo && (linkVideos || fileSize > MAX_EMAIL_BYTES))')
    < builderSource.indexOf('const blob = getDriveBlob_(fileId)'), 'se debe detectar video antes de leer su blob');
});
