import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  maintenanceDeviceCreatedMessage,
  navigateMaintenanceDeviceInApp,
} from '../../src/services/maintenanceDeviceCreatedFeedback.js';

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

test('la tarjeta offline abre el editor modal sin cambiar la URL', () => {
  const originalWindow = globalThis.window;
  const originalCustomEvent = globalThis.CustomEvent;
  const received = [];

  class TestCustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  }

  globalThis.CustomEvent = TestCustomEvent;
  globalThis.window = {
    location: { origin: 'https://dms.test' },
    dispatchEvent(event) { received.push(event); },
  };

  try {
    assert.equal(navigateMaintenanceDeviceInApp('/mantenimientos/mantenimiento-1/editar?directDevice=1&device=dispositivo-2'), true);
    assert.equal(received.length, 1);
    assert.equal(received[0].type, 'dms-open-offline-maintenance-device');
    assert.deepEqual(received[0].detail, {
      maintenanceId: 'mantenimiento-1',
      deviceId: 'dispositivo-2',
    });
    assert.equal(globalThis.window.location.pathname, undefined);
  } finally {
    globalThis.window = originalWindow;
    globalThis.CustomEvent = originalCustomEvent;
  }
});

test('el editor offline se monta globalmente y persiste sobre la misma pantalla', () => {
  const feedback = source('src/services/maintenanceDeviceCreatedFeedback.js');
  const editor = source('src/services/maintenanceOfflineDeviceEditor.jsx');
  const routes = source('src/services/maintenanceRoutes.js');

  assert.match(feedback, /dms-open-offline-maintenance-device/);
  assert.doesNotMatch(feedback, /window\.history\.pushState/);
  assert.doesNotMatch(feedback, /PopStateEvent/);
  assert.match(feedback, /document\.createElement\('button'\)/);
  assert.match(feedback, /edit\.type = 'button'/);
  assert.doesNotMatch(feedback, /edit\.href\s*=/);

  assert.match(routes, /maintenanceOfflineDeviceEditor/);
  assert.match(editor, /createRoot/);
  assert.match(editor, /MaintenanceDeviceEditor/);
  assert.match(editor, /requestAvailable\([\s\S]*MODULE_ROUTES\.maintenance\.get/);
  assert.match(editor, /persistMaintenanceDevice/);
  assert.match(editor, /dms-offline-queue-change/);
  assert.match(editor, /data-offline-device-editor/);
  assert.doesNotMatch(editor, /useNavigate/);
});

test('la ubicación muestra un estado offline compacto y editable', () => {
  const styles = source('src/styles/maintenance-technician-feedback.css');
  const feedback = source('src/services/maintenanceDeviceCreatedFeedback.js');

  assert.match(styles, /\.maintenance-offline-device-preview/);
  assert.match(styles, /\.maintenance-offline-device-preview__status-copy/);
  assert.match(styles, /\.maintenance-offline-device-preview__edit/);
  assert.match(styles, /@media \(max-width:\s*620px\)[\s\S]*\.maintenance-offline-device-preview__status[\s\S]*width:\s*100%/);
  assert.match(feedback, /renderOfflinePreview/);
  assert.match(feedback, /MAX_PREVIEW_ATTEMPTS/);
  assert.match(feedback, /attempt \+ 1/);
  assert.match(feedback, /statusTitle\.textContent = 'Guardado offline'/);
  assert.match(feedback, /statusText\.textContent = 'Pendiente de sincronizar'/);
  assert.match(feedback, /Editar dispositivo y evidencias/);
  assert.match(feedback, /resetInventoryFilters/);
  assert.match(feedback, /scrollIntoView/);
});
