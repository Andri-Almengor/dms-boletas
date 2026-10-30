import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relative) => readFileSync(path.join(ROOT, relative), 'utf8');

test('editar un dispositivo conserva filtros, piso desplegado, tarjeta y posición en el retorno', () => {
  const inventory = source('src/components/maintenance/MaintenanceLocationInventory.jsx');
  const detail = source('src/pages/maintenance/MaintenanceDetailPage.jsx');
  const form = source('src/pages/maintenance/MaintenanceFormPage.jsx');
  const hook = source('src/features/maintenance/useMaintenanceDirectDevice.js');

  assert.match(inventory, /function captureReturnContext\(device = null\)/);
  for (const field of ['maintenanceId', 'query', 'category', 'location', 'stateFilter', 'openGroups', 'openDeviceIds', 'anchorDeviceId', 'anchorGroupId', 'anchorTop', 'scrollY']) {
    assert.match(inventory, new RegExp('\\b' + field + '\\b'), field);
  }
  assert.match(inventory, /onEditDevice\?\.\(device, captureReturnContext\(device\)\)/);
  assert.match(inventory, /function editDeviceInContext\(device\)/);
  assert.match(detail, /function editDevice\(device, inventoryContext = null\)/);
  assert.match(detail, /maintenanceInventory: inventoryContext/);
  assert.match(detail, /returnContext=\{routeLocation\.state\?\.maintenanceInventory\}/);
  assert.match(form, /returnState: location\.state/);
  assert.match(hook, /if \(saved && request\.directDeviceMode\) navigate\(returnUrl, \{ replace: true, state: returnState \}\)/);
  assert.match(hook, /if \(cancelled && request\.directDeviceMode\) navigate\(returnUrl, \{ replace: true, state: returnState \}\)/);
});

test('al montar de nuevo el inventario restaura los grupos, los filtros y el anclaje del dispositivo', () => {
  const inventory = source('src/components/maintenance/MaintenanceLocationInventory.jsx');
  assert.match(inventory, /returnContext\?\.maintenanceId === String\(maintenanceId\)/);
  assert.match(inventory, /useState\(\(\) => savedContext\?\.query \|\| ''\)/);
  assert.match(inventory, /useState\(\(\) => savedContext\?\.category \|\| 'TODAS'\)/);
  assert.match(inventory, /useState\(\(\) => savedContext\?\.location \|\| 'TODAS'\)/);
  assert.match(inventory, /useState\(\(\) => savedContext\?\.stateFilter \|\| 'TODOS'\)/);
  assert.match(inventory, /new Set\(savedContext\?\.openDeviceIds \|\| \[\]\)/);
  assert.match(inventory, /new Set\(savedContext\?\.openGroups \|\| \[\]\)/);
  assert.match(inventory, /data-maintenance-group-id=\{group\.id\}/);
  assert.match(inventory, /data-maintenance-device-id=\{id\}/);
  assert.match(inventory, /function findVisibleInventoryAnchor/);
  assert.match(inventory, /node\.getClientRects\(\)\.length > 0/, 'ignorar DOM oculto en vista móvil o escritorio');
  assert.match(inventory, /restoreAttemptedRef\.current = true/);
  assert.match(inventory, /anchor\.getBoundingClientRect\(\)\.top/);
  assert.match(inventory, /window\.scrollTo\(\{ top: Math\.max\(0, targetY\), behavior: 'auto' \}\)/);
});

test('proyectos conservan el inventario al entrar al detalle y volver desde la edición', () => {
  const inventory = source('src/components/maintenance/MaintenanceLocationInventory.jsx');
  const project = source('src/pages/maintenance/MaintenanceProjectDeviceDetailPage.jsx');
  assert.match(inventory, /maintenanceInventory: captureReturnContext\(device\)/);
  assert.match(project, /const \{ returnTo: _returnTo, deviceIds: _deviceIds, \.\.\.rest \} = location\.state/);
  assert.match(project, /navigate\(returnUrl, \{ replace: true, state: maintenanceDetailState\(\) \}\)/);
});

test('agregar uno o varios dispositivos deja el mismo piso abierto y no borra la búsqueda', () => {
  const inventory = source('src/components/maintenance/MaintenanceLocationInventory.jsx');
  const detail = source('src/pages/maintenance/MaintenanceDetailPage.jsx');
  const creator = source('src/components/maintenance/MaintenanceQuickDeviceCreator.jsx');
  const feedback = source('src/services/maintenanceDeviceCreatedFeedback.js');
  assert.match(inventory, /function beginAddDevice\(group, bulk = false\)/);
  assert.match(inventory, /setOpenGroups\(\(current\) => new Set\(\[\.\.\.current, group\.id\]\)\)/);
  assert.match(inventory, /if \(bulk\) onAddDeviceList\(group\)/);
  assert.match(inventory, /else onAddDevice\(group\)/);
  assert.match(creator, /showMaintenanceDeviceCreatedFeedback\(feedback\)/);
  assert.doesNotMatch(feedback, /resetInventoryFilters/);
  assert.doesNotMatch(feedback, /scrollIntoView/);
  assert.match(detail, /setNotice\(\`Dispositivo/);
  assert.match(detail, /return load\(\{ silent: true, forceSync: navigator\.onLine !== false \}\)/);
  assert.match(inventory, /setOpenGroups\(\(current\) => \{[\s\S]*groups\.some\(\(group\) => group\.id === id\)/);
});
