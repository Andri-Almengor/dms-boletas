import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');
const section = (text, start, end) => {
  const from = text.indexOf(start);
  assert.notEqual(from, -1, `No se encontró ${start}`);
  const to = text.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `No se encontró ${end}`);
  return text.slice(from, to);
};

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
  for (const sectionId of ['clients', 'locations', 'equipmentLocations', 'contacts', 'categories', 'failures', 'devices', 'manufacturers', 'models', 'relations', 'users']) {
    assert.match(core, new RegExp(`id: '${sectionId}'`));
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

test('Etapa 7: el estado de una entidad usa el índice existente y conserva el mismo orden', () => {
  const body = section(core, 'export async function getEntityQueueState', 'export async function removeQueuedOperation');
  assert.match(body, /readByIndex\(QUEUE_STORE, 'entityId', id\)/);
  assert.match(body, /sortQueuedOperations/);
  assert.doesNotMatch(body, /listQueuedOperations\(/);
});

test('Etapa 7: actualizar una operación usa una sola transacción readwrite', () => {
  const body = section(core, 'export async function updateQueuedOperation', 'export async function listOfflineIdMappings');
  assert.match(body, /db\.transaction\(QUEUE_STORE, 'readwrite'\)/);
  assert.match(body, /store\.get\(id\)/);
  assert.match(body, /store\.put\(/);
  assert.doesNotMatch(body, /'readonly'/);
  assert.doesNotMatch(body, /run\(QUEUE_STORE/);
});

test('Etapa 7: deduplicar la cola no materializa ni ordena todas las operaciones', () => {
  const body = section(core, 'export async function enqueueOperation', 'export async function queuedOperationCount');
  assert.match(body, /findQueuedOperationByDedupeKey\(dedupeKey\)/);
  assert.doesNotMatch(body, /listQueuedOperations\(/);
  const finder = section(core, 'async function findQueuedOperationByDedupeKey', 'export function responseCacheKey');
  assert.match(finder, /openCursor\(\)/);
  assert.match(finder, /compareQueuedOperations/);
  assert.doesNotMatch(finder, /getAll\(/);
});

test('Etapa 7: actualizar respuestas de caché recorre y modifica por cursor sin cargar el store completo', () => {
  const body = section(core, 'export async function updateCachedResponses', 'function emitQueueChange');
  assert.match(body, /db\.transaction\(CACHE_STORE, 'readwrite'\)/);
  assert.match(body, /store\.openCursor\(\)/);
  assert.match(body, /cursor\.update\(/);
  assert.doesNotMatch(body, /readAll\(CACHE_STORE\)/);
  assert.doesNotMatch(body, /\.filter\(/);
});

test('Etapa 7: estadísticas IndexedDB se agregan por cursor y no serializan los stores completos', () => {
  const body = core.slice(core.indexOf('export async function getOfflineStorageStats'));
  assert.match(body, /scanStore\(CACHE_STORE/);
  assert.match(body, /scanStore\(QUEUE_STORE/);
  assert.match(body, /scanStore\(META_STORE/);
  assert.match(body, /scanStore\(ID_MAP_STORE/);
  assert.doesNotMatch(body, /readAll\(/);
  const estimator = section(core, 'function approximateValueBytes', 'export async function getOfflineStorageStats');
  assert.match(estimator, /value\.length \* 2/);
  assert.match(estimator, /value instanceof Blob/);
  assert.doesNotMatch(estimator, /JSON\.stringify/);
});

test('Etapa 7: estadísticas de medios cuentan bytes por cursor sin cargar todos los Blob', () => {
  const body = mediaStore.slice(mediaStore.indexOf('export async function getOfflineMediaStats'));
  assert.match(body, /openCursor\(\)/);
  assert.match(body, /record\.blob\?\.size/);
  assert.doesNotMatch(body, /listOfflineMedia\(\)/);
  assert.doesNotMatch(body, /getAll\(\)/);
});
