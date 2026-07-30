import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  createMaintenanceQuickModal,
  maintenanceDeviceId,
  maintenanceProgress,
  mapCreatedMaintenanceEquipment,
  mapCreatedMaintenanceLocation,
  resolveMaintenanceDirectRequest,
  validateMaintenanceQuickModal,
} from '../../src/features/maintenance/maintenanceFormOrchestration.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function source(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('resuelve el modo directo de dispositivos sin cambiar sus parámetros históricos', () => {
  const params = new URLSearchParams('directDevice=1&newDevice=1&device=DEV-9');
  assert.deepEqual(resolveMaintenanceDirectRequest(params, true), {
    directDeviceMode: true,
    requestedNewDevice: true,
    requestedStep: 2,
    requestedDeviceId: 'DEV-9',
  });

  assert.equal(resolveMaintenanceDirectRequest(new URLSearchParams('step=devices'), false).requestedStep, 2);
  assert.equal(resolveMaintenanceDirectRequest(params, false).directDeviceMode, false);
});

test('mantiene identificación, progreso y contratos de creación rápida', () => {
  assert.equal(maintenanceDeviceId({ EvidenciaMantenimientoID: ' E-1 ' }), 'E-1');
  assert.equal(maintenanceDeviceId({ localId: 'LOCAL-1' }), 'LOCAL-1');
  assert.equal(maintenanceProgress(0, 4), 25);
  assert.equal(maintenanceProgress(3, 4), 100);

  const modal = createMaintenanceQuickModal('location');
  assert.equal(modal.type, 'location');
  assert.equal(validateMaintenanceQuickModal(modal), 'El nombre es obligatorio.');
  modal.values.nombre = 'Sede norte';
  assert.equal(validateMaintenanceQuickModal(modal), '');

  assert.deepEqual(mapCreatedMaintenanceLocation({ UbicacionID: 'U-1', Nombre: 'Sede' }), { id: 'U-1', name: 'Sede' });
  assert.deepEqual(mapCreatedMaintenanceEquipment({ UbicacionEquipoID: 'UE-1' }, 'Rack'), { id: 'UE-1', name: 'Rack' });
});

test('la página delega navegación directa y creación rápida sin cambiar pasos visuales', () => {
  const page = source('src/pages/maintenance/MaintenanceFormPage.jsx');
  assert.match(page, /useMaintenanceDirectDevice/);
  assert.match(page, /useMaintenanceQuickCreate/);
  assert.match(page, /components\/forms\/FormField/);
  assert.match(page, /MaintenanceGeneralStep/);
  assert.match(page, /MaintenanceCountsStep/);
  assert.match(page, /MaintenanceDevicesStep/);
  assert.match(page, /MaintenanceReviewStep/);
  assert.doesNotMatch(page, /function maintenanceDeviceId/);
  assert.doesNotMatch(page, /async function submitModal/);
  assert.doesNotMatch(page, /requestAvailable/);
  assert.doesNotMatch(page, /function Field\(/);
});

test('el hook directo conserva aperturas, mensajes y retorno al detalle', () => {
  const hook = source('src/features/maintenance/useMaintenanceDirectDevice.js');
  assert.match(hook, /Primero indique una cantidad mayor que cero/);
  assert.match(hook, /No se encontró el dispositivo solicitado/);
  assert.match(hook, /closeActiveDevice/);
  assert.match(hook, /cancelActiveDevice/);
  assert.match(hook, /removeDevice/);
  assert.match(hook, /navigate\(detailUrl, \{ replace: true \}\)/);
});

test('la creación rápida conserva rutas, payloads y selección automática', () => {
  const hook = source('src/features/maintenance/useMaintenanceQuickCreate.js');
  assert.match(hook, /MODULE_ROUTES\.clients\.locationsCreate/);
  assert.match(hook, /MODULE_ROUTES\.clients\.equipmentLocationsCreate/);
  assert.match(hook, /clienteId: form\.clienteId/);
  assert.match(hook, /ubicacionId: form\.ubicacionId/);
  assert.match(hook, /addLocation\(view\)/);
  assert.match(hook, /ubicacionId: view\.id/);
  assert.match(hook, /addEquipment\(\{/);
  assert.doesNotMatch(hook, /locations\.push/);
  assert.doesNotMatch(hook, /equipment\.push/);
});
