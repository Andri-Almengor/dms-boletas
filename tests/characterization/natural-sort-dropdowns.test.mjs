import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { compareNatural, sortItemsNaturally, sortOptionsNaturally } from '../../src/utils/naturalSort.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relative) => readFileSync(path.join(ROOT, relative), 'utf8');

test('ordena textos por número, sin distinguir mayúsculas ni tildes y sin mutar la fuente', () => {
  const original = ['Piso 10', 'piso 2', 'Piso 1', 'Ático 3', 'atico 12'];
  const expected = ['Ático 3', 'atico 12', 'Piso 1', 'piso 2', 'Piso 10'];
  assert.deepEqual(sortItemsNaturally(original), expected);
  assert.deepEqual(original, ['Piso 10', 'piso 2', 'Piso 1', 'Ático 3', 'atico 12']);
  assert.equal(compareNatural('cámara 2', 'Camara 10') < 0, true);
});

test('ordena por etiqueta mostrada y conserva identificadores y selección original', () => {
  const options = [
    { value: 'u-10', label: 'Piso 10', locationId: 'sede' },
    { value: 'u-2', label: 'Piso 2', locationId: 'sede' },
    { value: 'u-1', label: 'Piso 1', locationId: 'sede' },
  ];
  const ordered = sortOptionsNaturally(options);
  assert.deepEqual(ordered.map(({ value }) => value), ['u-1', 'u-2', 'u-10']);
  assert.equal(ordered.find(({ value }) => value === 'u-10').locationId, 'sede');
  assert.deepEqual(options.map(({ value }) => value), ['u-10', 'u-2', 'u-1']);
});

test('selector compartido ordena todos los catálogos y mantiene placeholder y valor controlado', () => {
  const selector = source('src/components/forms/DependentSelect.jsx');
  assert.match(selector, /useMemo\(\(\) => sortOptionsNaturally\(options\), \[options\]\)/);
  assert.match(selector, /<option value="">\{loading \? 'Cargando\.\.\.' : placeholder\}<\/option>/);
  assert.match(selector, /const selectedOption = displayedOptions\.find/);
  assert.match(selector, /value=\{value\} onChange=\{onChange\}/);
  assert.doesNotMatch(selector, /normalizedLabel === 'modelo'/);
});

test('ubicaciones de equipo se ordenan naturalmente sin priorizar sede ni alterar la selección', () => {
  const selector = source('src/components/maintenance/MaintenanceEquipmentLocationSelect.jsx');
  const picker = source('src/components/maintenance/MaintenanceLocationPickerModal.jsx');
  assert.match(selector, /sortOptionsNaturally\(uniqueOptions\(/);
  assert.match(selector, /sortItemsNaturally\(locations, \(item\) => item\.name\)/);
  assert.match(selector, /sortItemsNaturally\(clientLocations, \(location\) => location\.name\)/);
  assert.doesNotMatch(selector, /aPreferred|bPreferred/);
  assert.match(picker, /existingLocations=\[\]/);
});

test('boletas, usuarios, clientes, mantenimiento y bóveda usan el orden natural compartido', () => {
  const files = [
    'src/pages/tickets/TicketListPage.jsx',
    'src/pages/tickets/TicketQuickEditPage.jsx',
    'src/pages/users/UserFormPage.jsx',
    'src/pages/admin/CatalogsPage.jsx',
    'src/components/clients/ClientLocationsPanel.jsx',
    'src/components/clients/ClientRelationsManager.jsx',
    'src/pages/security/PasswordVaultPage.jsx',
    'src/components/maintenance/MaintenanceQuickDeviceCreator.jsx',
    'src/components/forms/TechnicianMultiSelect.jsx',
    'src/components/metrics/TicketMetricsDashboard.jsx',
    'src/components/metrics/MaintenanceMetricsDashboard.jsx',
    'src/components/maintenance/MaintenanceDevicesStep.jsx',
    'src/pages/maintenance/MaintenanceListPage.jsx',
  ];
  for (const file of files) {
    assert.match(source(file), /sortOptionsNaturally|sortItemsNaturally|compareNatural/, file);
  }
});

test('se conservan los valores por defecto y secuencias de negocio independientes', () => {
  const bulk = source('src/components/maintenance/MaintenanceQuickDeviceCreator.jsx');
  assert.match(bulk, /const bulkTypes = selectedMaintenanceCategories\(/);
  assert.match(bulk, /bulkSelectedType = bulkTypes\.find/);
  assert.match(bulk, /sortItemsNaturally\(bulkTypes, \(item\) => item\.label \|\| item\.key\)\.map/);
  const editor = source('src/components/maintenance/MaintenanceDeviceEditor.jsx');
  assert.match(editor, /<option>Antes<\/option><option>Despues<\/option>/);
  const metrics = source('src/components/metrics/TicketMetricsDashboard.jsx');
  assert.match(metrics, /\(options\.fechas \|\| \[\]\)\.map/);
});
