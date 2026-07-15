import { apiRequest } from '../api';

export const MODULE_ROUTES = {
  tickets: {
    list: ['boletas.list', 'tickets.list'],
    get: ['boletas.get', 'tickets.get'],
    create: ['boletas.create', 'tickets.create'],
    update: ['boletas.update', 'tickets.update'],
    autosave: ['boletas.autosave', 'boletas.update', 'tickets.update'],
    finalize: ['boletas.finalize', 'tickets.finalize'],
    testFinalize: ['boletas.testFinalize', 'tickets.testFinalize'],
    generatePdf: ['boletas.generatePdf', 'tickets.generatePdf'],
    returnPending: ['boletas.returnPending', 'boletas.update', 'tickets.update'],
    annul: ['boletas.annul', 'boletas.update', 'tickets.update'],
    evidenceUpload: ['boletas.evidence.upload', 'tickets.evidence.upload'],
    evidenceUpdate: ['boletas.evidence.update', 'tickets.evidence.update'],
    evidenceDelete: ['boletas.evidence.delete', 'tickets.evidence.delete'],
    signatureUpload: ['boletas.signature.upload'],
    mediaGet: ['boletas.media.get', 'tickets.media.get'],
  },
  clients: {
    list: ['clients.list', 'clientes.list'],
    get: ['clients.get', 'clientes.get'],
    create: ['clients.create', 'clientes.create'],
    update: ['clients.update', 'clientes.update'],
    locationsList: ['clientLocations.list', 'clients.locations.list', 'clientes.ubicaciones.list', 'ubicacionesCliente.list'],
    locationsCreate: ['clientLocations.create', 'clients.locations.create', 'clientes.ubicaciones.create', 'ubicacionesCliente.create'],
    locationsUpdate: ['clientLocations.update', 'clients.locations.update', 'clientes.ubicaciones.update', 'ubicacionesCliente.update'],
    equipmentLocationsList: ['equipmentLocations.list', 'clients.equipmentLocations.list', 'clientes.ubicacionesEquipo.list', 'ubicacionesEquipo.list'],
    equipmentLocationsCreate: ['equipmentLocations.create', 'clients.equipmentLocations.create', 'clientes.ubicacionesEquipo.create', 'ubicacionesEquipo.create'],
    equipmentLocationsUpdate: ['equipmentLocations.update', 'clients.equipmentLocations.update', 'clientes.ubicacionesEquipo.update', 'ubicacionesEquipo.update'],
    contactsList: ['contacts.list', 'clients.contacts.list', 'clientes.contactos.list', 'contactosCliente.list'],
    contactsCreate: ['contacts.create', 'clients.contacts.create', 'clientes.contactos.create', 'contactosCliente.create'],
    contactsUpdate: ['contacts.update', 'clients.contacts.update', 'clientes.contactos.update', 'contactosCliente.update'],
    contactsDelete: ['contacts.delete', 'clients.contacts.delete', 'clientes.contactos.delete', 'contactosCliente.delete'],
  },
  categories: {
    list: ['catalog.categories.list', 'categories.list', 'categorias.list'],
    create: ['catalog.categories.create', 'categories.create', 'categorias.create'],
    update: ['catalog.categories.update', 'categories.update', 'categorias.update'],
  },
  deviceTypes: {
    list: ['catalog.deviceTypes.list', 'deviceTypes.list', 'tiposDispositivo.list'],
    create: ['catalog.deviceTypes.create', 'deviceTypes.create', 'tiposDispositivo.create'],
    update: ['catalog.deviceTypes.update', 'deviceTypes.update', 'tiposDispositivo.update'],
  },
  manufacturers: {
    list: ['catalog.manufacturers.list', 'manufacturers.list', 'fabricantes.list'],
    create: ['catalog.manufacturers.create', 'manufacturers.create', 'fabricantes.create'],
    update: ['catalog.manufacturers.update', 'manufacturers.update', 'fabricantes.update'],
  },
  models: {
    list: ['catalog.models.list', 'models.list', 'modelos.list'],
    create: ['catalog.models.create', 'models.create', 'modelos.create'],
    update: ['catalog.models.update', 'models.update', 'modelos.update'],
  },
  failureTypes: {
    list: ['catalog.failureTypes.list', 'failureTypes.list', 'tiposFalla.list'],
    create: ['catalog.failureTypes.create', 'failureTypes.create', 'tiposFalla.create'],
    update: ['catalog.failureTypes.update', 'failureTypes.update', 'tiposFalla.update'],
  },
  deviceManufacturers: {
    list: ['catalog.deviceManufacturers.list', 'deviceManufacturers.list', 'tipoDispositivoFabricantes.list'],
    create: ['catalog.deviceManufacturers.create', 'deviceManufacturers.create', 'tipoDispositivoFabricantes.create'],
    update: ['catalog.deviceManufacturers.update', 'deviceManufacturers.update', 'tipoDispositivoFabricantes.update'],
  },
  knowledge: {
    list: ['knowledge.list', 'baseConocimientos.list', 'conocimiento.list', 'tutorials.list'],
    get: ['knowledge.get', 'baseConocimientos.get', 'conocimiento.get', 'tutorials.get'],
    create: ['knowledge.create', 'baseConocimientos.create', 'conocimiento.create', 'tutorials.create'],
    update: ['knowledge.update', 'baseConocimientos.update', 'conocimiento.update', 'tutorials.update'],
    delete: ['knowledge.delete', 'baseConocimientos.delete', 'conocimiento.delete', 'tutorials.delete'],
    attachmentUpload: ['knowledge.attachments.upload', 'baseConocimientos.adjuntos.upload', 'conocimiento.adjuntos.upload'],
    attachmentDelete: ['knowledge.attachments.delete', 'baseConocimientos.adjuntos.delete', 'conocimiento.adjuntos.delete'],
    mediaGet: ['knowledge.media.get', 'baseConocimientos.media.get', 'conocimiento.media.get'],
  },
  knowledgeCategories: {
    list: ['knowledge.categories.list', 'baseConocimientos.categorias.list', 'categoriasConocimiento.list'],
    create: ['knowledge.categories.create', 'baseConocimientos.categorias.create', 'categoriasConocimiento.create'],
    update: ['knowledge.categories.update', 'baseConocimientos.categorias.update', 'categoriasConocimiento.update'],
  },
  users: { list: ['users.assignment.list', 'users.list'], adminList: ['users.list'] },
  config: { get: ['config.get', 'app.config.get'] },
};

export function normalizeItems(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.rows)) return data.rows;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

export function pick(object, keys, fallback = '') {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return fallback;
}

export function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'si', 'sí', 'yes', 'activo'].includes(String(value).trim().toLowerCase());
}

export function toOption(record, valueKeys, labelKeys) {
  const fallbackKeys = ['RowID', 'Row ID', 'rowId', 'rowID'];
  const value = pick(record, [...valueKeys, ...fallbackKeys]);
  const label = pick(record, labelKeys, value);
  return value ? { value: String(value), label: String(label), record } : null;
}

function isMissingRouteError(error) {
  const text = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
  return text.includes('route') || text.includes('ruta') || text.includes('not_found') || text.includes('no encontrada') || text.includes('unknown action') || text.includes('handler not found');
}

function isNetworkError(error) {
  const text = `${error?.name || ''} ${error?.message || ''}`.toLowerCase();
  return text.includes('failed to fetch') || text.includes('networkerror') || text.includes('network request failed') || text.includes('load failed');
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function requestRouteWithRetry(route, payload, sessionToken) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await apiRequest(route, payload, sessionToken);
    } catch (error) {
      lastError = error;
      if (!isNetworkError(error) || attempt === 1) throw error;
      await wait(450);
    }
  }
  throw lastError;
}

export async function requestAvailable(routes, payload = {}, sessionToken = '') {
  let lastError;
  for (const route of routes) {
    try {
      return await requestRouteWithRetry(route, payload, sessionToken);
    } catch (error) {
      lastError = error;
      if (!isMissingRouteError(error)) throw error;
    }
  }
  throw lastError || new Error('La operación todavía no está disponible en el backend.');
}
