import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('Proyecto reutiliza AdminEntityModal como ventana propia del dispositivo', () => {
  const inventory = source('src/components/maintenance/MaintenanceLocationInventory.jsx');

  assert.match(inventory, /import AdminEntityModal from '\.\.\/forms\/AdminEntityModal'/);
  assert.match(inventory, /maintenance-project-device-detail-modal/);
  assert.match(inventory, /title=\{deviceName\(activeProjectDevice\)\}/);
  assert.match(inventory, /expandedContent\(activeProjectDevice, \{ detailView: true \}\)/);
  assert.match(inventory, /if \(projectMode\) \{\s*openProjectDeviceDetail\(device\)/);
});

test('detalle de Proyecto permite navegar anterior siguiente y editar sin duplicar el editor', () => {
  const inventory = source('src/components/maintenance/MaintenanceLocationInventory.jsx');

  assert.match(inventory, /const projectDetailDevices = useMemo/);
  assert.match(inventory, /groups\.flatMap\(\(group\) => group\.items\)/);
  assert.match(inventory, /navigateProjectDevice\(-1\)/);
  assert.match(inventory, /navigateProjectDevice\(1\)/);
  assert.match(inventory, /activeProjectDeviceIndex \+ 1/);
  assert.match(inventory, /editDeviceFromDetail\(activeProjectDevice\)/);
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

test('Mantenimiento normal conserva expansión en fila y Proyecto usa ventana', () => {
  const inventory = source('src/components/maintenance/MaintenanceLocationInventory.jsx');

  assert.match(inventory, /const expanded = !projectMode && expandedDevice === id/);
  assert.match(inventory, /\{expanded && <tr className="maintenance-inventory-expanded-row"/);
  assert.match(inventory, /\{expanded && expandedContent\(device\)\}/);
  assert.match(inventory, /projectMode \? 'open_in_new' : \(expanded \? 'expand_less' : 'expand_more'\)/);
});

test('detalle de Proyecto es responsive usando el sistema visual existente', () => {
  const styles = source('src/styles/maintenance-project.css');

  assert.match(styles, /\.maintenance-project-device-detail-modal \.admin-entity-modal/);
  assert.match(styles, /\.maintenance-project-device-summary-grid/);
  assert.match(styles, /\.maintenance-project-device-detail-navigation/);
  assert.match(styles, /@media \(max-width: 700px\)/);
  assert.match(styles, /height: calc\(100dvh - max\(8px, env\(safe-area-inset-top\)\)\)/);
});
