import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

const core = source('src/services/offlineStoreCore.js');
const wrapper = source('src/services/offlineStore.js');
const mediaStore = source('src/services/offlineMediaStore.js');

test('Etapa 7: IndexedDB conserva nombres, versiones, stores e índices compatibles', () => {
  assert.match(core, /const DB_NAME = 'dms-boletas-offline'/);
  assert.match(core, /const DB_VERSION = 3/);
  assert.match(core, /const CACHE_STORE = 'responses'/);
  assert.match(core, /const QUEUE_STORE = 'operations'/);
  assert.match(core, /const META_STORE = 'meta'/);
  assert.match(core, /const ID_MAP_STORE = 'idMap'/);
  assert.match(core, /createIndex\('entityId', 'entityId'\)/);
  assert.match(core, /createIndex\('status', 'status'\)/);
  assert.match(core, /createIndex\('createdAt', 'createdAt'\)/);
  assert.match(mediaStore, /const DB_NAME = 'dms-boletas-offline-media'/);
  assert.match(mediaStore, /const DB_VERSION = 1/);
  assert.match(mediaStore, /keyPath: 'mediaId'/);
});

test('Etapa 7: la cola mantiene prioridad de dependencias y orden temporal', () => {
  assert.match(core, /maintenanceCreate:\s*10/);
  assert.match(core, /maintenanceDeviceCreate:\s*30/);
  assert.match(core, /maintenanceImage:\s*41/);
  assert.match(core, /ticketEvidence:\s*41/);
  assert.match(core, /const byPriority = operationPriority\(a\) - operationPriority\(b\)/);
  assert.match(core, /Number\(a\.createdAt \|\| 0\) - Number\(b\.createdAt \|\| 0\)/);
});

test('Etapa 7: el estado por entidad conserva contadores y bloqueo de finalización', () => {
  assert.match(core, /pending:\s*operations\.length/);
  assert.match(core, /status\)\.toUpperCase\(\) === 'ERROR'/);
  assert.match(core, /status\)\.toUpperCase\(\) === 'SYNCING'/);
  assert.match(core, /readyToFinalize:\s*operations\.length === 0/);
});

test('Etapa 7: caché offline conserva expiración de 30 días y contrato de secciones', () => {
  assert.match(core, /CACHE_MAX_AGE_MS = 30 \* 24 \* 60 \* 60 \* 1000/);
  for (const section of ['clients', 'locations', 'equipmentLocations', 'contacts', 'categories', 'failures', 'devices', 'manufacturers', 'models', 'relations', 'users']) {
    assert.match(core, new RegExp(`id: '${section}'`));
  }
  assert.match(core, /pendingOperations:\s*pendingOperations\.map/);
  assert.match(core, /blockedCount:/);
  assert.match(core, /approximateIndexedDbBytes/);
});

test('Etapa 7: medios continúan separados, con Blob original y límite offline existente', () => {
  assert.match(mediaStore, /MAX_OFFLINE_MEDIA_BYTES = 25 \* 1024 \* 1024/);
  assert.match(mediaStore, /record\.blob instanceof Blob/);
  assert.match(mediaStore, /navigator\.storage\?\.estimate/);
  assert.match(wrapper, /stripInlineMediaPayload/);
  assert.match(wrapper, /hydrateMediaPayload/);
  assert.match(wrapper, /removeOfflineMedia\(mediaId\)/);
});

test('Etapa 7: el wrapper conserva carga diferida del núcleo y modo offline explícito', () => {
  assert.match(wrapper, /import\('\.\/offlineStoreCore'\)/);
  assert.match(wrapper, /isOfflineModeEnabled\(\)/);
  assert.match(wrapper, /OFFLINE_MODE_DISABLED/);
  assert.match(wrapper, /dehydrateCachedMedia/);
  assert.match(wrapper, /hydrateCachedMedia/);
});
