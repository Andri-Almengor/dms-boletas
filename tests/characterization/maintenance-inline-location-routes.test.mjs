import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  MAINTENANCE_OPERATIONAL_CREATE_ROUTES,
  maintenanceQuickCreateRoutes,
} from '../../src/features/maintenance/maintenanceFormOrchestration.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

const adminLocationRoutes = [
  'clientLocations.create',
  'clients.locations.create',
];
const adminEquipmentRoutes = [
  'equipmentLocations.create',
  'clients.equipmentLocations.create',
];

test('mantenimiento usa primero las rutas operativas para crear ubicaciones', () => {
  const locationRoutes = maintenanceQuickCreateRoutes('location', adminLocationRoutes, false);
  const equipmentRoutes = maintenanceQuickCreateRoutes('equipment', adminEquipmentRoutes, false);

  assert.equal(locationRoutes[0], 'clients.operational.locations.create');
  assert.equal(equipmentRoutes[0], 'clients.operational.equipmentLocations.create');
  assert.ok(locationRoutes.indexOf(adminLocationRoutes[0]) > 0);
  assert.ok(equipmentRoutes.indexOf(adminEquipmentRoutes[0]) > 0);
  assert.ok(MAINTENANCE_OPERATIONAL_CREATE_ROUTES.location.length >= 4);
  assert.ok(MAINTENANCE_OPERATIONAL_CREATE_ROUTES.equipment.length >= 4);
});

test('administradores conservan las rutas CRUD administrativas', () => {
  assert.deepEqual(
    maintenanceQuickCreateRoutes('location', adminLocationRoutes, true),
    adminLocationRoutes,
  );
  assert.deepEqual(
    maintenanceQuickCreateRoutes('equipment', adminEquipmentRoutes, true),
    adminEquipmentRoutes,
  );
});

test('el hook de mantenimiento aplica el resolver tanto a ubicación como a ubicación de equipo', () => {
  const hook = source('src/features/maintenance/useMaintenanceQuickCreate.js');
  assert.match(hook, /maintenanceQuickCreateRoutes\(\s*'location'/);
  assert.match(hook, /maintenanceQuickCreateRoutes\(\s*'equipment'/);
  assert.match(hook, /hasPermission\('USUARIOS_GESTIONAR'\)/);
  assert.match(hook, /MODULE_ROUTES\.clients\.locationsCreate/);
  assert.match(hook, /MODULE_ROUTES\.clients\.equipmentLocationsCreate/);
});

console.log('✓ mantenimiento: alta de ubicaciones usa rutas operativas para técnicos y administrativas para admins');
