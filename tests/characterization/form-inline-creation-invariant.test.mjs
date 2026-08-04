import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

const {
  IMPLIED_OPERATIONAL_CLIENT_PERMISSIONS,
  MAINTENANCE_INLINE_CREATION_FIELDS,
  TICKET_INLINE_CREATION_FIELDS,
  hasImpliedOperationalClientPermission,
} = await import('../../src/config/formInlineCreationPolicy.js');

const TICKET_FIELDS = [
  ['category', 'Categoría'],
  ['failure', 'Tipo de falla'],
  ['location', 'Ubicación'],
  ['equipment', 'Ubicación del equipo'],
  ['supervisor', 'Supervisor'],
  ['device', 'Tipo de dispositivo'],
  ['manufacturer', 'Fabricante'],
  ['model', 'Modelo'],
];

const MAINTENANCE_FIELDS = [
  ['location', 'Ubicación del cliente'],
  ['equipment', 'Ubicación del equipo'],
  ['device', 'Tipo de dispositivo'],
  ['manufacturer', 'Fabricante'],
  ['model', 'Modelo'],
];

test('la política permanente declara todos los campos de alta rápida', () => {
  assert.deepEqual(
    TICKET_INLINE_CREATION_FIELDS.map(({ key, label }) => [key, label]),
    TICKET_FIELDS,
  );
  assert.deepEqual(
    MAINTENANCE_INLINE_CREATION_FIELDS.map(({ key, label }) => [key, label]),
    MAINTENANCE_FIELDS,
  );
  assert.deepEqual(IMPLIED_OPERATIONAL_CLIENT_PERMISSIONS, [
    'BOLETAS_CREAR',
    'BOLETAS_EDITAR',
    'MANTENIMIENTOS_CREAR',
    'MANTENIMIENTOS_EDITAR',
    'MANTENIMIENTOS_GESTIONAR',
  ]);
  IMPLIED_OPERATIONAL_CLIENT_PERMISSIONS.forEach((permission) => {
    assert.equal(hasImpliedOperationalClientPermission([permission]), true, permission);
  });
});

test('boletas conserva los ocho botones y tipos de creación rápida', () => {
  const page = source('src/pages/tickets/TicketFormPage.jsx');
  const hook = source('src/features/tickets/useTicketQuickCreate.js');
  const service = source('src/features/tickets/ticketQuickCreateService.js');
  const auth = source('src/context/AuthContext.jsx');

  TICKET_FIELDS.forEach(([type, label]) => {
    assert.match(page, new RegExp(`label=["']${label}["']`), label);
    assert.match(page, new RegExp(`openModal\\(["']${type}["']\\)`), type);
    assert.match(service, new RegExp(`type === ["']${type}["']`), type);
  });
  assert.ok((page.match(/canAdd=/g) || []).length >= 8, 'Los ocho selectores deben conservar canAdd.');
  assert.match(page, /hasPermission\('CLIENTES_DATOS_OPERATIVOS_CREAR'\)/);
  assert.match(page, /hasPermission\('BOLETAS_CREAR'\)/);
  assert.match(page, /hasPermission\('BOLETAS_EDITAR'\)/);
  assert.match(hook, /category:\s*'categories'/);
  assert.match(hook, /failure:\s*'failures'/);
  assert.match(hook, /device:\s*'devices'/);
  assert.match(hook, /manufacturer:\s*'manufacturers'/);
  assert.match(hook, /model:\s*'models'/);
  assert.match(auth, /hasImpliedOperationalClientPermission\(permissions\)/);
});

test('boletas usa primero rutas operativas para técnicos y conserva respaldo administrativo', () => {
  const service = source('src/features/tickets/ticketQuickCreateService.js');
  const routePairs = [
    ["'clients.operational.locations.create'", 'MODULE_ROUTES.clients.locationsCreate'],
    ["'clients.operational.equipmentLocations.create'", 'MODULE_ROUTES.clients.equipmentLocationsCreate'],
    ["'clients.operational.contacts.create'", 'MODULE_ROUTES.clients.contactsCreate'],
    ["'catalog.operational.categories.create'", 'MODULE_ROUTES.categories.create'],
    ["'catalog.operational.failureTypes.create'", 'MODULE_ROUTES.failureTypes.create'],
    ["'catalog.operational.deviceTypes.create'", 'MODULE_ROUTES.deviceTypes.create'],
    ["'catalog.operational.manufacturers.create'", 'MODULE_ROUTES.manufacturers.create'],
    ["'catalog.operational.models.create'", 'MODULE_ROUTES.models.create'],
    ["'catalog.operational.deviceManufacturers.create'", 'MODULE_ROUTES.deviceManufacturers.create'],
  ];

  routePairs.forEach(([operational, fallback]) => {
    const operationalIndex = service.indexOf(operational);
    const fallbackIndex = service.indexOf(fallback);
    assert.ok(operationalIndex >= 0, `${operational} debe existir.`);
    assert.ok(fallbackIndex > operationalIndex, `${operational} debe probarse antes de ${fallback}.`);
  });
});

test('mantenimientos conserva todas sus altas rápidas en formulario, dispositivo y detalle', () => {
  const formPage = source('src/pages/maintenance/MaintenanceFormPage.jsx');
  const general = source('src/components/maintenance/MaintenanceGeneralStep.jsx');
  const devices = source('src/components/maintenance/MaintenanceDevicesStep.jsx');
  const catalog = source('src/components/maintenance/MaintenanceDeviceCatalogFields.jsx');
  const equipment = source('src/components/maintenance/MaintenanceEquipmentLocationSelect.jsx');
  const quickCreator = source('src/components/maintenance/MaintenanceQuickDeviceCreator.jsx');
  const formHook = source('src/hooks/useMaintenanceForm.js');

  assert.match(general, /label="Ubicación del cliente"/);
  assert.match(general, /canAdd=\{!disabled && canCreateLocation/);
  assert.match(general, /onAdd=\{onAddLocation\}/);
  assert.match(devices, /Nueva ubicación de equipo/);
  assert.match(devices, /onClick=\{onAddEquipment\}/);

  [['device', 'Tipo de dispositivo'], ['manufacturer', 'Fabricante'], ['model', 'Modelo']]
    .forEach(([type, label]) => {
      assert.match(catalog, new RegExp(`label=["']${label}["']`), label);
      assert.match(catalog, new RegExp(`openModal\\(["']${type}["']\\)`), type);
    });
  assert.ok((catalog.match(/canAdd=/g) || []).length >= 3);

  assert.match(equipment, /clients\.operational\.equipmentLocations\.create/);
  assert.match(equipment, /canAdd=\{canCreate\}/);
  assert.match(equipment, /MANTENIMIENTOS_CREAR/);
  assert.match(equipment, /MANTENIMIENTOS_EDITAR/);
  assert.match(formHook, /const canCreateLocation =/);
  assert.match(formHook, /MANTENIMIENTOS_CREAR/);
  assert.match(formHook, /MANTENIMIENTOS_EDITAR/);
  assert.match(formPage, /onAddLocation=\{\(\) => quickCreate\.openModal\('location'\)\}/);
  assert.match(formPage, /onAddEquipment=\{\(\) => quickCreate\.openModal\('equipment'\)\}/);
  assert.match(quickCreator, /<MaintenanceDeviceEditor/);
});

test('el backend mantiene rutas operativas separadas de la administración', () => {
  const router = source('backend/src/core/action-router.js');
  const requiredAliases = [
    'clients.operational.locations.create',
    'clients.operational.equipmentLocations.create',
    'clients.operational.contacts.create',
    'catalog.operational.categories',
    'catalog.operational.deviceTypes',
    'catalog.operational.manufacturers',
    'catalog.operational.models',
    'catalog.operational.failureTypes',
    'catalog.operational.deviceManufacturers',
  ];
  requiredAliases.forEach((alias) => assert.match(router, new RegExp(alias.replaceAll('.', '\\.'))));
  ['BOLETAS_CREAR', 'BOLETAS_EDITAR', 'MANTENIMIENTOS_CREAR', 'MANTENIMIENTOS_EDITAR', 'MANTENIMIENTOS_GESTIONAR']
    .forEach((permission) => assert.match(router, new RegExp(permission)));
});

test('la documentación identifica la regla como invariante no opcional', () => {
  const documentation = source('docs/FORM_INLINE_CREATION_INVARIANT.md');
  assert.match(documentation, /invariante funcional del proyecto/i);
  assert.match(documentation, /no debe eliminarse/i);
  TICKET_FIELDS.forEach(([, label]) => assert.match(documentation, new RegExp(label)));
  assert.match(documentation, /No se debe modificar la prueba para permitir la eliminación/i);
});
