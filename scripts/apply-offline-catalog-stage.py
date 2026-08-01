from pathlib import Path
import re


def replace_once(path, old, new, label):
    text = path.read_text(encoding='utf-8')
    if new in text:
        return
    if old not in text:
        raise SystemExit(f'No se encontró el bloque para {label} en {path}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')


def regex_once(path, pattern, replacement, label, flags=0):
    text = path.read_text(encoding='utf-8')
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f'No se pudo aplicar {label} en {path}')
    path.write_text(updated, encoding='utf-8')


def patch_domain():
    path = Path('src/services/offlineCatalogDomain.js')
    pattern = r"export function collectOfflineDependencies\(kind, payload = \{\}\) \{.*?\n\}"
    replacement = """function operationOwnId(kind, payload = {}) {
  const catalogId = catalogEntityId(kind, payload);
  if (catalogId) return catalogId;
  if (kind === 'ticketCreate') return clean(first(payload, ['boletaUid', 'BoletaUID', 'id']));
  if (kind === 'ticketEvidence') return clean(first(payload, ['evidenciaId', 'EvidenciaID', 'id']));
  if (kind === 'maintenanceCreate') return clean(first(payload, ['maintenanceId', 'MantenimientoID', 'id']));
  if (kind === 'maintenanceDeviceCreate') return clean(first(payload, ['deviceId', 'EvidenciaMantenimientoID', 'id']));
  if (kind === 'maintenanceImage') return clean(first(payload, ['imageId', 'FotoDispositivoID', 'id']));
  return '';
}

export function collectOfflineDependencies(kind, payload = {}) {
  const ownId = operationOwnId(kind, payload);
  return [...collectOfflineLocalReferences(payload)]
    .filter((value) => value && value !== ownId)
    .sort();
}"""
    regex_once(path, pattern, replacement, 'dependencias sin autorreferencia', re.S)


def patch_store_core():
    path = Path('src/services/offlineStoreCore.js')
    text = path.read_text(encoding='utf-8')

    import_line = "import {\n  collectOfflineLocalReferences,\n  isOfflineLocalId,\n  replaceOfflineReferences,\n} from './offlineCatalogDomain';\n\n"
    if not text.startswith("import {"):
        text = import_line + text

    text = text.replace("const DB_VERSION = 2;", "const DB_VERSION = 3;", 1)
    text = text.replace("const META_STORE = 'meta';", "const META_STORE = 'meta';\nconst ID_MAP_STORE = 'idMap';", 1)

    priority_marker = "const OPERATION_PRIORITY = Object.freeze({\n"
    catalog_priorities = """const OPERATION_PRIORITY = Object.freeze({
  clientLocationCreate: 12,
  manufacturerCreate: 12,
  deviceTypeCreate: 12,
  equipmentLocationCreate: 16,
  modelCreate: 17,
  deviceManufacturerCreate: 18,
  clientLocationUpdate: 21,
  manufacturerUpdate: 21,
  deviceTypeUpdate: 21,
  equipmentLocationUpdate: 22,
  modelUpdate: 22,
  deviceManufacturerUpdate: 23,
"""
    if "clientLocationCreate: 12" not in text:
        text = text.replace(priority_marker, catalog_priorities, 1)

    old_upgrade = "if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'key' });"
    new_upgrade = """if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(ID_MAP_STORE)) {
        const mappingStore = db.createObjectStore(ID_MAP_STORE, { keyPath: 'localId' });
        mappingStore.createIndex('entityType', 'entityType');
      }"""
    if "db.createObjectStore(ID_MAP_STORE" not in text:
        if old_upgrade not in text:
            raise SystemExit('No se encontró la migración de IndexedDB')
        text = text.replace(old_upgrade, new_upgrade, 1)

    text = text.replace(
        "function operationPriority(operation) {\n  return Number(OPERATION_PRIORITY[operation.kind] || 35);\n}",
        "function operationPriority(operation) {\n  return Number(operation?.priority || OPERATION_PRIORITY[operation?.kind] || 35);\n}",
        1,
    )

    text = text.replace(
        """  return (await readAll(QUEUE_STORE)).sort((a, b) => {
    const byTime = Number(a.createdAt || 0) - Number(b.createdAt || 0);
    if (byTime) return byTime;
    return operationPriority(a) - operationPriority(b);
  });""",
        """  return (await readAll(QUEUE_STORE)).sort((a, b) => {
    const byPriority = operationPriority(a) - operationPriority(b);
    if (byPriority) return byPriority;
    return Number(a.createdAt || 0) - Number(b.createdAt || 0);
  });""",
        1,
    )

    text = text.replace(
        "export async function enqueueOperation({ routes, payload, description = '', entityId = '', dedupeKey = '', kind = '' }) {",
        "export async function enqueueOperation({ routes, payload, description = '', entityId = '', dedupeKey = '', kind = '', dependsOnLocalIds = [], priority = 0 }) {",
        1,
    )
    text = text.replace(
        """    kind: kind || existing?.kind || '',
    status: 'PENDING',""",
        """    kind: kind || existing?.kind || '',
    dependsOnLocalIds: [...new Set((dependsOnLocalIds || existing?.dependsOnLocalIds || []).map(String).filter(Boolean))],
    priority: Number(priority || existing?.priority || OPERATION_PRIORITY[kind] || 35),
    status: 'PENDING',""",
        1,
    )

    mapping_functions = """
export async function listOfflineIdMappings() {
  return readAll(ID_MAP_STORE);
}

export async function saveOfflineIdMapping(localId, serverId, entityType = '') {
  const local = String(localId || '').trim();
  const server = String(serverId || '').trim();
  if (!local || !server) return null;
  const mapping = {
    localId: local,
    serverId: server,
    entityType: String(entityType || ''),
    savedAt: Date.now(),
  };
  await run(ID_MAP_STORE, 'readwrite', (store) => store.put(mapping));
  emitQueueChange();
  return mapping;
}

export async function resolveOfflineOperationPayload(payload = {}, requiredLocalIds = []) {
  const entries = await listOfflineIdMappings();
  const mappings = new Map(entries.map((entry) => [String(entry.localId), String(entry.serverId)]));
  const dependencies = [...new Set((requiredLocalIds || []).map(String).filter(Boolean))];
  const unresolved = dependencies.filter((localId) => isOfflineLocalId(localId) && !mappings.has(localId));
  return {
    payload: replaceOfflineReferences(payload, mappings),
    unresolved,
    mappings: Object.fromEntries(mappings),
  };
}

"""
    marker = "export async function setOfflineMeta(key, value) {"
    if "export async function saveOfflineIdMapping" not in text:
        if marker not in text:
            raise SystemExit('No se encontró el punto para insertar el mapa de IDs')
        text = text.replace(marker, mapping_functions + marker, 1)

    text = text.replace(
        """  const [responses, operations, metadata] = await Promise.all([
    readAll(CACHE_STORE),
    readAll(QUEUE_STORE),
    readAll(META_STORE),
  ]);""",
        """  const [responses, operations, metadata, mappings] = await Promise.all([
    readAll(CACHE_STORE),
    readAll(QUEUE_STORE),
    readAll(META_STORE),
    readAll(ID_MAP_STORE),
  ]);""",
        1,
    )
    text = text.replace(
        """  const approximateIndexedDbBytes = approximateBytes(responses)
    + approximateBytes(operations)
    + approximateBytes(metadata);
  const pendingOperations = operations.filter((item) => String(item.status || 'PENDING').toUpperCase() !== 'SYNCED');""",
        """  const approximateIndexedDbBytes = approximateBytes(responses)
    + approximateBytes(operations)
    + approximateBytes(metadata)
    + approximateBytes(mappings);
  const pendingOperations = operations.filter((item) => String(item.status || 'PENDING').toUpperCase() !== 'SYNCED');
  const mappedIds = new Set(mappings.map((entry) => String(entry.localId || '')));
  const blockedOperations = pendingOperations.filter((item) => (item.dependsOnLocalIds || [])
    .some((localId) => isOfflineLocalId(localId) && !mappedIds.has(String(localId))));""",
        1,
    )
    text = text.replace(
        """    pendingCount: pendingOperations.length,
    errorCount: pendingOperations.filter((item) => String(item.status).toUpperCase() === 'ERROR').length,""",
        """    pendingCount: pendingOperations.length,
    blockedCount: blockedOperations.length,
    idMappingCount: mappings.length,
    errorCount: pendingOperations.filter((item) => String(item.status).toUpperCase() === 'ERROR').length,""",
        1,
    )
    text = text.replace(
        """      lastError: item.lastError || '',
    })),""",
        """      lastError: item.lastError || '',
      dependsOnLocalIds: item.dependsOnLocalIds || [],
      blocked: blockedOperations.some((blocked) => blocked.id === item.id),
    })),""",
        1,
    )

    path.write_text(text, encoding='utf-8')


def patch_store_wrapper():
    path = Path('src/services/offlineStore.js')
    text = path.read_text(encoding='utf-8')
    marker = "export async function setOfflineMeta(key, value) {"
    wrappers = """export async function listOfflineIdMappings() {
  const core = await loadCore();
  return core.listOfflineIdMappings();
}

export async function saveOfflineIdMapping(localId, serverId, entityType = '') {
  if (!isOfflineModeEnabled()) return null;
  const core = await loadCore();
  return core.saveOfflineIdMapping(localId, serverId, entityType);
}

export async function resolveOfflineOperationPayload(payload = {}, requiredLocalIds = []) {
  const core = await loadCore();
  return core.resolveOfflineOperationPayload(payload, requiredLocalIds);
}

"""
    if "export async function saveOfflineIdMapping" not in text:
        if marker not in text:
            raise SystemExit('No se encontró el punto para wrappers de IDs')
        text = text.replace(marker, wrappers + marker, 1)
    path.write_text(text, encoding='utf-8')


def patch_module_api():
    path = Path('src/services/moduleApi.js')
    text = path.read_text(encoding='utf-8')

    text = text.replace(
        """  readCachedResponse,
  responseCacheKey,
  updateCachedResponses,""",
        """  readCachedResponse,
  resolveOfflineOperationPayload,
  responseCacheKey,
  saveOfflineIdMapping,
  updateCachedResponses,""",
        1,
    )

    catalog_import = """import {
  catalogCreatedServerId,
  catalogDedupeKey,
  catalogEntityId,
  catalogIdKeys,
  catalogLocalRow,
  catalogOperationDescription,
  catalogOperationPriority,
  catalogRowMatchesRequest,
  collectOfflineDependencies,
  isOfflineCatalogCreateKind,
  isOfflineCatalogKind,
  offlineCatalogCacheRouteMatches,
  offlineCatalogWriteKind,
  prepareOfflineCatalogPayload,
} from './offlineCatalogDomain';
import { isOfflineModeEnabled } from './offlineMode';
"""
    request_import = "import { isNetworkError, throwIfAborted } from './requestErrors';\n"
    if "from './offlineCatalogDomain'" not in text:
        if request_import not in text:
            raise SystemExit('No se encontró import de requestErrors')
        text = text.replace(request_import, catalog_import + request_import, 1)

    text = text.replace(
        """  if (text.includes('maintenance.update') || text.includes('mantenimientos.update')) return 'maintenanceUpdate';
  return '';
}""",
        """  if (text.includes('maintenance.update') || text.includes('mantenimientos.update')) return 'maintenanceUpdate';
  return offlineCatalogWriteKind(routes);
}""",
        1,
    )

    text = text.replace(
        "function prepareWritePayload(kind, originalPayload = {}) {\n  const payload = { ...originalPayload };",
        "function prepareWritePayload(kind, originalPayload = {}) {\n  if (isOfflineCatalogKind(kind)) {\n    return isOfflineModeEnabled()\n      ? prepareOfflineCatalogPayload(kind, originalPayload)\n      : { ...originalPayload };\n  }\n  const payload = { ...originalPayload };",
        1,
    )

    text = text.replace(
        """function entityIdFor(kind, payload) {
  if (kind.startsWith('ticket')) return String(pick(payload, ['boletaUid', 'BoletaUID', 'id']));
  if (kind.startsWith('maintenance')) return String(pick(payload, ['maintenanceId', 'MantenimientoID', 'MantenimientoRef']));
  return '';
}""",
        """function entityIdFor(kind, payload) {
  if (isOfflineCatalogKind(kind)) return catalogEntityId(kind, payload);
  if (kind.startsWith('ticket')) return String(pick(payload, ['boletaUid', 'BoletaUID', 'id']));
  if (kind.startsWith('maintenance')) return String(pick(payload, ['maintenanceId', 'MantenimientoID', 'MantenimientoRef']));
  return '';
}""",
        1,
    )

    text = text.replace(
        "return labels[kind] || 'Sincronizar cambio';",
        "return labels[kind] || catalogOperationDescription(kind) || 'Sincronizar cambio';",
        1,
    )

    text = text.replace(
        "function dedupeKeyFor(kind, payload) {\n  const entityId = entityIdFor(kind, payload);",
        "function dedupeKeyFor(kind, payload) {\n  if (isOfflineCatalogKind(kind)) return catalogDedupeKey(kind, payload);\n  const entityId = entityIdFor(kind, payload);",
        1,
    )

    catalog_patch = """
async function patchOfflineCatalogCache(kind, payload, result) {
  const localId = String(payload?.__offlineLocalId || catalogEntityId(kind, payload) || '');
  const row = catalogLocalRow(kind, payload, result);
  const keys = catalogIdKeys(kind);
  const finalId = String(pick(row, keys));

  await updateCachedResponses(
    (entry) => offlineCatalogCacheRouteMatches(kind, cacheRoute(entry)),
    (data, entry) => {
      const request = cachePayload(entry);
      let items = normalizeItems(data);
      const containedLocal = Boolean(localId && items.some((item) => String(pick(item, keys)) === localId));
      if (localId && finalId && localId !== finalId) items = removeBy(items, localId, keys);
      if (containedLocal || catalogRowMatchesRequest(kind, row, request)) {
        items = upsertBy(items, row, keys);
      }
      return rebuildCollection(data, items);
    },
  );
}

async function registerOfflineCatalogMapping(kind, originalPayload, result) {
  if (!isOfflineCatalogCreateKind(kind)) return '';
  const localId = catalogEntityId(kind, originalPayload);
  const serverId = catalogCreatedServerId(kind, result);
  if (localId && serverId && localId !== serverId) {
    await saveOfflineIdMapping(localId, serverId, kind).catch(() => {});
  }
  return localId;
}

"""
    marker = "async function applyOperationToCache(kind, payload, result, sessionToken) {"
    if "async function patchOfflineCatalogCache" not in text:
        if marker not in text:
            raise SystemExit('No se encontró applyOperationToCache')
        text = text.replace(marker, catalog_patch + marker, 1)

    text = text.replace(
        """async function applyOperationToCache(kind, payload, result, sessionToken) {
  if (kind.startsWith('ticket')) return patchTicketCache(kind, payload, result, sessionToken);
  if (kind.startsWith('maintenance')) return patchMaintenanceCache(kind, payload, result, sessionToken);
  return undefined;
}""",
        """async function applyOperationToCache(kind, payload, result, sessionToken) {
  if (isOfflineCatalogKind(kind)) return patchOfflineCatalogCache(kind, payload, result);
  if (kind.startsWith('ticket')) return patchTicketCache(kind, payload, result, sessionToken);
  if (kind.startsWith('maintenance')) return patchMaintenanceCache(kind, payload, result, sessionToken);
  return undefined;
}""",
        1,
    )

    text = text.replace(
        """  if (kind.startsWith('maintenance')) {
    const maintenanceId = pick(payload, ['maintenanceId', 'MantenimientoID']);""",
        """  if (isOfflineCatalogKind(kind)) return catalogLocalRow(kind, payload);
  if (kind.startsWith('maintenance')) {
    const maintenanceId = pick(payload, ['maintenanceId', 'MantenimientoID']);""",
        1,
    )

    text = text.replace(
        """  const operation = await enqueueOperation({
    routes,
    payload,
    entityId,
    description: offlineDescription(kind),
    dedupeKey: dedupeKeyFor(kind, payload),
    kind,
  });""",
        """  const operation = await enqueueOperation({
    routes,
    payload,
    entityId,
    description: offlineDescription(kind),
    dedupeKey: dedupeKeyFor(kind, payload),
    kind,
    dependsOnLocalIds: collectOfflineDependencies(kind, payload),
    priority: isOfflineCatalogKind(kind) ? catalogOperationPriority(kind) : 0,
  });""",
        1,
    )

    old_replay = """export async function replayQueuedOperation(operation, sessionToken = '') {
  const payload = operation.payload || {};
  const result = await requestFirstAvailable(
    operation.routes || [],
    (route) => apiRequest(route, payload, sessionToken),
  );
  await applyOperationToCache(operation.kind || offlineWriteKind(operation.routes), payload, result, sessionToken).catch(() => {});
  return result;
}"""
    new_replay = """export async function replayQueuedOperation(operation, sessionToken = '') {
  const kind = operation.kind || offlineWriteKind(operation.routes);
  const originalPayload = operation.payload || {};
  const dependencies = operation.dependsOnLocalIds?.length
    ? operation.dependsOnLocalIds
    : collectOfflineDependencies(kind, originalPayload);
  const resolved = await resolveOfflineOperationPayload(originalPayload, dependencies);
  if (resolved.unresolved.length) {
    const error = new Error(`La operación espera ${resolved.unresolved.length} registro${resolved.unresolved.length === 1 ? '' : 's'} relacionado${resolved.unresolved.length === 1 ? '' : 's'} antes de sincronizar.`);
    error.code = 'OFFLINE_DEPENDENCY_PENDING';
    error.details = { unresolvedLocalIds: resolved.unresolved };
    throw error;
  }

  const payload = resolved.payload;
  const result = await requestFirstAvailable(
    operation.routes || [],
    (route) => apiRequest(route, payload, sessionToken),
  );
  const localId = await registerOfflineCatalogMapping(kind, originalPayload, result);
  await applyOperationToCache(
    kind,
    localId ? { ...payload, __offlineLocalId: localId } : payload,
    result,
    sessionToken,
  ).catch(() => {});
  return result;
}"""
    if old_replay not in text:
        raise SystemExit('No se encontró replayQueuedOperation')
    text = text.replace(old_replay, new_replay, 1)

    text = text.replace(
        """    if (read) await cacheResponse(cacheKey, result).catch(() => {});
    if (writeKind) await applyOperationToCache(writeKind, preparedPayload, result, sessionToken).catch(() => {});""",
        """    if (read) await cacheResponse(cacheKey, result).catch(() => {});
    const localId = writeKind
      ? await registerOfflineCatalogMapping(writeKind, preparedPayload, result)
      : '';
    if (writeKind) await applyOperationToCache(
      writeKind,
      localId ? { ...preparedPayload, __offlineLocalId: localId } : preparedPayload,
      result,
      sessionToken,
    ).catch(() => {});""",
        1,
    )

    path.write_text(text, encoding='utf-8')


def patch_sync_manager():
    path = Path('src/components/offline/OfflineSyncManager.jsx')
    text = path.read_text(encoding='utf-8')
    text = text.replace(
        """      let synchronized = 0;
      for (const operation of operations) {""",
        """      let synchronized = 0;
      let blocked = 0;
      for (const operation of operations) {""",
        1,
    )
    marker = """        } catch (error) {
          await updateQueuedOperation(operation.id, {
            status: 'ERROR',"""
    replacement = """        } catch (error) {
          if (String(error?.code || '').toUpperCase() === 'OFFLINE_DEPENDENCY_PENDING') {
            blocked += 1;
            await updateQueuedOperation(operation.id, {
              status: 'PENDING',
              lastError: String(error?.message || error),
            });
            continue;
          }
          await updateQueuedOperation(operation.id, {
            status: 'ERROR',"""
    if "OFFLINE_DEPENDENCY_PENDING" not in text:
        if marker not in text:
            raise SystemExit('No se encontró catch de sincronización')
        text = text.replace(marker, replacement, 1)

    before_preload = """      await preloadOfflineCatalogs(sessionToken).catch(() => {});
      setMessage('Todos los cambios fueron sincronizados correctamente.');"""
    after_preload = """      if (blocked > 0) {
        setMessage(`${blocked} cambio${blocked === 1 ? '' : 's'} espera${blocked === 1 ? '' : 'n'} que se sincronicen sus catálogos relacionados.`);
        window.dispatchEvent(new CustomEvent('dms-offline-sync-complete', {
          detail: { forced, synchronized, blocked, refreshMode: 'dependency-aware' },
        }));
        if (synchronized > 0) scheduleSync(1_500);
        return;
      }

      await preloadOfflineCatalogs(sessionToken).catch(() => {});
      setMessage('Todos los cambios fueron sincronizados correctamente.');"""
    if "refreshMode: 'dependency-aware'" not in text:
        if before_preload not in text:
            raise SystemExit('No se encontró cierre de sincronización')
        text = text.replace(before_preload, after_preload, 1)

    path.write_text(text, encoding='utf-8')


def main():
    patch_domain()
    patch_store_core()
    patch_store_wrapper()
    patch_module_api()
    patch_sync_manager()


if __name__ == '__main__':
    main()
