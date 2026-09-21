import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('el lightbox de evidencias permite navegar y hacer zoom sin cerrarlo', () => {
  const component = source('src/components/maintenance/MaintenanceEvidenceImage.jsx');
  const styles = source('src/styles/maintenance-evidence-gallery.css');
  const routeStyles = source('src/styles/routes/maintenance.js');

  assert.match(component, /galleryImages/);
  assert.match(component, /maintenance-lightbox__nav--previous/);
  assert.match(component, /maintenance-lightbox__nav--next/);
  assert.match(component, /maintenance-lightbox__counter/);
  assert.match(component, /maintenance-lightbox__zoom-controls/);
  assert.match(component, /event\.key === 'ArrowLeft'/);
  assert.match(component, /event\.key === 'ArrowRight'/);
  assert.match(component, /event\.key === 'Escape'/);
  assert.match(component, /onDoubleClick=\{toggleZoom\}/);
  assert.match(component, /MAX_ZOOM = 4/);
  assert.match(component, /setFullSource\(fallback \|\| ''\)/);
  assert.match(component, /warmCurrentFullImage/);
  assert.match(component, /requestProtectedSource\(neighborId, sessionToken\)/);
  assert.match(component, /Mejorando calidad/);

  assert.match(styles, /backdrop-filter:\s*blur\(16px\)/);
  assert.match(styles, /\.maintenance-lightbox__nav/);
  assert.match(styles, /\.maintenance-lightbox__zoom-controls/);
  assert.match(routeStyles, /maintenance-evidence-gallery\.css/);
});

test('las galerías reciben todas las evidencias del dispositivo', () => {
  const inventory = source('src/components/maintenance/MaintenanceDeviceInventory.jsx');
  const locationInventory = source('src/components/maintenance/MaintenanceLocationInventory.jsx');
  const editor = source('src/components/maintenance/MaintenanceDeviceEditor.jsx');

  assert.match(inventory, /galleryImages=\{images\}/);
  assert.match(locationInventory, /galleryImages=\{images\}/);
  assert.match(editor, /galleryImages=\{device\.images \|\| \[\]\}/);
});

test('toda la fila del dispositivo abre el detalle sin capturar controles interactivos', () => {
  const inventory = source('src/components/maintenance/MaintenanceDeviceInventory.jsx');
  const locationInventory = source('src/components/maintenance/MaintenanceLocationInventory.jsx');

  [inventory, locationInventory].forEach((component) => {
    assert.match(component, /data-device-row/);
    assert.match(component, /hasOwnInteraction\(event\.target\)/);
    assert.match(component, /button, a, input, select, textarea, label/);
    assert.match(component, /toggleRowFromKeyboard/);
  });
});
