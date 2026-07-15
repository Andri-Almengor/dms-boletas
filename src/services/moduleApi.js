import { apiRequest } from '../api';
import {
  cacheResponse,
  createOfflineId,
  enqueueOperation,
  readCachedResponse,
  responseCacheKey,
} from './offlineStore';

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
  maintenance: {
    list: ['maintenance.list', 'mantenimientos.list'],
    get: ['maintenance.get', 'mantenimientos.get'],
    create: ['maintenance.create', 'mantenimientos.create'],
    update: ['maintenance.update', 'mantenimientos.update'],
    delete: ['maintenance.delete', 'mantenimientos.delete'],
    finalize: ['maintenance.finalize', 'mantenimientos.finalize'],
    reopen: ['maintenance.reopen', 'mantenimientos.reopen'],
    deviceCreate: ['maintenance.devices.create', 'mantenimientos.dispositivos.create'],
    deviceUpdate: ['maintenance.devices.update', 'mantenimientos.dispositivos.update'],
    deviceAutosave: ['maintenance.devices.autosave', 'mantenimientos.dispositivos.autosave'],
    deviceDelete: ['maintenance.devices.delete', 'mantenimientos.dispositivos.delete'],
    imageUpload: ['maintenance.images.upload', 'mantenimientos.imagenes.upload'],
    imageUpdate: ['maintenance.images.update', 'mantenimientos.imagenes.update'],
    imageDelete: ['maintenance.images.delete', 'mantenimientos.imagenes.delete'],
    mediaGet: ['maintenance.media.get', 'mantenimientos.media.get'],
    spreadsheetReport: ['maintenance.report.spreadsheet', 'mantenimientos.reporte.excel'],
    slidesReport: ['maintenance.report.slides', 'mantenimientos.reporte.presentacion'],
    config: ['maintenance.config', 'mantenimientos.config'],
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
  surveys: {
    publicGet: ['survey.public.get', 'encuesta.publica.get'],
    publicSubmit: ['survey.public.submit', 'encuesta.publica.submit'],
    questionsList: ['survey.questions.list', 'encuestas.preguntas.list'],
    questionsCreate: ['survey.questions.create', 'encuestas.preguntas.create'],
    questionsUpdate: ['survey.questions.update', 'encuestas.preguntas.update'],
    questionsDelete: ['survey.questions.delete', 'encuestas.preguntas.delete'],
    responsesList: ['survey.responses.list', 'encuestas.respuestas.list'],
    responsesGet: ['survey.responses.get', 'encuestas.respuestas.get'],
  },
  users: { list: ['users.assignment.list', 'users.list'], adminList: ['users.list'] },
  config: { get: ['config.get', 'app.config.get'] },
};

export const OFFLINE_CATALOG_PAYLOAD = Object.freeze({ page: 1, pageSize: 1000, activo: true });

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

export function isNetworkError(error) {
  const text = `${error?.name || ''} ${error?.message || ''}`.toLowerCase();
  return text.includes('failed to fetch')
    || text.includes('networkerror')
    || text.includes('network request failed')
    || text.includes('load failed')
    || text.includes('internet disconnected');
}

function isReadRoute(routes) {
  const route = String((Array.isArray(routes) ? routes[0] : routes) || '').toLowerCase();
  return route === 'auth.me'
    || route === 'config.get'
    || route === 'app.config.get'
    || route.endsWith('.list')
    || route.endsWith('.get')
    || route.endsWith('.config');
}

function offlineWriteKind(routes) {
  const text = (Array.isArray(routes) ? routes : [routes]).join(' ').toLowerCase();
  if (text.includes('boletas.create') || text.includes('tickets.create')) return 'create';
  if (text.includes('boletas.autosave')) return 'autosave';
  if (text.includes('boletas.signature.upload')) return 'signature';
  if (text.includes('boletas.evidence.upload') || text.includes('tickets.evidence.upload')) return 'evidence';
  if (text.includes('boletas.finalize') || text.includes('tickets.finalize')) return 'finalize';
  if (text.includes('boletas.testfinalize') || text.includes('tickets.testfinalize')) return 'test';
  if (text.includes('boletas.generatepdf') || text.includes('tickets.generatepdf')) return 'pdf';
  if (text.includes('boletas.update') || text.includes('tickets.update')) return 'update';
  return '';
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

function offlineDescription(kind) {
  const labels = {
    create: 'Crear boleta',
    update: 'Actualizar boleta',
    autosave: 'Autoguardar boleta',
    signature: 'Subir firma',
    evidence: 'Subir evidencia',
    finalize: 'Finalizar y enviar boleta',
    test: 'Generar prueba de boleta',
    pdf: 'Generar PDF',
  };
  return labels[kind] || 'Sincronizar cambio';
}

function rebuildCollection(original, items) {
  if (Array.isArray(original)) return items;
  if (Array.isArray(original?.items)) return { ...original, items, total: items.length, page: 1, pageSize: items.length || 1 };
  if (Array.isArray(original?.rows)) return { ...original, rows: items, total: items.length };
  if (Array.isArray(original?.data)) return { ...original, data: items, total: items.length };
  return { items, total: items.length, page: 1, pageSize: items.length || 1 };
}

function filterMasterCatalog(data, routes, payload) {
  const routeText = (Array.isArray(routes) ? routes : [routes]).join(' ').toLowerCase();
  let items = normalizeItems(data);
  if (payload.activo !== undefined) {
    items = items.filter((row) => String(row.Activo ?? true).toLowerCase() === String(payload.activo).toLowerCase()
      && String(row.Estado || 'ACTIVO').toUpperCase() !== 'INACTIVO');
  }
  if (routeText.includes('location') || routeText.includes('ubicacion')) {
    if (routeText.includes('equipment') || routeText.includes('ubicacionesequipo') || routeText.includes('ubicacionesequipo')) {
      if (payload.ubicacionId || payload.UbicacionID) {
        const parentId = String(payload.ubicacionId || payload.UbicacionID);
        items = items.filter((row) => String(row.UbicacionID || row.ubicacionId || '') === parentId);
      }
    } else if (payload.clienteId || payload.ClienteID) {
      const clientId = String(payload.clienteId || payload.ClienteID);
      items = items.filter((row) => String(row.ClienteID || row.clienteId || '') === clientId);
    }
  }
  if (routeText.includes('contact')) {
    if (payload.clienteId || payload.ClienteID) {
      const clientId = String(payload.clienteId || payload.ClienteID);
      items = items.filter((row) => String(row.ClienteID || row.clienteId || '') === clientId);
    }
    if (payload.esSupervisor !== undefined) {
      items = items.filter((row) => toBoolean(row.EsSupervisor ?? row.esSupervisor, false) === toBoolean(payload.esSupervisor, false));
    }
  }
  return rebuildCollection(data, items);
}

async function readOfflineResponse(routes, payload, sessionToken, exactKey) {
  const exact = await readCachedResponse(exactKey);
  if (exact !== null) return exact;

  const routeText = (Array.isArray(routes) ? routes : [routes]).join(' ').toLowerCase();
  const supportsMasterFallback = routeText.includes('clientlocations')
    || routeText.includes('clients.locations')
    || routeText.includes('ubicacionescliente')
    || routeText.includes('equipmentlocations')
    || routeText.includes('ubicacionesequipo')
    || routeText.includes('contacts.list')
    || routeText.includes('clients.contacts')
    || routeText.includes('contactoscliente');
  if (!supportsMasterFallback) return null;

  const masterKey = responseCacheKey(routes, OFFLINE_CATALOG_PAYLOAD, sessionToken);
  const master = await readCachedResponse(masterKey);
  return master === null ? null : filterMasterCatalog(master, routes, payload);
}

function queuedResponse(kind, payload, operation) {
  const uid = pick(payload, ['boletaUid', 'BoletaUID', 'id']);
  if (kind === 'create' || kind === 'update' || kind === 'autosave') {
    return {
      boleta: { ...payload, BoletaUID: uid, boletaUid: uid, Estado: payload.Estado || payload.estado || 'PENDIENTE' },
      offlineQueued: true,
      operationId: operation.id,
    };
  }
  return { ok: true, offlineQueued: true, boletaUid: uid, operationId: operation.id };
}

async function cacheOfflineTicketDetail(payload, sessionToken) {
  const uid = pick(payload, ['boletaUid', 'BoletaUID']);
  if (!uid) return;
  const assigned = (payload.AsignadoA || payload.asignados || []).map((UsuarioID) => ({ UsuarioID }));
  const detail = {
    boleta: {
      ...payload,
      BoletaUID: uid,
      BoletaID: payload.BoletaID || 'Sin sincronizar',
      Estado: payload.Estado || payload.estado || 'PENDIENTE',
      EstadoNotificacion: 'PENDIENTE_SINCRONIZACION',
      OfflinePendiente: true,
    },
    asignados: assigned,
    evidencias: [],
    offlineQueued: true,
  };
  const key = responseCacheKey(MODULE_ROUTES.tickets.get, { boletaUid: uid }, sessionToken);
  await cacheResponse(key, detail).catch(() => {});
}

async function queueOfflineWrite(routes, originalPayload, kind, sessionToken) {
  let payload = originalPayload;
  let uid = pick(payload, ['boletaUid', 'BoletaUID', 'id']);
  if (kind === 'create' && !uid) {
    uid = createOfflineId('boleta');
    payload = { ...payload, boletaUid: uid, BoletaUID: uid };
  }
  const dedupeKey = ['create', 'update', 'autosave', 'finalize', 'test', 'pdf'].includes(kind)
    ? `${kind}:${uid}`
    : '';
  const operation = await enqueueOperation({
    routes,
    payload,
    entityId: uid,
    description: offlineDescription(kind),
    dedupeKey,
  });
  if (kind === 'create') await cacheOfflineTicketDetail(payload, sessionToken);
  return queuedResponse(kind, payload, operation);
}

export async function replayQueuedOperation(operation, sessionToken = '') {
  let lastError;
  for (const route of operation.routes || []) {
    try {
      return await requestRouteWithRetry(route, operation.payload || {}, sessionToken);
    } catch (error) {
      lastError = error;
      if (!isMissingRouteError(error)) throw error;
    }
  }
  throw lastError || new Error('La operación pendiente ya no está disponible en el backend.');
}

export async function requestAvailable(routes, payload = {}, sessionToken = '') {
  const candidates = Array.isArray(routes) ? routes : [routes];
  const read = isReadRoute(candidates);
  const writeKind = offlineWriteKind(candidates);
  const cacheKey = read ? responseCacheKey(candidates, payload, sessionToken) : '';
  const browserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;

  if (browserOffline) {
    if (read) {
      const cached = await readOfflineResponse(candidates, payload, sessionToken, cacheKey);
      if (cached !== null) {
        window.dispatchEvent(new CustomEvent('dms-offline-cache-used'));
        return cached;
      }
      throw new Error('Sin conexión y todavía no hay datos guardados para esta sección. Conecte el dispositivo una vez para descargar la base operativa.');
    }
    if (writeKind) return queueOfflineWrite(candidates, payload, writeKind, sessionToken);
  }

  let lastError;
  for (const route of candidates) {
    try {
      const result = await requestRouteWithRetry(route, payload, sessionToken);
      if (read) await cacheResponse(cacheKey, result).catch(() => {});
      return result;
    } catch (error) {
      lastError = error;
      if (isMissingRouteError(error)) continue;
      if (isNetworkError(error)) {
        if (read) {
          const cached = await readOfflineResponse(candidates, payload, sessionToken, cacheKey);
          if (cached !== null) {
            window.dispatchEvent(new CustomEvent('dms-offline-cache-used'));
            return cached;
          }
        }
        if (writeKind) return queueOfflineWrite(candidates, payload, writeKind, sessionToken);
      }
      throw error;
    }
  }

  throw lastError || new Error('La operación todavía no está disponible en el backend.');
}

export async function preloadOfflineCatalogs(sessionToken = '') {
  if (!sessionToken || (typeof navigator !== 'undefined' && navigator.onLine === false)) return [];
  const jobs = [
    MODULE_ROUTES.clients.list,
    MODULE_ROUTES.clients.locationsList,
    MODULE_ROUTES.clients.equipmentLocationsList,
    MODULE_ROUTES.clients.contactsList,
    MODULE_ROUTES.categories.list,
    MODULE_ROUTES.failureTypes.list,
    MODULE_ROUTES.deviceTypes.list,
    MODULE_ROUTES.manufacturers.list,
    MODULE_ROUTES.models.list,
    MODULE_ROUTES.deviceManufacturers.list,
    MODULE_ROUTES.users.list,
  ];
  return Promise.allSettled(jobs.map((routes) => requestAvailable(routes, OFFLINE_CATALOG_PAYLOAD, sessionToken)));
}
