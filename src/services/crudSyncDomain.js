import { patchAgendaCollection } from './agendaSyncDomain';

const CLIENT_RESOURCES = new Set(['client', 'clientLocation', 'equipmentLocation', 'contact']);

const RESOURCE_SPECS = Object.freeze({
  agenda: Object.freeze({
    id: 'AgendaID',
    search: [],
    routes: ['agenda.list', 'agendas.list'],
  }),
  client: Object.freeze({
    id: 'ClienteID',
    search: ['Nombre', 'Clientes', 'RazonSocial', 'CorreoGeneral', 'Telefono'],
    routes: ['clients.list', 'clientes.list'],
  }),
  clientLocation: Object.freeze({
    id: 'UbicacionID',
    parent: 'ClienteID',
    search: ['Nombre', 'Direccion', 'Notas'],
    routes: ['clientlocations.list', 'clients.locations.list', 'clientes.ubicaciones.list', 'ubicacionescliente.list'],
  }),
  equipmentLocation: Object.freeze({
    id: 'UbicacionEquipoID',
    parent: 'UbicacionID',
    search: ['Nombre', 'Descripcion'],
    routes: ['equipmentlocations.list', 'clients.equipmentlocations.list', 'clientes.ubicacionesequipo.list', 'ubicacionesequipo.list'],
  }),
  contact: Object.freeze({
    id: 'ContactoID',
    parent: 'ClienteID',
    search: ['Nombre', 'Correo', 'Puesto', 'Telefono'],
    routes: ['contacts.list', 'clients.contacts.list', 'clientes.contactos.list', 'contactoscliente.list'],
  }),
  catalogCategory: Object.freeze({
    id: 'CategoriaID',
    search: ['Nombre', 'Descripcion'],
    routes: ['catalog.categories.list', 'catalog.operational.categories.list', 'categories.list', 'categorias.list'],
  }),
  deviceType: Object.freeze({
    id: 'TipoDispositivoID',
    search: ['Nombre', 'Descripcion'],
    routes: ['catalog.devicetypes.list', 'catalog.operational.devicetypes.list', 'devicetypes.list', 'tiposdispositivo.list'],
  }),
  manufacturer: Object.freeze({
    id: 'FabricanteID',
    search: ['Nombre'],
    routes: ['catalog.manufacturers.list', 'catalog.operational.manufacturers.list', 'manufacturers.list', 'fabricantes.list'],
  }),
  model: Object.freeze({
    id: 'ModeloID',
    search: ['Nombre', 'Descripcion'],
    routes: ['catalog.models.list', 'catalog.operational.models.list', 'models.list', 'modelos.list'],
  }),
  failureType: Object.freeze({
    id: 'TipoFallaID',
    search: ['Nombre', 'Descripcion'],
    routes: ['catalog.failuretypes.list', 'catalog.operational.failuretypes.list', 'failuretypes.list', 'tiposfalla.list'],
  }),
  deviceManufacturerRelation: Object.freeze({
    id: 'RelacionID',
    search: [],
    routes: ['catalog.devicemanufacturers.list', 'catalog.operational.devicemanufacturers.list', 'devicemanufacturers.list', 'tipodispositivofabricantes.list'],
  }),
});

function clean(value) {
  return String(value ?? '').trim();
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'si', 'sí', 'yes', 'activo'].includes(String(value).trim().toLowerCase());
}

function itemsFrom(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.rows)) return data.rows;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function canIncludeInactive(resource, permissions = []) {
  if (permissions.includes('USUARIOS_GESTIONAR')) return true;
  if (CLIENT_RESOURCES.has(resource)) return permissions.includes('CLIENTES_EDITAR');
  return permissions.includes('CATALOGOS_GESTIONAR');
}

function activeRecord(row = {}) {
  return String(row.Estado || 'ACTIVO').toUpperCase() !== 'INACTIVO' && row.Activo !== false;
}

function parentValue(resource, request = {}) {
  if (resource === 'clientLocation' || resource === 'contact') {
    return clean(request.ClienteID ?? request.clienteId);
  }
  if (resource === 'equipmentLocation') {
    return clean(request.UbicacionID ?? request.ubicacionId);
  }
  return '';
}

export function crudRowMatchesSyncQuery(resource, row = {}, request = {}, permissions = []) {
  const spec = RESOURCE_SPECS[resource];
  if (!spec) return false;
  const includeInactive = bool(request.includeInactive, false) && canIncludeInactive(resource, permissions);
  if (!includeInactive && !activeRecord(row)) return false;

  if (!(resource === 'client' && !includeInactive) && request.activo !== undefined) {
    if (String(row.Activo).toLowerCase() !== String(request.activo).toLowerCase()) return false;
  }
  if (request.estado && String(row.Estado || '').toUpperCase() !== String(request.estado).toUpperCase()) return false;

  const expectedParent = parentValue(resource, request);
  if (expectedParent && clean(row[spec.parent]) !== expectedParent) return false;

  if (resource === 'model') {
    const typeId = clean(request.TipoDispositivoID ?? request.tipoDispositivoId);
    const manufacturerId = clean(request.FabricanteID ?? request.fabricanteId);
    if (typeId && clean(row.TipoDispositivoID) !== typeId) return false;
    if (manufacturerId && clean(row.FabricanteID) !== manufacturerId) return false;
  }

  const query = clean(request.search || request.q).toLowerCase();
  if (query && !spec.search.some((field) => String(row[field] || '').toLowerCase().includes(query))) return false;
  return true;
}

function rebuildCollection(original, items, total, integrityPending) {
  if (Array.isArray(original)) return items;
  const shared = {
    ...original,
    total: Math.max(0, Number.isFinite(Number(total)) ? Number(total) : items.length),
    syncIntegrityPending: Boolean(integrityPending),
  };
  if (Array.isArray(original?.items)) return { ...shared, items };
  if (Array.isArray(original?.rows)) return { ...shared, rows: items };
  if (Array.isArray(original?.data)) return { ...shared, data: items };
  return { ...shared, items };
}

function sortItems(items, request = {}) {
  const field = clean(request.sortBy);
  if (!field) return items;
  const direction = String(request.sortDir || '').toLowerCase() === 'desc' ? -1 : 1;
  return items.sort((left, right) => String(left?.[field] || '').localeCompare(String(right?.[field] || ''), 'es') * direction);
}

export function patchCrudCollection(resource, data, request = {}, delta = {}, permissions = []) {
  if (resource === 'agenda') return patchAgendaCollection(data, request, delta, permissions);
  const spec = RESOURCE_SPECS[resource];
  if (!spec) return data;

  const before = itemsFrom(data);
  const page = Math.max(1, Number(request.page || data?.page || 1));
  const pageSize = Math.max(1, Number(request.pageSize || data?.pageSize || before.length || 100));
  let total = Number(data?.total);
  if (!Number.isFinite(total)) total = before.length;
  const completeCollection = total <= before.length;
  let integrityPending = Boolean(data?.syncIntegrityPending) || Boolean((delta.invalidated || []).length);
  let items = [...before];

  const indexOf = (id) => items.findIndex((row) => clean(row?.[spec.id]) === clean(id));

  for (const removedId of delta.removed || []) {
    const index = indexOf(removedId);
    if (index >= 0) {
      items.splice(index, 1);
      total = Math.max(0, total - 1);
      if (!completeCollection) integrityPending = true;
    } else if (!completeCollection) {
      integrityPending = true;
    }
  }

  for (const incoming of delta.upserts || []) {
    const id = clean(incoming?.[spec.id]);
    if (!id) continue;
    const index = indexOf(id);
    const matches = crudRowMatchesSyncQuery(resource, incoming, request, permissions);

    if (index >= 0) {
      if (matches) {
        items[index] = { ...items[index], ...incoming };
        if (request.sortBy && !completeCollection) integrityPending = true;
      } else {
        items.splice(index, 1);
        total = Math.max(0, total - 1);
        if (!completeCollection) integrityPending = true;
      }
      continue;
    }

    if (!matches) {
      if (!completeCollection) integrityPending = true;
      continue;
    }

    total += 1;
    const lastKnownPage = page * pageSize >= total;
    if (completeCollection || lastKnownPage) {
      items.push(incoming);
    } else {
      integrityPending = true;
    }
  }

  items = sortItems(items, request);
  if (!completeCollection && items.length > pageSize) {
    items = items.slice(0, pageSize);
    integrityPending = true;
  }
  return rebuildCollection(data, items, total, integrityPending);
}

export function crudSyncListRoutes(resource) {
  return [...(RESOURCE_SPECS[resource]?.routes || [])];
}

export function crudSyncResourceForRoutes(routes) {
  const candidates = (Array.isArray(routes) ? routes : [routes])
    .map((route) => String(route || '').toLowerCase());
  for (const [resource, spec] of Object.entries(RESOURCE_SPECS)) {
    if (candidates.some((route) => spec.routes.includes(route))) return resource;
  }
  return '';
}
