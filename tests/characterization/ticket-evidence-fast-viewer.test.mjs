import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('boletas usan thumbnail ligero y reservan el original protegido para cuando hace falta', () => {
  const mediaSource = source('src/services/ticketMediaSource.js');
  const preview = source('src/components/tickets/MediaPreview.jsx');

  assert.match(mediaSource, /drive\.google\.com\/thumbnail\?id=/);
  assert.match(mediaSource, /requestTicketProtectedSource/);
  assert.match(mediaSource, /protectedSourceCache/);
  assert.match(preview, /const shouldLoadOriginalNow = knownKind !== 'image' \|\| !previewSource/);
  assert.match(preview, /onPointerEnter=\{warmOriginal\}/);
  assert.match(preview, /onFocus=\{warmOriginal\}/);
  assert.match(preview, /previewFailed/);
  assert.match(preview, /mediaKindHint/);
  assert.match(mediaSource, /hint\.includes\('imagen'\)/);
});

test('visor de boleta abre el preview, mejora calidad y precarga anterior/siguiente', () => {
  const viewer = source('src/components/tickets/ImageViewer.jsx');
  const styles = source('src/styles/ticket-evidence-viewer.css');

  assert.match(viewer, /setSource\(fallback\)/);
  assert.match(viewer, /Mejorando calidad/);
  assert.match(viewer, /activeIndex - 1, activeIndex \+ 1/);
  assert.match(viewer, /requestTicketProtectedSource/);
  assert.match(viewer, /ArrowLeft/);
  assert.match(viewer, /ArrowRight/);
  assert.match(viewer, /onDoubleClick=\{toggleZoom\}/);
  assert.match(viewer, /MAX_ZOOM = 4/);
  assert.match(styles, /backdrop-filter:\s*blur\(16px\)/);
  assert.match(styles, /\.image-viewer__nav/);
  assert.match(styles, /\.image-viewer__quality-loading/);
});

test('detalle agrupa solamente imágenes navegables y mantiene firma fuera de la galería de evidencias', () => {
  const detail = source('src/pages/tickets/TicketDetailPage.jsx');
  const routes = source('src/styles/routes/tickets.js');

  assert.match(detail, /imageEvidenceItems = evidences\.map\(ticketImageViewerItem\)\.filter\(Boolean\)/);
  assert.match(detail, /TipoMedio/);
  assert.match(detail, /imageEvidenceIndexByKey/);
  assert.match(detail, /items: imageEvidenceItems/);
  assert.match(detail, /kind: 'signature'/);
  assert.match(routes, /ticket-evidence-viewer\.css/);
});
