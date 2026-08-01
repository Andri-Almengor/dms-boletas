import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  base64ToBlob,
  blobToBase64,
  createOfflineMediaRecord,
  hydrateMediaPayload,
  isBlobBackedOfflineKind,
  offlineMediaIdFromReference,
  offlineMediaReference,
  optimizeOfflineImageBlob,
  stripInlineMediaPayload,
} from '../../src/services/offlineMediaDomain.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('convierte base64 a Blob y lo reconstruye sin alterar el contenido', async () => {
  const original = globalThis.btoa('fotografia-offline-dms');
  const blob = base64ToBlob(original, 'image/jpeg');

  assert.ok(blob instanceof Blob);
  assert.equal(blob.type, 'image/jpeg');
  assert.equal(await blobToBase64(blob), original);
});

test('la cola conserva una referencia ligera y reconstruye el contrato del backend', async () => {
  const original = {
    imageId: 'foto-local-1',
    deviceId: 'dispositivo-local-1',
    maintenanceId: 'mantenimiento-local-1',
    fileName: 'antes.jpg',
    mimeType: 'image/jpeg',
    base64: globalThis.btoa('contenido-binario'),
  };
  const blob = base64ToBlob(original.base64, original.mimeType);
  const record = createOfflineMediaRecord('maintenanceImage', original, blob, 'media-local-1');
  const queued = stripInlineMediaPayload(original, record.mediaId);

  assert.equal(queued.base64, undefined);
  assert.equal(queued.offlineMediaId, 'media-local-1');
  assert.equal(record.entityId, 'foto-local-1');
  assert.equal(record.deviceId, 'dispositivo-local-1');

  const replay = await hydrateMediaPayload(queued, record);
  assert.equal(replay.base64, original.base64);
  assert.equal(replay.mimeType, 'image/jpeg');
  assert.equal(replay.offlineMediaId, undefined);
  assert.equal(replay.OfflineMediaID, undefined);
});

test('las referencias de caché se pueden resolver sin guardar data URLs', () => {
  const reference = offlineMediaReference('media-local con espacios');
  assert.equal(reference.startsWith('dms-offline-media://'), true);
  assert.equal(offlineMediaIdFromReference(reference), 'media-local con espacios');
  assert.equal(isBlobBackedOfflineKind('maintenanceImage'), true);
  assert.equal(isBlobBackedOfflineKind('maintenanceUpdate'), false);
});

test('la optimización mantiene el Blob original cuando el navegador no ofrece decodificación', async () => {
  const blob = new Blob(['imagen'], { type: 'image/jpeg' });
  const optimized = await optimizeOfflineImageBlob(blob);
  assert.equal(optimized, blob);
});

test('la infraestructura separa blobs, controla cuota y limpia después de sincronizar', () => {
  const store = source('src/services/offlineMediaStore.js');
  const wrapper = source('src/services/offlineStore.js');

  assert.match(store, /dms-boletas-offline-media/);
  assert.match(store, /keyPath: 'mediaId'/);
  assert.match(store, /MAX_OFFLINE_MEDIA_BYTES/);
  assert.match(store, /OFFLINE_MEDIA_UNSUPPORTED/);
  assert.match(store, /navigator\.storage\?\.estimate/);
  assert.match(store, /requestPersistentOfflineStorage/);
  assert.match(wrapper, /persistOperationMedia/);
  assert.match(wrapper, /stripInlineMediaPayload/);
  assert.match(wrapper, /dehydrateCachedMedia/);
  assert.match(wrapper, /hydrateCachedMedia/);
  assert.match(wrapper, /startsWith\('blob:'\)/);
  assert.match(wrapper, /resolveOfflineOperationPayload/);
  assert.match(wrapper, /removeOfflineMedia\(mediaId\)/);
});
