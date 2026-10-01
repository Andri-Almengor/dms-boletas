import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('Mantenimiento y Proyecto reutilizan AdminEntityModal como ventana propia del dispositivo', () => {
  const inventory = source('src/components/maintenance/MaintenanceLocationInventory.jsx');

  assert.match(inventory, /import AdminEntityModal from '\.\.\/forms\/AdminEntityModal'/);
  assert.match(inventory, /maintenance-device-detail-modal/);
  assert.match(inventory, /title=\{deviceName\(activeDetailDevice\)\}/);
  assert.match(inventory, /deviceDetailContent\(activeDetailDevice, \{ detailView: true \}\)/);
  assert.match(inventory, /function toggleDevice\(device\) \{\s*openDeviceDetail\(device\);\s*\}/);
  assert.match(inventory, /\{activeDetailDevice && <AdminEntityModal/);
});

test('detalle compartido permite navegar anterior siguiente y editar sin duplicar el editor', () => {
  const inventory = source('src/components/maintenance/MaintenanceLocationInventory.jsx');

  assert.match(inventory, /const detailDevices = useMemo/);
  assert.match(inventory, /groups\.flatMap\(\(group\) => group\.items\)/);
  assert.match(inventory, /navigateDeviceDetail\(-1\)/);
  assert.match(inventory, /navigateDeviceDetail\(1\)/);
  assert.match(inventory, /activeDetailDeviceIndex \+ 1/);
  assert.match(inventory, /editDeviceFromDetail\(activeDetailDevice\)/);
  assert.match(inventory, /onEditDevice\?\.\(device\)/);
});

test('ventana de Proyecto muestra identificación completa y relaciones configurables', () => {
  const inventory = source('src/components/maintenance/MaintenanceLocationInventory.jsx');

  for (const label of [
    'Tipo',
    'Ubicación',
    'Marca',
    'Modelo',
    'Serie',
    'Dirección MAC',
    'Fecha de trabajo',
    'Técnicos',
    'Estado',
    'Evidencias',
  ]) {
    assert.ok(inventory.includes(`<span>${label}</span>`), `Falta ${label} en el resumen del dispositivo`);
  }
  assert.match(inventory, /<ProjectDeviceAnswers device=\{device\} \/>/);
  assert.match(inventory, /maintenance-project-detail-components/);
});

test('galería del detalle filtra por dispositivo o componente y conserva edición y carga existentes', () => {
  const inventory = source('src/components/maintenance/MaintenanceLocationInventory.jsx');

  assert.match(inventory, /projectEvidenceTargetFilter/);
  assert.match(inventory, /projectEvidenceTargets\(device\)/);
  assert.match(inventory, /projectEvidenceTargetValue\(image\) === projectEvidenceTargetFilter/);
  assert.ok(inventory.includes('Todas las evidencias'));
  assert.match(inventory, /addEvidenceFromDetail\(device\)/);
  assert.match(inventory, /editEvidenceFromDetail\(image, device\)/);
  assert.match(inventory, /<MaintenanceEvidenceImage image=\{image\} galleryImages=\{images\}/);
});

test('buscador de inventario incluye notas y metadatos de evidencia', () => {
  const inventory = source('src/components/maintenance/MaintenanceLocationInventory.jsx');

  assert.match(inventory, /\.\.\.\(device\.Imagenes \|\| \[\]\)\.flatMap/);
  assert.match(inventory, /pick\(image, \['Nota'\]\)/);
  assert.match(inventory, /pick\(image, \['ProyectoComponenteNombre'\]\)/);
  assert.match(inventory, /nota de evidencia/);
});

test('ningún tipo de mantenimiento expande el dispositivo dentro de la lista', () => {
  const inventory = source('src/components/maintenance/MaintenanceLocationInventory.jsx');

  assert.doesNotMatch(inventory, /expandedDevice/);
  assert.doesNotMatch(inventory, /maintenance-inventory-expanded-row/);
  assert.doesNotMatch(inventory, /\{expanded && deviceDetailContent\(device\)/);
  assert.match(inventory, /aria-haspopup="dialog"/);
  assert.match(inventory, /<Icon name="open_in_new" \/>/);
  assert.match(inventory, /className="maintenance-device-detail-modal"/);
});

test('detalle compartido es responsive usando el sistema visual existente', () => {
  const styles = source('src/styles/maintenance-project.css');

  assert.match(styles, /\.maintenance-device-detail-modal \.admin-entity-modal/);
  assert.match(styles, /width:\s*min\(100%, 1180px\)/);
  assert.match(styles, /\.maintenance-project-device-summary-grid/);
  assert.match(styles, /\.maintenance-device-detail-navigation/);
  assert.match(styles, /@media \(max-width: 700px\)/);
  assert.match(styles, /height:\s*calc\(100dvh - max\(8px, var\(--safe-area-top\)\)\)/);
});
