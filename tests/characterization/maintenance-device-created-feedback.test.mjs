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

test('redacta confirmaciones distintas para guardado normal y offline', () => {
  assert.deepEqual(maintenanceDeviceCreatedMessage({
    deviceName: 'Cámara acceso principal',
    locationName: 'Recepción',
    offlinePending: false,
  }), {
    title: 'Dispositivo agregado',
    description: 'Cámara acceso principal se agregó a “Recepción”.',
  });

  const offline = maintenanceDeviceCreatedMessage({
    deviceName: 'Lector norte',
    locationName: 'Puerta norte',
    offlinePending: true,
  });
  assert.equal(offline.title, 'Dispositivo guardado offline');
  assert.match(offline.description, /Ya puede verlo y editarlo en esta ubicación/);
  assert.match(offline.description, /Se sincronizará al recuperar conexión/);
});

test('el alta rápida conserva datos suficientes para ver y editar el dispositivo offline', () => {
  const creator = source('src/components/maintenance/MaintenanceQuickDeviceCreator.jsx');

  assert.match(creator, /maintenanceDeviceCreatedFeedback/);
  assert.match(creator, /responseIsOfflinePending/);
  assert.match(creator, /offlineQueued/);
  assert.match(creator, /maintenanceId:/);
  assert.match(creator, /category:/);
  assert.match(creator, /model:/);
  assert.match(creator, /serial:/);
  assert.match(creator, /await onCreated\?\.\(feedback\)/);
  assert.match(creator, /onClose\(\);\s*showMaintenanceDeviceCreatedFeedback\(feedback\)/);
});

test('el buscador móvil separa físicamente la lupa del texto', () => {
  const selector = source('src/components/forms/TechnicianMultiSelect.jsx');
  const styles = source('src/styles/maintenance-technician-feedback.css');
  const route = source('src/styles/routes/maintenance.js');

  assert.match(route, /maintenance-technician-feedback\.css/);
  assert.match(selector, /technician-select__search-icon/);
  assert.match(selector, /technician-select__search-input/);
  assert.doesNotMatch(selector, /input-shell__leading/);
  assert.doesNotMatch(selector, /form-control--with-leading/);
  assert.match(styles, /grid-template-columns:\s*46px\s+minmax\(0,\s*1fr\)/);
  assert.match(styles, /\.technician-select__search-icon[\s\S]*position:\s*static\s*!important/);
  assert.match(styles, /\.technician-select__search-input[\s\S]*padding:\s*0\s+42px\s+0\s+12px\s*!important/);
});

test('la ubicación recibe una tarjeta offline con edición directa', () => {
  const styles = source('src/styles/maintenance-technician-feedback.css');
  const feedback = source('src/services/maintenanceDeviceCreatedFeedback.js');

  assert.match(styles, /\.maintenance-offline-device-preview/);
  assert.match(styles, /\.maintenance-offline-device-preview__edit/);
  assert.match(feedback, /renderOfflinePreview/);
  assert.match(feedback, /Guardado offline · pendiente de sincronizar/);
  assert.match(feedback, /Editar dispositivo y evidencias/);
  assert.match(feedback, /directDevice=1&device=/);
  assert.match(feedback, /resetInventoryFilters/);
  assert.match(feedback, /scrollIntoView/);
});
