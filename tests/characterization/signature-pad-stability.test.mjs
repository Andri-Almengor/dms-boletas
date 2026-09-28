import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('la firma no sincroniza ni redibuja el canvas mientras existe un trazo activo', () => {
  const pad = source('src/components/tickets/SignaturePad.jsx');

  assert.match(pad, /loadStoredSignature = false/);
  assert.match(pad, /interactionRef = useRef\(false\)/);
  assert.match(pad, /if \(!interactionRef\.current && !drawingRef\.current\)/);
  assert.match(pad, /if \(drawingRef\.current\) return undefined/);
  assert.match(pad, /if \(!active \|\| drawingRef\.current\) return/);
});

test('mouse, dedo y stylus comparten Pointer Events con captura del puntero', () => {
  const pad = source('src/components/tickets/SignaturePad.jsx');

  assert.match(pad, /setPointerCapture/);
  assert.match(pad, /releasePointerCapture/);
  assert.match(pad, /onPointerDown=\{startDrawing\}/);
  assert.match(pad, /onPointerMove=\{draw\}/);
  assert.match(pad, /onPointerUp=\{stopDrawing\}/);
  assert.match(pad, /onPointerCancel=\{stopDrawing\}/);
  assert.doesNotMatch(pad, /onTouchMove=/);
  assert.doesNotMatch(pad, /onMouseMove=/);
});

test('el detalle y el enlace público no cargan una firma remota encima del dibujo', () => {
  const detail = source('src/pages/tickets/TicketDetailPage.jsx');
  const publicPage = source('src/pages/tickets/PublicSignaturePage.jsx');
  const form = source('src/pages/tickets/TicketFormPage.jsx');

  assert.match(detail, /<SignaturePad value=\{signatureDraft\} onChange=\{setSignatureDraft\} \/>/);
  assert.match(publicPage, /<SignaturePad value=\{signature\} onChange=\{setSignature\} \/>/);
  assert.match(form, /loadStoredSignature=\{editing\}/);
});
