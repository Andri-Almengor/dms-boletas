import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('el detalle conserva acciones independientes para foto, video, archivo y selección múltiple', () => {
  const detail = source('src/pages/tickets/TicketDetailPage.jsx');
  const bridge = source('src/components/forms/TicketEvidenceMultiSelectBridge.jsx');

  assert.match(detail, /Tomar foto/);
  assert.match(detail, /Grabar video/);
  assert.match(detail, /Seleccionar archivo/);
  assert.match(bridge, /Seleccionar varios archivos/);
  assert.match(bridge, /data\.dmsMultiEvidenceSelect|dataset\.dmsMultiEvidenceSelect/);
  assert.doesNotMatch(bridge, /actionButtons\[[0-9]+\]/);
  assert.doesNotMatch(bridge, /innerHTML\s*=\s*['"]<span[^;]+Seleccionar varios archivos[^;]+selectButton/);
});

test('la selección múltiple reutiliza la política de medios y el uploader por lotes', () => {
  const bridge = source('src/components/forms/TicketEvidenceMultiSelectBridge.jsx');

  assert.match(bridge, /prepareEvidenceFiles\(files, \{ allowDocuments: true \}\)/);
  assert.match(bridge, /sourceFileInput/);
  assert.match(bridge, /multiFileInput/);
  assert.match(bridge, /originalSubmit\.hidden = hasMultipleSelection/);
  assert.match(bridge, /multiUpload\.hidden = !hasMultipleSelection/);
  assert.match(bridge, /uploadTicketEvidenceItems/);
  assert.match(bridge, /failedItems/);
  assert.match(bridge, /onProgress/);
  assert.match(bridge, /evidenceName\(prepared, index, items\.length, baseName\)/);
});

test('el formulario de evidencias mantiene contrato responsive y modo oscuro', () => {
  const detailStyles = source('src/styles/ticket-detail-enhancements.css');
  const multiStyles = source('src/styles/ticket-evidence-multi.css');

  assert.match(detailStyles, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(detailStyles, /min-height: 48px/);
  assert.match(detailStyles, /\.ticket-detail-evidence-form > \.info-box/);
  assert.match(detailStyles, /@media \(max-width: 560px\)/);
  assert.match(detailStyles, /\.ticket-detail-capture-actions \{\s*grid-template-columns: 1fr;/s);
  assert.match(multiStyles, /background: var\(--surface\)/);
  assert.match(multiStyles, /color: var\(--text\)/);
  assert.match(multiStyles, /ticket-detail-multi-upload-button\[hidden\]/);
  assert.match(multiStyles, /overflow-wrap: anywhere/);
});


test('la firma guardada se muestra completa sin el recorte cuadrado de las evidencias', () => {
  const detailStyles = source('src/styles/ticket-detail-enhancements.css');

  assert.match(detailStyles, /\.signature-display \.media-preview-button img/);
  assert.match(detailStyles, /aspect-ratio: auto/);
  assert.match(detailStyles, /object-fit: contain/);
  assert.match(detailStyles, /object-position: center/);
  assert.match(detailStyles, /max-width: 100%/);
  assert.match(detailStyles, /max-height: 145px/);
});
