import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { maintenanceDeviceCreatedMessage } from '../../src/services/maintenanceDeviceCreatedFeedback.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function source(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('redacta una confirmación visual clara para el dispositivo creado', () => {
  assert.deepEqual(maintenanceDeviceCreatedMessage({
    deviceName: 'Cámara acceso principal',
    locationName: 'Recepción',
    offlinePending: false,
  }), {
    title: 'Dispositivo agregado',
    description: 'Cámara acceso principal se agregó a “Recepción”.',
  });

  assert.match(maintenanceDeviceCreatedMessage({
    deviceName: 'Lector norte',
    locationName: 'Puerta norte',
    offlinePending: true,
  }).description, /se sincronizará al recuperar conexión/);
});

test('el alta rápida muestra la confirmación solamente después del guardado', () => {
  const creator = source('src/components/maintenance/MaintenanceQuickDeviceCreator.jsx');

  assert.match(creator, /maintenanceDeviceCreatedFeedback/);
  assert.match(creator, /await onCreated\?\.\(feedback\)/);
  assert.match(creator, /onClose\(\);\s*showMaintenanceDeviceCreatedFeedback\(feedback\)/);
  assert.match(creator, /offlinePending \|=/);
  assert.match(creator, /locationName:/);
});

test('la búsqueda reserva espacio para la lupa y la ubicación recibe una tarjeta de éxito', () => {
  const styles = source('src/styles/maintenance-technician-feedback.css');
  const route = source('src/styles/routes/maintenance.js');
  const feedback = source('src/services/maintenanceDeviceCreatedFeedback.js');

  assert.match(route, /maintenance-technician-feedback\.css/);
  assert.match(styles, /\.technician-select__search \.input-shell__leading/);
  assert.match(styles, /padding-left:\s*46px\s*!important/);
  assert.match(styles, /\.maintenance-location-device-created-feedback/);
  assert.match(styles, /has-device-created-feedback/);
  assert.match(feedback, /resetInventoryFilters/);
  assert.match(feedback, /scrollIntoView/);
  assert.match(feedback, /maintenance-location-work-group__text strong/);
});
