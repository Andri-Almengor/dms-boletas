const LOCAL_PREFIXES = Object.freeze([
  'local-',
  'ubicacion-',
  'ubicacion-equipo-',
  'fabricante-',
  'modelo-',
  'relacion-',
  'tipo-dispositivo-',
  'mantenimiento-',
  'dispositivo-',
  'foto-',
  'boleta-',
  'evidencia-',
]);

const KIND_CONFIG = Object.freeze({
  clientLocationCreate: {
    prefix: 'ubicacion',
    idKeys: ['UbicacionID', 'ubicacionId', 'id'],
    resultKeys: ['UbicacionID', 'ubicacionId', 'id'],
    priority: 12,
    description: 'Crear ubicación del cliente',
    routeTerms: ['clientlocations', 'clients.locations', 'clientes.ubicaciones', 'ubicacionescliente'],
  },
  clientLocationUpdate: {
    idKeys: ['UbicacionID', 'ubicacionId', 'id'],
    resultKeys: ['UbicacionID', 'ubicacionId', 'id'],
    priority: 21,
    description: 'Actualizar ubicación del cliente',
    routeTerms: ['clientlocations', 'clients.locations', 'clientes.ubicaciones', 'ubicacionescliente'],
  },
  equipmentLocationCreate: {
    prefix: 'ubicacion-equipo',
    idKeys: ['UbicacionEquipoID', 'ubicacionEquipoId', 'id'],
    resultKeys: ['UbicacionEquipoID', 'ubicacionEquipoId', 'id'],
    priority: 16,
    description: 'Crear ubicación de equipo',
    routeTerms: ['equipmentlocations', 'clients.equipmentlocations', 'clientes.ubicacionesequipo', 'ubicacionesequipo'],
  },
  equipmentLocationUpdate: {
    idKeys: ['UbicacionEquipoID', 'ubicacionEquipoId', 'id'],
    resultKeys: ['UbicacionEquipoID', 'ubicacionEquipoId', 'id'],
    priority: 22,
    description: 'Actualizar ubicación de equipo',
    routeTerms: ['equipmentlocations', 'clients.equipmentlocations', 'clientes.ubicacionesequipo', 'ubicacionesequipo'],
  },
  deviceTypeCreate: {
    prefix: 'tipo-dispositivo',
    idKeys: ['TipoDispositivoID', 'tipoDispositivoId', 'id'],
    resultKeys: ['TipoDispositivoID', 'tipoDispositivoId', 'id'],
    priority: 12,
    description: 'Crear tipo de dispositivo',
    routeTerms: ['devicetypes', 'tiposdispositivo'],
  },
  deviceTypeUpdate: {
    idKeys: ['TipoDispositivoID', 'tipoDispositivoId', 'id'],
    resultKeys: ['TipoDispositivoID', 'tipoDispositivoId', 'id'],
    priority: 21,
    description: 'Actualizar tipo de dispositivo',
    routeTerms: ['devicetypes', 'tiposdispositivo'],
  },
  manufacturerCreate: {
    prefix: 'fabricante',
    idKeys: ['FabricanteID', 'fabricanteId', 'id'],
    resultKeys: ['FabricanteID', 'fabricanteId', 'id'],
    priority: 12,
    description: 'Crear fabricante',
    routeTerms: ['manufacturers', 'fabricantes'],
  },
  manufacturerUpdate: {
    idKeys: ['FabricanteID', 'fabricanteId', 'id'],
    resultKeys: ['FabricanteID', 'fabricanteId', 'id'],
    priority: 21,
    description: 'Actualizar fabricante',
    routeTerms: ['manufacturers', 'fabricantes'],
  },
  modelCreate: {
    prefix: 'modelo',
    idKeys: ['ModeloID', 'modeloId', 'id'],
    resultKeys: ['ModeloID', 'modeloId', 'id'],
    priority: 17,
    description: 'Crear modelo',
    routeTerms: ['models', 'modelos'],
  },
  modelUpdate: {
    idKeys: ['ModeloID', 'modeloId', 'id'],
    resultKeys: ['ModeloID', 'modeloId', 'id'],
    priority: 22,
    description: 'Actualizar modelo',
    routeTerms: ['models', 'modelos'],
  },
  deviceManufacturerCreate: {
    prefix: 'relacion',
    idKeys: ['TipoDispositivoFabricanteID', 'relacionId', 'id'],
    resultKeys: ['TipoDispositivoFabricanteID', 'relacionId', 'id'],
    priority: 18,
    description: 'Relacionar tipo de dispositivo y fabricante',
    routeTerms: ['devicemanufacturers', 'tipodispositivofabricantes'],
  },
  deviceManufacturerUpdate: {
    idKeys: ['TipoDispositivoFabricanteID', 'relacionId', 'id'],
    resultKeys: ['TipoDispositivoFabricanteID', 'relacionId', 'id'],
    priority: 23,
    description: 'Actualizar relación de dispositivo y fabricante',
    routeTerms: ['devicemanufacturers', 'tipodispositivofabricantes'],
  },
});

function clean(value) {
  return String(value ?? '').trim();
}

function first(object, keys, fallback = '') {
  for (const key of keys || []) {
    const value = object?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return fallback;
}

function unwrapResult(result = {}) {
  return result?.item
    || result?.row
    || result?.data
    || result?.ubicacion
    || result?.ubicacionEquipo
    || result?.fabricante
    || result?.modelo
    || result?.tipoDispositivo
    || result?.relacion
    || result;
}

function createId(prefix = 'local') {
  const random = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}

function routesText(routes) {
  return (Array.isArray(routes) ? routes : [routes]).join(' ').toLowerCase();
}

function createOrUpdate(text, createKind, updateKind) {
  if (text.includes('.create')) return createKind;
  if (text.includes('.update')) return updateKind;
  return '';
}

export function offlineCatalogWriteKind(routes) {
  const text = routesText(routes);
  if (text.includes('equipmentlocations') || text.includes('ubicacionesequipo')) {
    return createOrUpdate(text, 'equipmentLocationCreate', 'equipmentLocationUpdate');
  }
  if (text.includes('clientlocations') || text.includes('clients.locations') || text.includes('clientes.ubicaciones') || text.includes('ubicacionescliente')) {
    return createOrUpdate(text, 'clientLocationCreate', 'clientLocationUpdate');
  }
  if (text.includes('devicemanufacturers') || text.includes('tipodispositivofabricantes')) {
    return createOrUpdate(text, 'deviceManufacturerCreate', 'deviceManufacturerUpdate');
  }
  if (text.includes('devicetypes') || text.includes('tiposdispositivo')) {
    return createOrUpdate(text, 'deviceTypeCreate', 'deviceTypeUpdate');
  }
  if (text.includes('manufacturers') || text.includes('fabricantes')) {
    return createOrUpdate(text, 'manufacturerCreate', 'manufacturerUpdate');
  }
  if (text.includes('models') || text.includes('modelos')) {
    return createOrUpdate(text, 'modelCreate', 'modelUpdate');
  }
  return '';
}

export function isOfflineCatalogKind(kind) {
  return Boolean(KIND_CONFIG[kind]);
}

export function isOfflineCatalogCreateKind(kind) {
  return isOfflineCatalogKind(kind) && String(kind).endsWith('Create');
}

export function isOfflineLocalId(value) {
  const text = clean(value).toLowerCase();
  return Boolean(text && LOCAL_PREFIXES.some((prefix) => text.startsWith(prefix)));
}

export function catalogIdKeys(kind) {
  return [...(KIND_CONFIG[kind]?.idKeys || ['id'])];
}

export function catalogEntityId(kind, payload = {}) {
  return clean(first(payload, catalogIdKeys(kind)));
}

export function prepareOfflineCatalogPayload(kind, originalPayload = {}) {
  const config = KIND_CONFIG[kind];
  if (!config) return { ...originalPayload };
  const payload = { ...originalPayload };
  if (!isOfflineCatalogCreateKind(kind) || catalogEntityId(kind, payload)) return payload;

  const id = createId(config.prefix || 'catalogo');
  const keys = config.idKeys || ['id'];
  payload[keys[0]] = id;
  if (keys[1]) payload[keys[1]] = id;
  payload.id = payload.id || id;
  return payload;
}

export function collectOfflineLocalReferences(value, result = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectOfflineLocalReferences(item, result));
    return result;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => collectOfflineLocalReferences(item, result));
    return result;
  }
  if (isOfflineLocalId(value)) result.add(clean(value));
  return result;
}

export function collectOfflineDependencies(kind, payload = {}) {
  const ownId = catalogEntityId(kind, payload);
  return [...collectOfflineLocalReferences(payload)]
    .filter((value) => value && value !== ownId)
    .sort();
}

export function replaceOfflineReferences(value, mappings) {
  const map = mappings instanceof Map
    ? mappings
    : new Map(Object.entries(mappings || {}));
  if (Array.isArray(value)) return value.map((item) => replaceOfflineReferences(item, map));
  if (value && typeof value === 'object') {
    return Object.keys(value).reduce((result, key) => {
      result[key] = replaceOfflineReferences(value[key], map);
      return result;
    }, {});
  }
  const text = clean(value);
  return text && map.has(text) ? map.get(text) : value;
}

export function catalogOperationPriority(kind) {
  return Number(KIND_CONFIG[kind]?.priority || 35);
}

export function catalogOperationDescription(kind) {
  return KIND_CONFIG[kind]?.description || '';
}

export function catalogDedupeKey(kind, payload = {}) {
  const id = catalogEntityId(kind, payload);
  return id ? `${kind}:${id}` : '';
}

export function catalogCreatedServerId(kind, result = {}) {
  const config = KIND_CONFIG[kind];
  if (!config) return '';
  const row = unwrapResult(result);
  return clean(first(row, config.resultKeys || config.idKeys));
}

function activeValue(payload, result) {
  return first(result, ['Activo', 'activo'], first(payload, ['Activo', 'activo'], true));
}

export function catalogLocalRow(kind, payload = {}, result = {}) {
  const row = unwrapResult(result);
  const localId = clean(payload.__offlineLocalId || catalogEntityId(kind, payload));
  const serverId = catalogCreatedServerId(kind, row);
  const id = serverId || localId;
  const common = {
    ...payload,
    ...row,
    id,
    Activo: activeValue(payload, row),
    OfflinePendiente: !serverId || serverId === localId,
    OfflineLocalID: localId,
  };

  if (kind.startsWith('clientLocation')) {
    return {
      ...common,
      UbicacionID: id,
      ClienteID: first(row, ['ClienteID', 'clienteId'], first(payload, ['ClienteID', 'clienteId'])),
      Nombre: first(row, ['Nombre', 'nombre'], first(payload, ['Nombre', 'nombre'])),
      Direccion: first(row, ['Direccion', 'direccion'], first(payload, ['Direccion', 'direccion'])),
    };
  }
  if (kind.startsWith('equipmentLocation')) {
    return {
      ...common,
      UbicacionEquipoID: id,
      UbicacionID: first(row, ['UbicacionID', 'ubicacionId'], first(payload, ['UbicacionID', 'ubicacionId'])),
      Nombre: first(row, ['Nombre', 'nombre'], first(payload, ['Nombre', 'nombre'])),
      Descripcion: first(row, ['Descripcion', 'descripcion'], first(payload, ['Descripcion', 'descripcion'])),
    };
  }
  if (kind.startsWith('deviceType')) {
    return {
      ...common,
      TipoDispositivoID: id,
      Nombre: first(row, ['Nombre', 'nombre'], first(payload, ['Nombre', 'nombre'])),
    };
  }
  if (kind.startsWith('manufacturer')) {
    return {
      ...common,
      FabricanteID: id,
      Nombre: first(row, ['Nombre', 'nombre'], first(payload, ['Nombre', 'nombre'])),
    };
  }
  if (kind.startsWith('model')) {
    return {
      ...common,
      ModeloID: id,
      FabricanteID: first(row, ['FabricanteID', 'fabricanteId'], first(payload, ['FabricanteID', 'fabricanteId'])),
      TipoDispositivoID: first(row, ['TipoDispositivoID', 'tipoDispositivoId'], first(payload, ['TipoDispositivoID', 'tipoDispositivoId'])),
      Nombre: first(row, ['Nombre', 'nombre'], first(payload, ['Nombre', 'nombre'])),
    };
  }
  if (kind.startsWith('deviceManufacturer')) {
    return {
      ...common,
      TipoDispositivoFabricanteID: id,
      TipoDispositivoID: first(row, ['TipoDispositivoID', 'tipoDispositivoId'], first(payload, ['TipoDispositivoID', 'tipoDispositivoId'])),
      FabricanteID: first(row, ['FabricanteID', 'fabricanteId'], first(payload, ['FabricanteID', 'fabricanteId'])),
    };
  }
  return common;
}

export function offlineCatalogCacheRouteMatches(kind, route) {
  const text = clean(route).toLowerCase();
  return Boolean(text && (KIND_CONFIG[kind]?.routeTerms || []).some((term) => text.includes(term)));
}

export function catalogRowMatchesRequest(kind, row = {}, request = {}) {
  if (kind.startsWith('clientLocation')) {
    const expected = clean(first(request, ['ClienteID', 'clienteId']));
    return !expected || clean(first(row, ['ClienteID', 'clienteId'])) === expected;
  }
  if (kind.startsWith('equipmentLocation')) {
    const expected = clean(first(request, ['UbicacionID', 'ubicacionId']));
    return !expected || clean(first(row, ['UbicacionID', 'ubicacionId'])) === expected;
  }
  if (kind.startsWith('model')) {
    const manufacturer = clean(first(request, ['FabricanteID', 'fabricanteId']));
    const type = clean(first(request, ['TipoDispositivoID', 'tipoDispositivoId']));
    if (manufacturer && clean(first(row, ['FabricanteID', 'fabricanteId'])) !== manufacturer) return false;
    if (type && clean(first(row, ['TipoDispositivoID', 'tipoDispositivoId'])) !== type) return false;
  }
  if (kind.startsWith('deviceManufacturer')) {
    const manufacturer = clean(first(request, ['FabricanteID', 'fabricanteId']));
    const type = clean(first(request, ['TipoDispositivoID', 'tipoDispositivoId']));
    if (manufacturer && clean(first(row, ['FabricanteID', 'fabricanteId'])) !== manufacturer) return false;
    if (type && clean(first(row, ['TipoDispositivoID', 'tipoDispositivoId'])) !== type) return false;
  }
  return true;
}
