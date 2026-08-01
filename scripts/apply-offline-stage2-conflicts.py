from pathlib import Path


def replace_once(path, old, new, label):
    file_path = Path(path)
    text = file_path.read_text(encoding='utf-8')
    if new in text:
        return
    if old not in text:
        raise SystemExit(f'No se encontró el marcador para {label} en {path}')
    file_path.write_text(text.replace(old, new, 1), encoding='utf-8')


# Corregir las definiciones alias antes de que el módulo se evalúe.
replace_once(
    'src/services/offlineConflictDomain.js',
    'const DEFINITIONS = Object.freeze({',
    'const DEFINITIONS = {',
    'definiciones editables de conflicto',
)
replace_once(
    'src/services/offlineConflictDomain.js',
    '\n});\n\nDEFINITIONS.maintenanceDeviceAutosave',
    '\n};\n\nDEFINITIONS.maintenanceDeviceAutosave',
    'cierre de definiciones de conflicto',
)

# El backend valida la precondición antes de entregar el payload al handler.
replace_once(
    'backend/src/core/action-router.js',
    "import { propagateEquipmentLocationName } from '../services/equipment-location-propagation.service.js';",
    "import { propagateEquipmentLocationName } from '../services/equipment-location-propagation.service.js';\nimport {\n  assertOfflineWritePrecondition,\n  stripOfflineConflictMetadata,\n} from '../services/offline-conflict.service.js';",
    'importación de guarda offline',
)
replace_once(
    'backend/src/core/action-router.js',
    "  const normalizedPayload = normalizeTicketHoursPayload(route, payload);\n  return entry.handler({route,payload:normalizedPayload,sessionToken,ip,userAgent,origin,...auth});",
    "  const normalizedPayload = normalizeTicketHoursPayload(route, payload);\n  await assertOfflineWritePrecondition(route, normalizedPayload);\n  const handlerPayload = stripOfflineConflictMetadata(normalizedPayload);\n  return entry.handler({route,payload:handlerPayload,sessionToken,ip,userAgent,origin,...auth});",
    'validación previa al handler',
)

# La cola conserva la fotografía de la versión original y el estado de resolución.
replace_once(
    'src/services/offlineStoreCore.js',
    "export async function enqueueOperation({ routes, payload, description = '', entityId = '', dedupeKey = '', kind = '', dependsOnLocalIds = [], priority = 0 }) {",
    "export async function enqueueOperation({ routes, payload, description = '', entityId = '', dedupeKey = '', kind = '', dependsOnLocalIds = [], priority = 0, conflict = null }) {",
    'firma de enqueueOperation',
)
replace_once(
    'src/services/offlineStoreCore.js',
    "    priority: Number(priority || existing?.priority || OPERATION_PRIORITY[kind] || 35),\n    status: 'PENDING',\n    attempts: existing?.attempts || 0,\n    lastError: '',",
    "    priority: Number(priority || existing?.priority || OPERATION_PRIORITY[kind] || 35),\n    conflict: conflict || existing?.conflict || null,\n    conflictDetails: existing?.conflictDetails || null,\n    conflictResolution: existing?.conflictResolution || '',\n    status: 'PENDING',\n    attempts: existing?.attempts || 0,\n    lastError: '',",
    'metadatos persistentes de conflicto',
)
replace_once(
    'src/services/offlineStoreCore.js',
    "  if (!id) return { entityId: '', pending: 0, errors: 0, syncing: 0, operations: [], readyToFinalize: true };",
    "  if (!id) return { entityId: '', pending: 0, errors: 0, syncing: 0, conflicts: 0, operations: [], readyToFinalize: true };",
    'estado vacío de entidad',
)
replace_once(
    'src/services/offlineStoreCore.js',
    "    syncing: operations.filter((item) => String(item.status).toUpperCase() === 'SYNCING').length,\n    operations,",
    "    syncing: operations.filter((item) => String(item.status).toUpperCase() === 'SYNCING').length,\n    conflicts: operations.filter((item) => String(item.status).toUpperCase() === 'CONFLICT').length,\n    operations,",
    'conteo de conflictos de entidad',
)
replace_once(
    'src/services/offlineStore.js',
    "      syncing: 0,\n      operations: [],",
    "      syncing: 0,\n      conflicts: 0,\n      operations: [],",
    'estado público de conflictos',
)

# moduleApi captura el estado base antes de alterar la caché local.
replace_once(
    'src/services/moduleApi.js',
    "import { isOfflineModeEnabled } from './offlineMode';",
    "import { isOfflineModeEnabled } from './offlineMode';\nimport {\n  buildOfflineConflictMetadata,\n  offlineConflictDefinition,\n  offlineConflictEntityId,\n} from './offlineConflictDomain';",
    'importación de dominio de conflictos',
)

module_helpers = r'''
function conflictCatalogRoutes(kind) {
  const routes = {
    clientLocationUpdate: MODULE_ROUTES.clients.locationsList,
    equipmentLocationUpdate: MODULE_ROUTES.clients.equipmentLocationsList,
    deviceTypeUpdate: MODULE_ROUTES.deviceTypes.list,
    manufacturerUpdate: MODULE_ROUTES.manufacturers.list,
    modelUpdate: MODULE_ROUTES.models.list,
    deviceManufacturerUpdate: MODULE_ROUTES.deviceManufacturers.list,
  };
  return routes[kind] || null;
}

function findConflictRecord(items, kind, entityId) {
  return (items || []).find((row) => offlineConflictEntityId(kind, row) === String(entityId || '')) || null;
}

async function cachedConflictBase(kind, payload, sessionToken) {
  const definition = offlineConflictDefinition(kind);
  const entityId = offlineConflictEntityId(kind, payload);
  if (!definition || !entityId) return null;

  if (kind === 'maintenanceUpdate') {
    const key = responseCacheKey(MODULE_ROUTES.maintenance.get, { maintenanceId: entityId }, sessionToken);
    return (await readCachedResponse(key, 0))?.mantenimiento || null;
  }

  if (kind === 'maintenanceDeviceUpdate' || kind === 'maintenanceDeviceAutosave') {
    const maintenanceId = String(pick(payload, ['maintenanceId', 'MantenimientoID', 'MantenimientoRef']));
    if (!maintenanceId) return null;
    const key = responseCacheKey(MODULE_ROUTES.maintenance.get, { maintenanceId }, sessionToken);
    const cached = await readCachedResponse(key, 0);
    return findConflictRecord(cached?.dispositivos || [], kind, entityId);
  }

  if (kind === 'ticketUpdate' || kind === 'ticketAutosave') {
    const key = responseCacheKey(MODULE_ROUTES.tickets.get, { boletaUid: entityId }, sessionToken);
    return (await readCachedResponse(key, 0))?.boleta || null;
  }

  const routes = conflictCatalogRoutes(kind);
  if (!routes) return null;
  const cached = await readCachedResponse(responseCacheKey(routes, OFFLINE_CATALOG_PAYLOAD, sessionToken), 0);
  return findConflictRecord(normalizeItems(cached), kind, entityId);
}

async function captureOfflineConflict(kind, payload, sessionToken) {
  const base = await cachedConflictBase(kind, payload, sessionToken).catch(() => null);
  return buildOfflineConflictMetadata(kind, payload, base);
}
'''.strip()
replace_once(
    'src/services/moduleApi.js',
    "async function queueOfflineWrite(routes, payload, kind, sessionToken) {",
    module_helpers + "\n\nasync function queueOfflineWrite(routes, payload, kind, sessionToken) {",
    'captura del estado base',
)
replace_once(
    'src/services/moduleApi.js',
    "  const entityId = entityIdFor(kind, payload);\n  const operation = await enqueueOperation({",
    "  const entityId = entityIdFor(kind, payload);\n  const conflict = await captureOfflineConflict(kind, payload, sessionToken);\n  const operation = await enqueueOperation({",
    'precondición antes de encolar',
)
replace_once(
    'src/services/moduleApi.js',
    "    priority: isOfflineCatalogKind(kind) ? catalogOperationPriority(kind) : 0,\n  });",
    "    priority: isOfflineCatalogKind(kind) ? catalogOperationPriority(kind) : 0,\n    conflict,\n  });",
    'persistencia de precondición',
)
replace_once(
    'src/services/moduleApi.js',
    "  const payload = resolved.payload;\n  const result = await requestFirstAvailable(\n    operation.routes || [],\n    (route) => apiRequest(route, payload, sessionToken),\n  );",
    "  const payload = resolved.payload;\n  const conflict = operation.conflict\n    ? {\n      ...operation.conflict,\n      strategy: operation.conflictResolution || operation.conflict.strategy || 'REVIEW',\n    }\n    : null;\n  const requestPayload = conflict ? { ...payload, __offlineConflict: conflict } : payload;\n  const result = await requestFirstAvailable(\n    operation.routes || [],\n    (route) => apiRequest(route, requestPayload, sessionToken),\n  );",
    'envío de precondición al backend',
)

refresh_helper = r'''
export async function refreshConflictServerVersion(operation, sessionToken = '') {
  const kind = operation?.kind || offlineWriteKind(operation?.routes);
  const payload = operation?.payload || {};

  if (kind === 'maintenanceUpdate' || kind === 'maintenanceDeviceUpdate' || kind === 'maintenanceDeviceAutosave') {
    const maintenanceId = String(pick(payload, ['maintenanceId', 'MantenimientoID', 'MantenimientoRef']));
    if (!maintenanceId) return null;
    return requestAvailable(MODULE_ROUTES.maintenance.get, { maintenanceId }, sessionToken);
  }

  if (kind === 'ticketUpdate' || kind === 'ticketAutosave') {
    const boletaUid = String(pick(payload, ['boletaUid', 'BoletaUID', 'id']));
    if (!boletaUid) return null;
    return requestAvailable(MODULE_ROUTES.tickets.get, { boletaUid }, sessionToken);
  }

  const routes = conflictCatalogRoutes(kind);
  return routes ? requestAvailable(routes, OFFLINE_CATALOG_PAYLOAD, sessionToken) : null;
}
'''.strip()
replace_once(
    'src/services/moduleApi.js',
    "export async function requestAvailable(routes, payload = {}, sessionToken = '', options = {}) {",
    refresh_helper + "\n\nexport async function requestAvailable(routes, payload = {}, sessionToken = '', options = {}) {",
    'actualización desde servidor tras descartar conflicto',
)

# El gestor distingue conflictos de errores temporales y ofrece resolución explícita.
replace_once(
    'src/components/offline/OfflineSyncManager.jsx',
    "  preloadOfflineCatalogs,\n  replayQueuedOperation,",
    "  preloadOfflineCatalogs,\n  refreshConflictServerVersion,\n  replayQueuedOperation,",
    'refresco de versión del servidor',
)
replace_once(
    'src/components/offline/OfflineSyncManager.jsx',
    "} from '../../services/moduleApi';",
    "} from '../../services/moduleApi';\nimport {\n  isOfflineConflictError,\n  offlineConflictMessage,\n} from '../../services/offlineConflictDomain';",
    'importación visual de conflicto',
)
replace_once(
    'src/components/offline/OfflineSyncManager.jsx',
    "  const [entityPending, setEntityPending] = useState(0);\n  const [syncing, setSyncing] = useState(false);",
    "  const [entityPending, setEntityPending] = useState(0);\n  const [conflicts, setConflicts] = useState([]);\n  const [syncing, setSyncing] = useState(false);",
    'estado de conflictos',
)
replace_once(
    'src/components/offline/OfflineSyncManager.jsx',
    "  const refreshCount = useCallback(async () => {\n    const count = await queuedOperationCount().catch(() => 0);\n    setPending(count);\n    return count;\n  }, []);",
    "  const refreshCount = useCallback(async () => {\n    const operations = await listQueuedOperations().catch(() => []);\n    const count = operations.length;\n    setPending(count);\n    setConflicts(operations.filter((operation) => String(operation.status || '').toUpperCase() === 'CONFLICT'));\n    return count;\n  }, []);",
    'refresco de conflictos',
)
replace_once(
    'src/components/offline/OfflineSyncManager.jsx',
    "      let synchronized = 0;\n      let blocked = 0;\n      for (const operation of operations) {",
    "      let synchronized = 0;\n      let blocked = 0;\n      let conflictCount = 0;\n      for (const operation of operations) {\n        if (String(operation.status || '').toUpperCase() === 'CONFLICT') {\n          conflictCount += 1;\n          continue;\n        }",
    'salto de operaciones en conflicto',
)
replace_once(
    'src/components/offline/OfflineSyncManager.jsx',
    "        } catch (error) {\n          if (String(error?.code || '').toUpperCase() === 'OFFLINE_DEPENDENCY_PENDING') {",
    "        } catch (error) {\n          if (isOfflineConflictError(error)) {\n            const conflictDetails = error?.details || {};\n            await updateQueuedOperation(operation.id, {\n              status: 'CONFLICT',\n              lastError: String(error?.message || error),\n              conflictDetails,\n              conflictResolution: '',\n            });\n            await Promise.all([refreshCount(), refreshEntityState()]);\n            const nextMessage = offlineConflictMessage(conflictDetails);\n            setMessage(nextMessage);\n            window.dispatchEvent(new CustomEvent('dms-offline-sync-conflict', {\n              detail: { message: nextMessage, operationId: operation.id, conflictDetails },\n            }));\n            return;\n          }\n          if (String(error?.code || '').toUpperCase() === 'OFFLINE_DEPENDENCY_PENDING') {",
    'captura de conflictos 409',
)
replace_once(
    'src/components/offline/OfflineSyncManager.jsx',
    "      if (blocked > 0) {",
    "      if (conflictCount > 0) {\n        setMessage(`${conflictCount} cambio${conflictCount === 1 ? '' : 's'} requiere${conflictCount === 1 ? '' : 'n'} revisión antes de sincronizar.`);\n        window.dispatchEvent(new CustomEvent('dms-offline-sync-complete', {\n          detail: { forced, synchronized, conflicts: conflictCount, refreshMode: 'conflict-aware' },\n        }));\n        return;\n      }\n\n      if (blocked > 0) {",
    'mensaje de conflictos existentes',
)

resolution_callbacks = r'''
  const keepLocalConflict = useCallback(async (operation) => {
    if (!operation?.id) return;
    await updateQueuedOperation(operation.id, {
      status: 'PENDING',
      conflictResolution: 'KEEP_LOCAL',
      conflictDetails: operation.conflictDetails || null,
      lastError: '',
    });
    setMessage('Se conservarán los cambios de este dispositivo. Sincronizando nuevamente...');
    await refreshCount();
    synchronize({ forced: true });
  }, [refreshCount, synchronize]);

  const useServerConflict = useCallback(async (operation) => {
    if (!operation?.id) return;
    await removeQueuedOperation(operation.id);
    await refreshConflictServerVersion(operation, sessionToken).catch(() => null);
    await Promise.all([refreshCount(), refreshEntityState()]);
    setMessage('Se descartó el cambio local en conflicto y se recuperó la versión del servidor.');
    window.dispatchEvent(new CustomEvent('dms-offline-conflict-resolved', {
      detail: { operationId: operation.id, strategy: 'USE_SERVER' },
    }));
    window.setTimeout(() => setMessage(''), 5000);
  }, [sessionToken, refreshCount, refreshEntityState]);
'''.strip()
replace_once(
    'src/components/offline/OfflineSyncManager.jsx',
    "  const finalizationBlocked = navigator.onLine === false",
    resolution_callbacks + "\n\n  const finalizationBlocked = navigator.onLine === false",
    'acciones de resolución',
)
replace_once(
    'src/components/offline/OfflineSyncManager.jsx',
    "  if (online && !pending && !syncing && !message) return null;\n\n  const pendingText = autoPaused && pending",
    "  if (online && !pending && !syncing && !message) return null;\n\n  const activeConflict = conflicts[0] || null;\n  const pendingText = activeConflict\n    ? offlineConflictMessage(activeConflict.conflictDetails || {})\n    : autoPaused && pending",
    'texto de conflicto activo',
)
replace_once(
    'src/components/offline/OfflineSyncManager.jsx',
    "    <aside className={`offline-status${online ? ' is-online' : ' is-offline'}${syncing ? ' is-syncing' : ''}`} role=\"status\" aria-live=\"polite\">",
    "    <aside className={`offline-status${online ? ' is-online' : ' is-offline'}${syncing ? ' is-syncing' : ''}${activeConflict ? ' is-conflict' : ''}`} role=\"status\" aria-live=\"polite\">",
    'clase visual de conflicto',
)
replace_once(
    'src/components/offline/OfflineSyncManager.jsx',
    "        <Icon name={syncing ? 'sync' : autoPaused ? 'edit_note' : online ? 'cloud_done' : 'cloud_off'} />",
    "        <Icon name={activeConflict ? 'warning' : syncing ? 'sync' : autoPaused ? 'edit_note' : online ? 'cloud_done' : 'cloud_off'} />",
    'icono de conflicto',
)
replace_once(
    'src/components/offline/OfflineSyncManager.jsx',
    "        <strong>{syncing ? 'Sincronizando' : autoPaused && pending ? 'Sincronización en pausa' : online ? 'Conexión disponible' : 'Trabajando sin conexión'}</strong>",
    "        <strong>{activeConflict ? 'Conflicto de sincronización' : syncing ? 'Sincronizando' : autoPaused && pending ? 'Sincronización en pausa' : online ? 'Conexión disponible' : 'Trabajando sin conexión'}</strong>",
    'título de conflicto',
)
replace_once(
    'src/components/offline/OfflineSyncManager.jsx',
    "      {online && pending > 0 && !syncing && (\n        <button type=\"button\" onClick={() => synchronize({ forced: true })}>Sincronizar ahora</button>\n      )}",
    "      {activeConflict && !syncing ? (\n        <div className=\"offline-status__actions\">\n          <button type=\"button\" onClick={() => keepLocalConflict(activeConflict)}>Conservar mis cambios</button>\n          <button type=\"button\" onClick={() => useServerConflict(activeConflict)}>Usar versión del servidor</button>\n        </div>\n      ) : online && pending > 0 && !syncing ? (\n        <button type=\"button\" onClick={() => synchronize({ forced: true })}>Sincronizar ahora</button>\n      ) : null}",
    'botones de resolución',
)

# Estilos responsive para el estado de conflicto.
css_append = r'''

.offline-status.is-conflict {
  border-color: #e59a95;
  background: rgba(255,247,246,.99);
}

.offline-status.is-conflict .offline-status__icon {
  background: #fde4e2;
  color: #a1241b;
}

.offline-status__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.offline-status__actions button {
  min-height: 36px;
  padding: 7px 10px;
  border: 1px solid #a1241b;
  border-radius: 9px;
  background: #ffffff;
  color: #a1241b;
  font: inherit;
  font-size: .7rem;
  font-weight: 750;
  cursor: pointer;
}

.offline-status__actions button:first-child {
  background: #a1241b;
  color: #ffffff;
}

@media (max-width: 620px) {
  .offline-status__actions {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: 1fr;
    width: 100%;
  }

  .offline-status__actions button {
    width: 100%;
  }
}
'''
css_path = Path('src/styles/offline.css')
css_text = css_path.read_text(encoding='utf-8')
if '.offline-status.is-conflict' not in css_text:
    css_path.write_text(css_text.rstrip() + css_append + '\n', encoding='utf-8')

# Registrar la nueva caracterización.
replace_once(
    'tests/characterization/all.test.mjs',
    "import './offline-mode.test.mjs';",
    "import './offline-mode.test.mjs';\nimport './offline-conflict-resolution.test.mjs';",
    'importación de pruebas de conflicto',
)
