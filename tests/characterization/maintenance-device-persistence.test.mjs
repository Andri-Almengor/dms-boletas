import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  buildMaintenanceDevicePersistenceState,
  ensureMaintenanceDeviceIdentity,
  maintenanceDevicePartialFailureText,
} from '../../src/features/maintenance/maintenanceDevicePersistenceState.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function source(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function sampleDevice(overrides = {}) {
  return {
    id: '',
    localId: 'LOCAL-1',
    nombre: 'Cámara norte',
    respuestas: {},
    images: [
      { id: 'IMG-OK', Tipo: 'Antes', Nota: 'Actualizada', dirty: true },
      { id: 'IMG-FAIL', Tipo: 'Después', Nota: 'Pendiente', dirty: true },
      { id: 'IMG-CLEAN', Tipo: 'Antes', Nota: 'Sin cambios', dirty: false },
    ],
    newImages: [
      { localId: 'NEW-OK', type: 'Antes', note: 'Correcta', file: { name: 'ok.jpg' } },
      { localId: 'NEW-FAIL', type: 'Después', note: 'Pendiente', file: { name: 'fail.jpg' } },
    ],
    ...overrides,
  };
}

test('mantiene identificadores idempotentes para creación y reintentos', () => {
  assert.deepEqual(
    ensureMaintenanceDeviceIdentity({ id: 'SERVER-1', localId: 'LOCAL-1' }, () => 'GENERATED'),
    { id: 'SERVER-1', localId: 'LOCAL-1' },
  );
  assert.deepEqual(
    ensureMaintenanceDeviceIdentity({ id: '', localId: 'LOCAL-1' }, () => 'GENERATED'),
    { id: 'LOCAL-1', localId: 'LOCAL-1' },
  );
  assert.deepEqual(
    ensureMaintenanceDeviceIdentity({}, () => 'GENERATED'),
    { id: 'GENERATED', localId: 'GENERATED' },
  );
});

test('conserva únicamente evidencias fallidas después de un guardado parcial', () => {
  const result = buildMaintenanceDevicePersistenceState({
    device: sampleDevice(),
    deviceId: 'SERVER-DEVICE',
    metadataResult: {
      updatedIds: ['IMG-OK'],
      failed: [{ imageId: 'IMG-FAIL', message: 'No disponible' }],
    },
    uploadResult: {
      uploaded: [{ clientKey: 'NEW-OK', FotoDispositivoID: 'PHOTO-1', Tipo: 'Antes' }],
      failed: [{ clientKey: 'NEW-FAIL', message: 'No disponible' }],
    },
  });

  assert.equal(result.complete, false);
  assert.equal(result.snapshot.id, 'SERVER-DEVICE');
  assert.equal(result.snapshot.images.find((item) => item.id === 'IMG-OK').dirty, false);
  assert.equal(result.snapshot.images.find((item) => item.id === 'IMG-FAIL').dirty, true);
  assert.equal(result.snapshot.images.find((item) => item.id === 'IMG-CLEAN').dirty, false);
  assert.equal(result.snapshot.images.find((item) => item.id === 'PHOTO-1').dirty, false);
  assert.deepEqual(result.snapshot.newImages.map((item) => item.localId), ['NEW-FAIL']);
  assert.deepEqual([...result.uploadedKeys], ['NEW-OK']);
  assert.match(result.failureMessage, /1 cambio de evidencia y 1 fotografía/);
});

test('produce un resultado completamente sincronizado cuando no hay fallos', () => {
  const device = sampleDevice({
    images: [{ id: 'IMG-OK', dirty: true }],
    newImages: [{ localId: 'NEW-OK', file: { name: 'ok.jpg' } }],
  });
  const result = buildMaintenanceDevicePersistenceState({
    device,
    deviceId: 'SERVER-DEVICE',
    metadataResult: { updatedIds: ['IMG-OK'], failed: [] },
    uploadResult: {
      uploaded: [{ clientKey: 'NEW-OK', FotoDispositivoID: 'PHOTO-1' }],
      failed: [],
    },
  });

  assert.equal(result.complete, true);
  assert.equal(result.failureMessage, '');
  assert.equal(result.snapshot.images[0].dirty, false);
  assert.deepEqual(result.snapshot.newImages, []);
});

test('conserva el texto histórico de guardado parcial', () => {
  assert.equal(
    maintenanceDevicePartialFailureText(
      { nombre: 'Puerta principal' },
      [{ imageId: '1' }, { imageId: '2' }],
      [{ clientKey: '3' }],
    ),
    'El dispositivo “Puerta principal” se guardó parcialmente. No se pudieron guardar 2 cambios de evidencia y 1 fotografía. Los elementos pendientes permanecen en el formulario para reintentarlos.',
  );
});

test('los hooks delegan dispositivo, evidencias y colecciones al servicio común', () => {
  const service = source('src/services/maintenanceDevicePersistence.js');
  const formHook = source('src/hooks/useMaintenanceForm.js');
  const scalable = source('src/hooks/useScalableMaintenanceForm.js');

  assert.match(service, /maintenanceDevicePayload/);
  assert.match(service, /updateMaintenanceImagesInBatches/);
  assert.match(service, /uploadMaintenanceImagesInBatches/);
  assert.match(service, /persistMaintenanceDeviceCollection/);
  assert.match(service, /MAINTENANCE_DEVICE_PARTIAL_SAVE/);

  assert.match(formHook, /persistMaintenanceDevice\(/);
  assert.match(formHook, /persistMaintenanceDeviceCollection\(/);
  assert.doesNotMatch(formHook, /fileToBase64/);
  assert.doesNotMatch(formHook, /for \(const image of/);
  assert.doesNotMatch(formHook, /maintenanceDevicePayload/);

  assert.match(scalable, /base\.commitActiveDevice/);
  assert.match(scalable, /persistMaintenanceDeviceCollection\(/);
  assert.doesNotMatch(scalable, /updateMaintenanceImagesInBatches/);
  assert.doesNotMatch(scalable, /uploadMaintenanceImagesInBatches/);
  assert.doesNotMatch(scalable, /function failureText/);
  assert.doesNotMatch(scalable, /function idempotentDevice/);
});
