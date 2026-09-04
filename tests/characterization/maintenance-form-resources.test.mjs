import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  activeMaintenanceUsers,
  buildMaintenanceTechnicians,
  countRegisteredMaintenanceDevices,
  expectedMaintenanceTotal,
  filterMaintenanceEquipment,
  maintenanceClientView,
  maintenanceEquipmentView,
  maintenanceLocationView,
  maintenanceReadOnly,
  updateMaintenanceCount,
  validateMaintenanceForm,
} from '../../src/features/maintenance/maintenanceFormDomain.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('normaliza clientes, sedes y equipos manteniendo identificadores históricos', () => {
  assert.deepEqual(maintenanceClientView({ ClienteID: 7, Clientes: 'Cliente A' }), { id: '7', name: 'Cliente A' });
  assert.deepEqual(maintenanceLocationView({ RowID: 9, Nombre: 'Edificio Norte' }), { id: '9', name: 'Edificio Norte' });
  assert.deepEqual(maintenanceEquipmentView({ id: 11, Nombre: 'Piso 2', UbicacionID: 9 }), {
    id: '11',
    name: 'Piso 2',
    locationId: '9',
  });
});

test('filtra usuarios activos y conserva el contrato visual de técnicos', () => {
  const active = activeMaintenanceUsers([
    { UsuarioID: 1, Estado: 'ACTIVO', NombreCompleto: 'Ana Mora', Correo: 'ana@example.com' },
    { UsuarioID: 2, Estado: 'INACTIVO', NombreCompleto: 'Luis Solano' },
  ]);
  assert.equal(active.length, 1);
  assert.deepEqual(buildMaintenanceTechnicians(active), [{
    value: '1',
    label: 'Ana Mora',
    note: 'ana@example.com',
    initials: 'AM',
  }]);
});

test('calcula cantidades, registrados, solo lectura y validaciones sin cambiar reglas', () => {
  assert.deepEqual(countRegisteredMaintenanceDevices([
    { categoria: 'CAMARA' },
    { categoria: 'CAMARA' },
    { categoria: 'PUERTA' },
  ]), { CAMARA: 2, PUERTA: 1 });
  assert.equal(expectedMaintenanceTotal({ CAMARA: 2, PUERTA: '3', GABINETE: '' }), 5);
  assert.deepEqual(updateMaintenanceCount({ CAMARA: 2 }, 'CAMARA', -4), { CAMARA: 0 });
  assert.equal(maintenanceReadOnly({ editing: true, estado: 'FINALIZADO', isAdmin: false }), true);
  assert.equal(maintenanceReadOnly({ editing: true, estado: 'FINALIZADO', isAdmin: true }), false);
  assert.equal(validateMaintenanceForm({ titulo: '', clienteId: '1', responsables: ['2'] }), 'El título es obligatorio.');
  assert.equal(validateMaintenanceForm({ titulo: 'Visita', clienteId: '', responsables: ['2'] }), 'Selecciona un cliente.');
  assert.equal(validateMaintenanceForm({ titulo: 'Visita', clienteId: '1', responsables: [] }), 'Selecciona al menos un responsable.');
  assert.equal(validateMaintenanceForm({ titulo: 'Visita', clienteId: '1', responsables: ['2'] }), '');
});

test('filtra equipos localmente por sede', () => {
  const rows = [
    { id: '1', name: 'Piso 1', locationId: 'A' },
    { id: '2', name: 'Piso 2', locationId: 'B' },
    { id: '3', name: 'General', locationId: '' },
  ];
  assert.deepEqual(filterMaintenanceEquipment(rows, 'A').map((item) => item.id), ['1', '3']);
  assert.deepEqual(filterMaintenanceEquipment(rows, ''), []);
});

test('mantenimiento abre con una página pequeña y busca clientes por nombre en toda la base', () => {
  const resources = source('src/features/maintenance/useMaintenanceResources.js');
  const general = source('src/components/maintenance/MaintenanceGeneralStep.jsx');

  assert.ok(resources.includes("import { loadCatalogResource } from '../../services/catalogResource';"));
  assert.ok(resources.includes("import { fetchClientRelations } from '../../services/clientRelations';"));
  assert.ok(resources.includes('const CLIENT_PAGE_SIZE = 80;'));
  assert.ok(resources.includes('const CLIENT_SEARCH_PAGE_SIZE = 1000;'));
  assert.ok(resources.includes('const CLIENT_CACHE_TTL_MS = 60_000;'));
  assert.ok(resources.includes('pageSize = CLIENT_PAGE_SIZE'));
  assert.ok(resources.includes('...(normalizedQuery ? { q: normalizedQuery } : {})'));
  assert.equal(resources.includes('activo: true'), false);
  assert.ok(resources.includes('const searchClients = useCallback'));
  assert.ok(resources.includes('if (!normalizedQuery) return [];'));
  assert.ok(resources.includes('pageSize: CLIENT_SEARCH_PAGE_SIZE'));
  assert.ok(resources.includes('mergeClients(result.items)'));
  assert.equal(resources.includes('const totalPages = Math.max('), false);
  assert.equal(resources.includes('for (let page = 2; page <= totalPages; page += 1)'), false);
  assert.ok(resources.includes('const controller = new AbortController();'));
  assert.ok(resources.includes('signal: controller.signal'));
  assert.ok(resources.includes('return () => controller.abort();'));
  assert.ok(resources.includes('filterMaintenanceEquipment(allEquipment, locationId)'));
  assert.equal(resources.includes('force: true'), false);
  assert.equal(resources.includes('equipmentLocationsList'), false);
  assert.equal(resources.includes('locationsList'), false);

  assert.ok(general.includes('searchPlaceholder="Buscar cliente por nombre..."'));
  assert.ok(general.includes('searchMinLength={1}'));
  assert.ok(general.includes('searchDelay={250}'));
  assert.ok(general.includes('onSearch={onSearchClients}'));
  assert.ok(general.includes('selectedLabel={form.cliente}'));
});

test('clientes históricos siguen siendo buscables aunque usen Clientes y Activo vacío', () => {
  const crud = source('backend/src/modules/crud.module.js');
  const catalog = source('src/services/catalogResource.js');

  assert.ok(crud.includes("search: ['Nombre','Clientes','RazonSocial','CorreoGeneral','Telefono']"));
  assert.ok(crud.includes('function listFilterPayload'));
  assert.ok(crud.includes("definitionKey !== 'clients' || includeInactive"));
  assert.ok(crud.includes('const { activo: _activo, Activo: _Activo, ...rest } = payload || {};'));
  assert.ok(catalog.includes("rawActive === undefined || rawActive === null || rawActive === ''"));
  assert.ok(catalog.includes("String(row?.Estado || 'ACTIVO').toUpperCase() !== 'INACTIVO'"));
});

test('el hook principal delega recursos y la creación rápida evita mutaciones directas', () => {
  const formHook = source('src/hooks/useMaintenanceForm.js');
  const quickCreate = source('src/features/maintenance/useMaintenanceQuickCreate.js');
  const page = source('src/pages/maintenance/MaintenanceFormPage.jsx');
  const general = source('src/components/maintenance/MaintenanceGeneralStep.jsx');

  assert.ok(formHook.includes("import useMaintenanceResources from '../features/maintenance/useMaintenanceResources';"));
  assert.ok(formHook.includes('validateMaintenanceForm(form)'));
  assert.ok(formHook.includes('clients: resources.clients'));
  assert.ok(formHook.includes('searchClients: resources.searchClients'));
  assert.ok(formHook.includes('addEquipment: resources.addEquipment'));
  assert.equal(formHook.includes('MODULE_ROUTES.clients.list'), false);
  assert.equal(formHook.includes('MODULE_ROUTES.clients.locationsList'), false);
  assert.equal(formHook.includes('MODULE_ROUTES.clients.equipmentLocationsList'), false);

  assert.ok(quickCreate.includes('addLocation(view);'));
  assert.ok(quickCreate.includes('addEquipment({'));
  assert.equal(quickCreate.includes('locations.push'), false);
  assert.equal(quickCreate.includes('equipment.push'), false);
  assert.ok(page.includes('addLocation: state.addLocation'));
  assert.ok(page.includes('addEquipment: state.addEquipment'));
  assert.ok(page.includes('onSearchClients={state.searchClients}'));
  assert.ok(general.includes('onSearch={onSearchClients}'));
  assert.ok(general.includes('selectedLabel={form.cliente}'));
});
