from pathlib import Path


def replace_once(text, old, new, label):
    if old in text:
        return text.replace(old, new, 1)
    if new in text:
        return text
    raise SystemExit(f'No se encontró el bloque para {label}')


module_path = Path('src/services/moduleApi.js')
module = module_path.read_text(encoding='utf-8')

module = replace_once(
    module,
    "} from './offlineStore';\nimport { isNetworkError, throwIfAborted } from './requestErrors';",
    "} from './offlineStore';\nimport {\n  resolveOfflineReferences,\n  saveOfflineIdMapping,\n} from './offlineReferenceMap';\nimport { isNetworkError, throwIfAborted } from './requestErrors';",
    'importar el mapa de IDs offline',
)

module = replace_once(
    module,
    "  if (text.includes('maintenance.update') || text.includes('mantenimientos.update')) return 'maintenanceUpdate';\n  return '';",
    "  if (text.includes('maintenance.update') || text.includes('mantenimientos.update')) return 'maintenanceUpdate';\n\n  if (text.includes('clientlocations.create') || text.includes('clients.locations.create') || text.includes('ubicacionescliente.create')) return 'catalogLocationCreate';\n  if (text.includes('equipmentlocations.create') || text.includes('clients.equipmentlocations.create') || text.includes('ubicacionesequipo.create')) return 'catalogEquipmentLocationCreate';\n  if (text.includes('catalog.manufacturers.create') || text.includes('manufacturers.create') || text.includes('fabricantes.create')) return 'catalogManufacturerCreate';\n  if (text.includes('catalog.models.create') || text.includes('models.create') || text.includes('modelos.create')) return 'catalogModelCreate';\n  if (text.includes('catalog.devicemanufacturers.create') || text.includes('devicemanufacturers.create') || text.includes('tipodispositivofabricantes.create')) return 'catalogDeviceManufacturerCreate';\n  return '';",
    'detectar escrituras offline de catálogos',
)

module = replace_once(
    module,
    "  if (kind === 'maintenanceImage' && !pick(payload, ['imageId', 'FotoDispositivoID'])) {\n    const id = createOfflineId('foto');\n    payload.imageId = id;\n    payload.FotoDispositivoID = id;\n  }\n  return payload;",
    "  if (kind === 'maintenanceImage' && !pick(payload, ['imageId', 'FotoDispositivoID'])) {\n    const id = createOfflineId('foto');\n    payload.imageId = id;\n    payload.FotoDispositivoID = id;\n  }\n  if (kind === 'catalogLocationCreate' && !pick(payload, ['locationId', 'ubicacionId', 'UbicacionID', 'RowID'])) {\n    const id = createOfflineId('ubicacion');\n    payload.locationId = id;\n    payload.ubicacionId = id;\n    payload.UbicacionID = id;\n    payload.RowID = id;\n  }\n  if (kind === 'catalogEquipmentLocationCreate' && !pick(payload, ['equipmentLocationId', 'ubicacionEquipoId', 'UbicacionEquipoID', 'RowID'])) {\n    const id = createOfflineId('ubicacion-equipo');\n    payload.equipmentLocationId = id;\n    payload.ubicacionEquipoId = id;\n    payload.UbicacionEquipoID = id;\n    payload.RowID = id;\n  }\n  if (kind === 'catalogManufacturerCreate' && !pick(payload, ['manufacturerId', 'fabricanteId', 'FabricanteID', 'RowID'])) {\n    const id = createOfflineId('fabricante');\n    payload.manufacturerId = id;\n    payload.fabricanteId = id;\n    payload.FabricanteID = id;\n    payload.RowID = id;\n  }\n  if (kind === 'catalogModelCreate' && !pick(payload, ['modelId', 'modeloId', 'ModeloID', 'RowID'])) {\n    const id = createOfflineId('modelo');\n    payload.modelId = id;\n    payload.modeloId = id;\n    payload.ModeloID = id;\n    payload.RowID = id;\n  }\n  if (kind === 'catalogDeviceManufacturerCreate' && !pick(payload, ['relationId', 'TipoDispositivoFabricanteID', 'RowID'])) {\n    const id = createOfflineId('relacion-fabricante');\n    payload.relationId = id;\n    payload.TipoDispositivoFabricanteID = id;\n    payload.RowID = id;\n  }\n  return payload;",
    'crear IDs locales para catálogos',
)

module = replace_once(
    module,
    "  if (kind.startsWith('maintenance')) return String(pick(payload, ['maintenanceId', 'MantenimientoID', 'MantenimientoRef']));\n  return '';",
    "  if (kind.startsWith('maintenance')) return String(pick(payload, ['maintenanceId', 'MantenimientoID', 'MantenimientoRef']));\n  if (kind.startsWith('catalog')) return `catalog:${kind}`;\n  return '';",
    'identificar entidades de catálogo',
)

module = replace_once(
    module,
    "    maintenanceImageDelete: 'Eliminar evidencia del mantenimiento',\n  };",
    "    maintenanceImageDelete: 'Eliminar evidencia del mantenimiento',\n    catalogLocationCreate: 'Crear ubicación del cliente',\n    catalogEquipmentLocationCreate: 'Crear ubicación del dispositivo',\n    catalogManufacturerCreate: 'Crear fabricante',\n    catalogModelCreate: 'Crear modelo',\n    catalogDeviceManufacturerCreate: 'Relacionar fabricante y tipo de dispositivo',\n  };",
    'describir operaciones de catálogo',
)

module = replace_once(
    module,
    "  if (['maintenanceImage', 'maintenanceImageUpdate', 'maintenanceImageDelete'].includes(kind)) {\n    return `${kind}:${pick(payload, ['imageId', 'FotoDispositivoID'])}`;\n  }\n  return '';",
    "  if (['maintenanceImage', 'maintenanceImageUpdate', 'maintenanceImageDelete'].includes(kind)) {\n    return `${kind}:${pick(payload, ['imageId', 'FotoDispositivoID'])}`;\n  }\n  if (kind === 'catalogLocationCreate') return `${kind}:${pick(payload, ['locationId', 'ubicacionId', 'UbicacionID', 'RowID'])}`;\n  if (kind === 'catalogEquipmentLocationCreate') return `${kind}:${pick(payload, ['equipmentLocationId', 'ubicacionEquipoId', 'UbicacionEquipoID', 'RowID'])}`;\n  if (kind === 'catalogManufacturerCreate') return `${kind}:${pick(payload, ['manufacturerId', 'fabricanteId', 'FabricanteID', 'RowID'])}`;\n  if (kind === 'catalogModelCreate') return `${kind}:${pick(payload, ['modelId', 'modeloId', 'ModeloID', 'RowID'])}`;\n  if (kind === 'catalogDeviceManufacturerCreate') return `${kind}:${pick(payload, ['relationId', 'TipoDispositivoFabricanteID', 'RowID'])}`;\n  return '';",
    'deduplicar operaciones de catálogo',
)

helpers = r'''
const OFFLINE_CATALOG_DEFINITIONS = Object.freeze({
  catalogLocationCreate: {
    listRoutes: MODULE_ROUTES.clients.locationsList,
    idKeys: ['UbicacionID', 'locationId', 'ubicacionId', 'RowID', 'id'],
    localIdKeys: ['locationId', 'ubicacionId', 'UbicacionID', 'RowID'],
  },
  catalogEquipmentLocationCreate: {
    listRoutes: MODULE_ROUTES.clients.equipmentLocationsList,
    idKeys: ['UbicacionEquipoID', 'equipmentLocationId', 'ubicacionEquipoId', 'RowID', 'id'],
    localIdKeys: ['equipmentLocationId', 'ubicacionEquipoId', 'UbicacionEquipoID', 'RowID'],
  },
  catalogManufacturerCreate: {
    listRoutes: MODULE_ROUTES.manufacturers.list,
    idKeys: ['FabricanteID', 'manufacturerId', 'fabricanteId', 'RowID', 'id'],
    localIdKeys: ['manufacturerId', 'fabricanteId', 'FabricanteID', 'RowID'],
  },
  catalogModelCreate: {
    listRoutes: MODULE_ROUTES.models.list,
    idKeys: ['ModeloID', 'modelId', 'modeloId', 'RowID', 'id'],
    localIdKeys: ['modelId', 'modeloId', 'ModeloID', 'RowID'],
  },
  catalogDeviceManufacturerCreate: {
    listRoutes: MODULE_ROUTES.deviceManufacturers.list,
    idKeys: ['TipoDispositivoFabricanteID', 'relationId', 'RowID', 'id'],
    localIdKeys: ['relationId', 'TipoDispositivoFabricanteID', 'RowID'],
  },
});

function catalogDefinition(kind) {
  return OFFLINE_CATALOG_DEFINITIONS[kind] || null;
}

function catalogResultSource(result = {}) {
  return result?.item
    || result?.row
    || result?.ubicacion
    || result?.ubicacionEquipo
    || result?.fabricante
    || result?.modelo
    || result?.relacion
    || result?.data
    || result
    || {};
}

function localCatalogRow(kind, payload, result = null) {
  const definition = catalogDefinition(kind);
  if (!definition) return null;
  const server = result ? catalogResultSource(result) : {};
  const localId = String(pick(payload, definition.localIdKeys));
  const id = String(pick(server, definition.idKeys, localId));
  const base = {
    ...payload,
    ...server,
    RowID: pick(server, ['RowID'], id),
    Nombre: pick(server, ['Nombre', 'name'], pick(payload, ['nombre', 'Nombre', 'name'])),
    Activo: toBoolean(pick(server, ['Activo', 'activo'], pick(payload, ['activo', 'Activo'], true)), true),
    OfflinePendiente: !result,
  };

  if (kind === 'catalogLocationCreate') {
    return {
      ...base,
      UbicacionID: id,
      locationId: id,
      ClienteID: pick(server, ['ClienteID'], pick(payload, ['clienteId', 'ClienteID'])),
      Direccion: pick(server, ['Direccion'], pick(payload, ['direccion', 'Direccion'])),
    };
  }
  if (kind === 'catalogEquipmentLocationCreate') {
    return {
      ...base,
      UbicacionEquipoID: id,
      equipmentLocationId: id,
      UbicacionID: pick(server, ['UbicacionID'], pick(payload, ['ubicacionId', 'UbicacionID'])),
      Descripcion: pick(server, ['Descripcion'], pick(payload, ['descripcion', 'Descripcion'])),
    };
  }
  if (kind === 'catalogManufacturerCreate') {
    return { ...base, FabricanteID: id, manufacturerId: id };
  }
  if (kind === 'catalogModelCreate') {
    return {
      ...base,
      ModeloID: id,
      modelId: id,
      FabricanteID: pick(server, ['FabricanteID'], pick(payload, ['fabricanteId', 'manufacturerId', 'FabricanteID'])),
      TipoDispositivoID: pick(server, ['TipoDispositivoID'], pick(payload, ['tipoDispositivoId', 'TipoDispositivoID'])),
    };
  }
  return {
    ...base,
    TipoDispositivoFabricanteID: id,
    relationId: id,
    TipoDispositivoID: pick(server, ['TipoDispositivoID'], pick(payload, ['tipoDispositivoId', 'TipoDispositivoID'])),
    FabricanteID: pick(server, ['FabricanteID'], pick(payload, ['fabricanteId', 'manufacturerId', 'FabricanteID'])),
  };
}

async function patchCatalogCache(kind, payload, result) {
  const definition = catalogDefinition(kind);
  const row = localCatalogRow(kind, payload, result);
  if (!definition || !row) return;
  const localId = String(pick(payload, definition.localIdKeys));
  const aliases = new Set(definition.listRoutes.map((route) => String(route).toLowerCase()));

  await updateCachedResponses(
    (entry) => aliases.has(cacheRoute(entry)),
    (data, entry) => {
      const request = cachePayload(entry);
      const keys = definition.idKeys;
      let items = removeBy(normalizeItems(data), localId, keys);
      const candidate = rebuildCollection(data, [row]);
      const visible = normalizeItems(filterMasterCatalog(candidate, definition.listRoutes, request)).length > 0;
      if (visible) items = upsertBy(items, row, keys);
      return rebuildCollection(data, items);
    },
  );
}

function catalogLocalAndServerIds(kind, payload, result) {
  const definition = catalogDefinition(kind);
  if (!definition) return { localId: '', serverId: '' };
  const localId = String(pick(payload, definition.localIdKeys));
  const serverId = String(pick(catalogResultSource(result), definition.idKeys));
  return { localId, serverId };
}
'''.strip()

module = replace_once(
    module,
    "async function applyOperationToCache(kind, payload, result, sessionToken) {",
    helpers + "\n\nasync function applyOperationToCache(kind, payload, result, sessionToken) {",
    'agregar adaptación local de catálogos',
)

module = replace_once(
    module,
    "  if (kind.startsWith('maintenance')) return patchMaintenanceCache(kind, payload, result, sessionToken);\n  return undefined;",
    "  if (kind.startsWith('maintenance')) return patchMaintenanceCache(kind, payload, result, sessionToken);\n  if (kind.startsWith('catalog')) return patchCatalogCache(kind, payload, result);\n  return undefined;",
    'aplicar catálogos a la caché',
)

module = replace_once(
    module,
    "  if (kind.startsWith('maintenance')) {\n    const maintenanceId = pick(payload, ['maintenanceId', 'MantenimientoID']);\n    if (['maintenanceCreate', 'maintenanceUpdate'].includes(kind)) {\n      return { mantenimiento: maintenanceRowFromPayload(payload, null), responsables: [], dispositivos: [], offlineQueued: true, operationId: operation.id };\n    }\n    if (['maintenanceDeviceCreate', 'maintenanceDeviceUpdate', 'maintenanceDeviceAutosave'].includes(kind)) return localMaintenanceDevice(payload);\n    if (kind === 'maintenanceImage') return localMaintenanceImage(payload);\n    return { ok: true, offlineQueued: true, maintenanceId, operationId: operation.id };\n  }\n  return { ok: true, offlineQueued: true, operationId: operation.id };",
    "  if (kind.startsWith('maintenance')) {\n    const maintenanceId = pick(payload, ['maintenanceId', 'MantenimientoID']);\n    if (['maintenanceCreate', 'maintenanceUpdate'].includes(kind)) {\n      return { mantenimiento: maintenanceRowFromPayload(payload, null), responsables: [], dispositivos: [], offlineQueued: true, operationId: operation.id };\n    }\n    if (['maintenanceDeviceCreate', 'maintenanceDeviceUpdate', 'maintenanceDeviceAutosave'].includes(kind)) return localMaintenanceDevice(payload);\n    if (kind === 'maintenanceImage') return localMaintenanceImage(payload);\n    return { ok: true, offlineQueued: true, maintenanceId, operationId: operation.id };\n  }\n  if (kind.startsWith('catalog')) {\n    return { ...localCatalogRow(kind, payload), offlineQueued: true, operationId: operation.id };\n  }\n  return { ok: true, offlineQueued: true, operationId: operation.id };",
    'responder con catálogos locales',
)

module = replace_once(
    module,
    "export async function replayQueuedOperation(operation, sessionToken = '') {\n  const payload = operation.payload || {};\n  const result = await requestFirstAvailable(\n    operation.routes || [],\n    (route) => apiRequest(route, payload, sessionToken),\n  );\n  await applyOperationToCache(operation.kind || offlineWriteKind(operation.routes), payload, result, sessionToken).catch(() => {});\n  return result;\n}",
    "export async function replayQueuedOperation(operation, sessionToken = '') {\n  const originalPayload = operation.payload || {};\n  const payload = await resolveOfflineReferences(originalPayload);\n  const kind = operation.kind || offlineWriteKind(operation.routes);\n  const result = await requestFirstAvailable(\n    operation.routes || [],\n    (route) => apiRequest(route, payload, sessionToken),\n  );\n  if (kind.startsWith('catalog')) {\n    const { localId, serverId } = catalogLocalAndServerIds(kind, originalPayload, result);\n    await saveOfflineIdMapping(localId, serverId).catch(() => {});\n  }\n  await applyOperationToCache(kind, originalPayload, result, sessionToken).catch(() => {});\n  return result;\n}",
    'resolver dependencias al sincronizar',
)

module_path.write_text(module, encoding='utf-8')

core_path = Path('src/services/offlineStoreCore.js')
core = core_path.read_text(encoding='utf-8')
core = replace_once(
    core,
    "const OPERATION_PRIORITY = Object.freeze({\n  ticketCreate: 10,",
    "const OPERATION_PRIORITY = Object.freeze({\n  catalogLocationCreate: 5,\n  catalogEquipmentLocationCreate: 5,\n  catalogManufacturerCreate: 6,\n  catalogDeviceManufacturerCreate: 7,\n  catalogModelCreate: 8,\n  ticketCreate: 10,",
    'priorizar catálogos',
)
core = replace_once(
    core,
    "  return (await readAll(QUEUE_STORE)).sort((a, b) => {\n    const byTime = Number(a.createdAt || 0) - Number(b.createdAt || 0);\n    if (byTime) return byTime;\n    return operationPriority(a) - operationPriority(b);\n  });",
    "  return (await readAll(QUEUE_STORE)).sort((a, b) => {\n    const byPriority = operationPriority(a) - operationPriority(b);\n    if (byPriority) return byPriority;\n    return Number(a.createdAt || 0) - Number(b.createdAt || 0);\n  });",
    'ordenar dependencias antes del tiempo',
)
core_path.write_text(core, encoding='utf-8')
