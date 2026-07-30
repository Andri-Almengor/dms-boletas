import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  MAINTENANCE_DEVICE_DRAFT_DELAY_MS,
  cloneMaintenanceDevice,
  maintenanceDeviceChanged,
  maintenanceDeviceDraftKey,
  maintenanceDeviceSignature,
  maintenanceFormSignature,
  mergeMaintenanceDevice,
  pendingMaintenanceImagesToRelease,
  restoreLegacyMaintenanceDevice,
  serializableMaintenanceDevice,
} from '../../src/features/maintenance/maintenanceDeviceState.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function source(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function sampleDevice(overrides = {}) {
  return {
    id: 'DEV-1',
    localId: 'LOCAL-1',
    nombre: 'Cámara norte',
    respuestas: { limpieza: 'Sí' },
    images: [{ id: 'IMG-1', Tipo: 'Antes', Nota: 'Inicial', dirty: true, dataUrl: 'data:image/png;base64,AAA', previewUrl: 'blob:old' }],
    newImages: [{ localId: 'NEW-1', type: 'Después', note: 'Final', previewUrl: 'blob:new', file: { name: 'foto.jpg', size: 123, lastModified: 456 } }],
    ...overrides,
  };
}

test('clona dispositivos sin compartir respuestas ni arreglos de imágenes', () => {
  const original = sampleDevice();
  const clone = cloneMaintenanceDevice(original);
  clone.respuestas.limpieza = 'No';
  clone.images[0].Nota = 'Editada';
  clone.newImages[0].note = 'Otra';

  assert.equal(original.respuestas.limpieza, 'Sí');
  assert.equal(original.images[0].Nota, 'Inicial');
  assert.equal(original.newImages[0].note, 'Final');
});

test('serializa el borrador sin blobs, data URLs ni archivos nuevos', () => {
  const serialized = serializableMaintenanceDevice(sampleDevice());
  assert.equal(serialized.images[0].dataUrl, undefined);
  assert.equal(serialized.images[0].previewUrl, undefined);
  assert.deepEqual(serialized.newImages, []);
});

test('las firmas detectan cambios de payload, evidencias y archivos', () => {
  const original = sampleDevice();
  const edited = sampleDevice({ nombre: 'Cámara editada' });
  const signature = (device) => maintenanceDeviceSignature(device, { nombre: device?.nombre || '' });

  assert.equal(maintenanceDeviceChanged(original, cloneMaintenanceDevice(original), signature), false);
  assert.equal(maintenanceDeviceChanged(edited, original, signature), true);
  assert.notEqual(signature(original), maintenanceDeviceSignature(sampleDevice({ newImages: [] }), { nombre: original.nombre }));
});

test('mantiene firma del mantenimiento, unión por localId y restauración histórica', () => {
  const device = sampleDevice();
  const signature = maintenanceFormSignature({ titulo: 'Mantenimiento' }, [device]);
  assert.match(signature, /Mantenimiento/);
  assert.equal(signature.includes('data:image'), false);

  const replaced = mergeMaintenanceDevice([device], { ...device, nombre: 'Actualizada' });
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0].nombre, 'Actualizada');

  const appended = mergeMaintenanceDevice(replaced, sampleDevice({ id: 'DEV-2', localId: 'LOCAL-2' }));
  assert.equal(appended.length, 2);

  const fresh = sampleDevice({ id: '', localId: 'FRESH', images: [], newImages: [] });
  const restored = restoreLegacyMaintenanceDevice(fresh, sampleDevice({ id: 'SERVER', localId: 'OLD' }));
  assert.equal(restored.localId, 'FRESH');
  assert.equal(restored.id, '');
  assert.deepEqual(restored.images, []);
  assert.deepEqual(restored.newImages, []);
});

test('identifica imágenes pendientes y conserva la clave y demora históricas', () => {
  const original = sampleDevice({ newImages: [{ localId: 'KEEP' }] });
  const current = sampleDevice({ newImages: [{ localId: 'KEEP' }, { localId: 'REMOVE' }] });
  assert.deepEqual(pendingMaintenanceImagesToRelease(current, original).map((item) => item.localId), ['REMOVE']);
  assert.equal(maintenanceDeviceDraftKey('M-1'), 'dms-maintenance-device-draft:M-1');
  assert.equal(maintenanceDeviceDraftKey(''), 'dms-maintenance-device-draft:new');
  assert.equal(MAINTENANCE_DEVICE_DRAFT_DELAY_MS, 650);
});

test('el hook centraliza apertura, descarte y autoguardado local', () => {
  const lifecycle = source('src/features/maintenance/useMaintenanceDeviceEditorLifecycle.js');
  const fileLifecycle = source('src/utils/localFileLifecycle.js');
  const formHook = source('src/hooks/useMaintenanceForm.js');
  const scalable = source('src/hooks/useScalableMaintenanceForm.js');

  assert.match(lifecycle, /useMaintenanceDeviceEditorLifecycle/);
  assert.match(lifecycle, /¿Descartar los cambios realizados en este dispositivo\?/);
  assert.match(lifecycle, /localStorage\.setItem\(draftKey/);
  assert.match(lifecycle, /MAINTENANCE_DEVICE_DRAFT_DELAY_MS/);
  assert.match(lifecycle, /dms-offline-editing-complete/);
  assert.match(lifecycle, /releaseLocalFiles/);
  assert.match(fileLifecycle, /dms-draft-file-removed/);
  assert.match(fileLifecycle, /URL\.revokeObjectURL/);
  assert.match(lifecycle, /markDeviceSaved/);
  assert.match(lifecycle, /removeDeviceLocally/);

  assert.match(formHook, /useMaintenanceDeviceEditorLifecycle/);
  assert.match(formHook, /editor\.markDeviceSaved/);
  assert.match(formHook, /editor\.cancelActiveDevice/);
  assert.match(formHook, /editor\.clearDeviceDraft/);
  assert.doesNotMatch(formHook, /function cloneDevice/);
  assert.doesNotMatch(formHook, /function serializableDevice/);
  assert.doesNotMatch(formHook, /LOCAL_DRAFT_DELAY_MS/);

  assert.match(scalable, /base\.commitActiveDevice/);
  assert.match(scalable, /persistMaintenanceDeviceCollection/);
  assert.match(scalable, /base\.clearDeviceDraft\(\)/);
  assert.doesNotMatch(scalable, /base\.markDeviceSaved\(snapshot/);
  assert.doesNotMatch(scalable, /base\.saveActiveDevice\(snapshot/);
});
