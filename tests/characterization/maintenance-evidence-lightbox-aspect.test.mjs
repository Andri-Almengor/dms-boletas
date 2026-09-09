import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('el detalle mantiene miniaturas 4:3 pero el lightbox conserva la proporción original', () => {
  const inventory = source('src/styles/maintenance-device-inventory.css');
  const lightbox = source('src/styles/maintenance-enhancements.css');
  const locationGroups = source('src/styles/maintenance-location-groups-collapsible.css');
  const routeStyles = source('src/styles/routes/maintenance.js');

  assert.match(inventory, /\.maintenance-inventory-images img\s*\{[\s\S]*?aspect-ratio:\s*4\s*\/\s*3;[\s\S]*?object-fit:\s*cover;/);
  assert.match(lightbox, /\.maintenance-lightbox img\{[^}]*object-fit:contain/);
  assert.match(locationGroups, /\.maintenance-inventory-images \.maintenance-lightbox > img,[\s\S]*?\.maintenance-detail-images \.maintenance-lightbox > img\s*\{[\s\S]*?aspect-ratio:\s*auto;[\s\S]*?object-fit:\s*contain;/);

  const inventoryImport = routeStyles.indexOf("import '../maintenance-device-inventory.css';");
  const correctionImport = routeStyles.indexOf("import '../maintenance-location-groups-collapsible.css';");
  assert.ok(inventoryImport >= 0 && correctionImport > inventoryImport, 'La corrección del lightbox debe cargarse después del estilo de miniaturas.');
});
