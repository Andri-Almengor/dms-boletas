import { apiRequest } from '../api';
import {
  cacheResponse,
  createOfflineId,
  enqueueOperation,
  getEntityQueueState,
  readCachedResponse,
  responseCacheKey,
  updateCachedResponses,
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

function routesText(routes) {
  return (Array.isArray(routes) ? routes : [routes]).join(' ').toLowerCase();
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
  const text = routesText(routes);
  if (text.includes('boletas.create') || text.includes('tickets.create')) return 'ticketCreate';
  if (text.includes('boletas.autosave')) return 'ticketAutosave';
  if (text.includes('boletas.signature.upload')) return 'ticketSignature';
  if (text.includes('boletas.evidence.upload') || text.includes('tickets.evidence.upload')) return 'ticketEvidence';
  if (text.includes('boletas.evidence.update') || text.includes('tickets.evidence.update')) return 'ticketEvidenceUpdate';
  if (text.includes('boletas.evidence.delete') || text.includes('tickets.evidence.delete')) return 'ticketEvidenceDelete';
  if (text.includes('boletas.finalize') || text.includes('tickets.finalize')) return 'ticketFinalize';
  if (text.includes('boletas.testfinalize') || text.includes('tickets.testfinalize')) return 'ticketTest';
  if (text.includes('boletas.generatepdf') || text.includes('tickets.generatepdf')) return 'ticketPdf';
  if (text.includes('boletas.update') || text.includes('tickets.update')) return 'ticketUpdate';

  if (text.includes('maintenance.create') || text.includes('mantenimientos.create')) return 'maintenanceCreate';
  if (text.includes('maintenance.devices.autosave') || text.includes('mantenimientos.dispositivos.autosave')) return 'maintenanceDeviceAutosave';
  if (text.includes('maintenance.devices.create') || text.includes('mantenimientos.dispositivos.create')) return 'maintenanceDeviceCreate';
  if (text.includes('maintenance.devices.update') || text.includes('mantenimientos.dispositivos.update')) return 'maintenanceDeviceUpdate';
  if (text.includes('maintenance.images.upload') || text.includes('mantenimientos.imagenes.upload')) return 'maintenanceImage';
  if (text.includes('maintenance.images.update') || text.includes('mantenimientos.imagenes.update')) return 'maintenanceImageUpdate';
  if (text.includes('maintenance.images.delete') || text.includes('mantenimientos.imagenes.delete')) return 'maintenanceImageDelete';
  if (text.includes('maintenance.finalize') || text.includes('mantenimientos.finalize')) return 'maintenanceFinalize';
  if (text.includes('maintenance.update') || text.includes('mantenimientos.update')) return 'maintenanceUpdate';
  return '';
}

function isFinalizeKind(kind) {
  return kind === 'ticketFinalize' || kind === 'maintenanceFinalize';
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

function currentUserId() {
  try {
    const stored = JSON.parse(localStorage.getItem('dms_session') || '{}');
    return String(stored?.user?.UsuarioID || stored?.user?.id || '');
  } catch {
    return '';
  }
}

function prepareWritePayload(kind, originalPayload = {}) {
  const payload = { ...originalPayload };
  if (kind === 'ticketCreate' && !pick(payload, ['boletaUid', 'BoletaUID'])) {
    const id = createOfflineId('boleta');
    payload.boletaUid = id;
    payload.BoletaUID = id;
  }
  if (kind === 'ticketEvidence' && !pick(payload, ['evidenciaId', 'EvidenciaID'])) {
    const id = createOfflineId('evidencia');
    payload.evidenciaId = id;
    payload.EvidenciaID = id;
  }
  if (kind === 'maintenanceCreate' && !pick(payload, ['maintenanceId', 'MantenimientoID'])) {
    const id = createOfflineId('mantenimiento');
    payload.maintenanceId = id;
    payload.MantenimientoID = id;
  }
  if (kind === 'maintenanceDeviceCreate' && !pick(payload, ['deviceId', 'EvidenciaMantenimientoID'])) {
    const id = createOfflineId('dispositivo');
    payload.deviceId = id;
    payload.EvidenciaMantenimientoID = id;
  }
  if (kind === 'maintenanceImage' && !pick(payload, ['imageId', 'FotoDispositivoID'])) {
    const id = createOfflineId('foto');
    payload.imageId = id;
    payload.FotoDispositivoID = id;
  }
  return payload;
}

function entityIdFor(kind, payload) {
  if (kind.startsWith('ticket')) return String(pick(payload, ['boletaUid', 'BoletaUID', 'id']));
  if (kind.startsWith('maintenance')) return String(pick(payload, ['maintenanceId', 'MantenimientoID', 'MantenimientoRef']));
  return '';
}

function offlineDescription(kind) {
  const labels = {
    ticketCreate: 'Crear boleta',
    ticketUpdate: 'Actualizar boleta',
    ticketAutosave: 'Autoguardar boleta',
    ticketSignature: 'Subir firma de boleta',
    ticketEvidence: 'Subir evidencia de boleta',
    ticketEvidenceUpdate: 'Editar evidencia de boleta',
    ticketEvidenceDelete: 'Eliminar evidencia de boleta',
    ticketTest: 'Generar prueba de boleta',
    ticketPdf: 'Generar PDF de boleta',
    maintenanceCreate: 'Crear mantenimiento',
    maintenanceUpdate: 'Actualizar mantenimiento',
    maintenanceDeviceCreate: 'Agregar dispositivo al mantenimiento',
    maintenanceDeviceUpdate: 'Actualizar dispositivo del mantenimiento',
    maintenanceDeviceAutosave: 'Autoguardar dispositivo del mantenimiento',
    maintenanceImage: 'Subir evidencia del mantenimiento',
    maintenanceImageUpdate: 'Editar evidencia del mantenimiento',
    maintenanceImageDelete: 'Eliminar evidencia del mantenimiento',
  };
  return labels[kind] || 'Sincronizar cambio';
}

function dedupeKeyFor(kind, payload) {
  const entityId = entityIdFor(kind, payload);
  if (['ticketCreate', 'ticketUpdate', 'ticketAutosave', 'ticketSignature', 'ticketTest', 'ticketPdf', 'maintenanceCreate', 'maintenanceUpdate'].includes(kind)) {
    return `${kind}:${entityId}`;
  }
  if (['ticketEvidence', 'ticketEvidenceUpdate', 'ticketEvidenceDelete'].includes(kind)) {
    return `${kind}:${pick(payload, ['evidenciaId', 'EvidenciaID', 'id'])}`;
  }
  if (['maintenanceDeviceCreate', 'maintenanceDeviceUpdate', 'maintenanceDeviceAutosave'].includes(kind)) {
    return `${kind}:${pick(payload, ['deviceId', 'EvidenciaMantenimientoID'])}`;
  }
  if (['maintenanceImage', 'maintenanceImageUpdate', 'maintenanceImageDelete'].includes(kind)) {
    return `${kind}:${pick(payload, ['imageId', 'FotoDispositivoID'])}`;
  }
  return '';
}

function rebuildCollection(original, items) {
  if (Array.isArray(original)) return items;
  if (Array.isArray(original?.items)) return { ...original, items, total: items.length, page: 1, pageSize: items.length || 1 };
  if (Array.isArray(original?.rows)) return { ...original, rows: items, total: items.length };
  if (Array.isArray(original?.data)) return { ...original, data: items, total: items.length };
  return { items, total: items.length, page: 1, pageSize: items.length || 1 };
}

function upsertBy(items, row, keys) {
  const id = String(pick(row, keys));
  if (!id) return items;
  const index = items.findIndex((item) => String(pick(item, keys)) === id);
  if (index < 0) return [row, ...items];
  return items.map((item, currentIndex) => currentIndex === index ? { ...item, ...row } : item);
}

function removeBy(items, id, keys) {
  return items.filter((item) => String(pick(item, keys)) !== String(id));
}

function cacheRoute(entry) {
  return String(entry?.key || '').split('|')[1]?.toLowerCase() || '';
}

function cachePayload(entry) {
  const parts = String(entry?.key || '').split('|');
  try { return JSON.parse(parts.slice(2).join('|') || '{}'); } catch { return {}; }
}

function ticketRowFromPayload(payload, result) {
  const bundle = result?.boleta ? result : null;
  const server = bundle?.boleta || result?.ticket || result?.boleta || {};
  const uid = String(pick(server, ['BoletaUID'], pick(payload, ['boletaUid', 'BoletaUID'])));
  return {
    ...payload,
    ...server,
    BoletaUID: uid,
    boletaUid: uid,
    BoletaID: pick(server, ['BoletaID'], pick(payload, ['BoletaID'], 'Sin sincronizar')),
    Estado: String(pick(server, ['Estado'], pick(payload, ['Estado', 'estado'], 'PENDIENTE'))).toUpperCase(),
    CreadoPor: pick(server, ['CreadoPor'], pick(payload, ['CreadoPor'], currentUserId())),
    OfflinePendiente: !Object.keys(server).length,
    EstadoNotificacion: Object.keys(server).length ? pick(server, ['EstadoNotificacion'], 'PENDIENTE') : 'PENDIENTE_SINCRONIZACION',
  };
}

async function cacheTicketDetail(row, payload, result, sessionToken) {
  const uid = String(row.BoletaUID);
  const keys = [
    responseCacheKey(MODULE_ROUTES.tickets.get, { boletaUid: uid }, sessionToken),
    responseCacheKey(MODULE_ROUTES.tickets.get, { boletaUid: uid, id: uid }, sessionToken),
  ];
  for (const key of keys) {
    const current = await readCachedResponse(key, 0);
    const bundle = result?.boleta ? result : current || {};
    const assignedIds = payload.AsignadoA || payload.asignados;
    const asignados = Array.isArray(result?.asignados)
      ? result.asignados
      : Array.isArray(assignedIds)
        ? assignedIds.map((UsuarioID) => ({ UsuarioID }))
        : bundle.asignados || [];
    await cacheResponse(key, {
      ...bundle,
      boleta: { ...(bundle.boleta || {}), ...row },
      asignados,
      evidencias: result?.evidencias || bundle.evidencias || [],
      offlineQueued: Boolean(row.OfflinePendiente),
    });
  }
}

async function patchTicketLists(row) {
  await updateCachedResponses(
    (entry) => ['boletas.list', 'tickets.list'].includes(cacheRoute(entry)),
    (data, entry) => {
      const request = cachePayload(entry);
      const status = String(request.status || request.estado || '').toUpperCase();
      let items = normalizeItems(data);
      if (status && status !== String(row.Estado || '').toUpperCase()) {
        items = removeBy(items, row.BoletaUID, ['BoletaUID', 'boletaUid', 'id']);
      } else {
        items = upsertBy(items, row, ['BoletaUID', 'boletaUid', 'id']);
      }
      return rebuildCollection(data, items);
    },
  );
}

function localEvidence(payload, result = {}) {
  const id = String(pick(result, ['EvidenciaID', 'id'], pick(payload, ['evidenciaId', 'EvidenciaID'])));
  const mimeType = pick(result, ['MimeType'], pick(payload, ['mimeType'], 'application/octet-stream'));
  return {
    EvidenciaID: id,
    BoletaUID: pick(payload, ['boletaUid', 'BoletaUID']),
    Nombre: pick(result, ['Nombre'], pick(payload, ['nombre', 'Nombre', 'fileName'], 'Evidencia')),
    Nota: pick(result, ['Nota'], pick(payload, ['nota', 'Nota'])),
    NombreArchivo: pick(result, ['NombreArchivo'], pick(payload, ['fileName'])),
    MimeType: mimeType,
    ArchivoID: pick(result, ['ArchivoID']),
    ArchivoURL: pick(result, ['ArchivoURL'], payload.base64 ? `data:${mimeType};base64,${payload.base64}` : ''),
    OfflinePendiente: !pick(result, ['ArchivoID']),
    Activo: true,
  };
}

async function patchTicketCache(kind, payload, result, sessionToken) {
  const uid = String(pick(payload, ['boletaUid', 'BoletaUID']));
  if (!uid) return;
  if (['ticketCreate', 'ticketUpdate', 'ticketAutosave'].includes(kind)) {
    const row = ticketRowFromPayload(payload, result);
    await cacheTicketDetail(row, payload, result, sessionToken);
    await patchTicketLists(row);
    return;
  }

  const keys = [
    responseCacheKey(MODULE_ROUTES.tickets.get, { boletaUid: uid }, sessionToken),
    responseCacheKey(MODULE_ROUTES.tickets.get, { boletaUid: uid, id: uid }, sessionToken),
  ];
  for (const key of keys) {
    const current = await readCachedResponse(key, 0);
    if (!current) continue;
    let next = { ...current, boleta: { ...(current.boleta || {}) } };
    if (kind === 'ticketSignature') {
      const mimeType = pick(payload, ['mimeType'], 'image/png');
      next.boleta = {
        ...next.boleta,
        FirmaURL: pick(result, ['webViewLink', 'FirmaURL'], payload.base64 ? `data:${mimeType};base64,${payload.base64}` : next.boleta.FirmaURL),
        FirmaArchivoID: pick(result, ['id', 'FirmaArchivoID'], next.boleta.FirmaArchivoID),
        FirmaMimeType: mimeType,
        FirmaOfflinePendiente: !pick(result, ['id', 'FirmaArchivoID']),
      };
    }
    if (kind === 'ticketEvidence') {
      next.evidencias = upsertBy(next.evidencias || [], localEvidence(payload, result), ['EvidenciaID', 'id']);
    }
    if (kind === 'ticketEvidenceUpdate') {
      const evidenceId = pick(payload, ['evidenciaId', 'EvidenciaID', 'id']);
      next.evidencias = (next.evidencias || []).map((item) => String(pick(item, ['EvidenciaID', 'id'])) === String(evidenceId)
        ? { ...item, Nombre: pick(payload, ['nombre', 'Nombre'], item.Nombre), Nota: pick(payload, ['nota', 'Nota'], item.Nota) }
        : item);
    }
    if (kind === 'ticketEvidenceDelete') {
      next.evidencias = removeBy(next.evidencias || [], pick(payload, ['evidenciaId', 'EvidenciaID', 'id']), ['EvidenciaID', 'id']);
    }
    await cacheResponse(key, next);
  }
}

function maintenanceRowFromPayload(payload, result) {
  const bundle = result?.mantenimiento ? result : null;
  const server = bundle?.mantenimiento || result?.maintenance || result?.mantenimiento || {};
  const id = String(pick(server, ['MantenimientoID'], pick(payload, ['maintenanceId', 'MantenimientoID'])));
  return {
    ...payload,
    ...server,
    MantenimientoID: id,
    maintenanceId: id,
    Estado: String(pick(server, ['Estado'], pick(payload, ['Estado', 'estado'], 'PENDIENTE'))).toUpperCase(),
    CreadoPor: pick(server, ['CreadoPor'], pick(payload, ['CreadoPor'], currentUserId())),
    OfflinePendiente: !Object.keys(server).length,
  };
}

async function cacheMaintenanceDetail(row, payload, result, sessionToken) {
  const id = String(row.MantenimientoID);
  const key = responseCacheKey(MODULE_ROUTES.maintenance.get, { maintenanceId: id }, sessionToken);
  const current = await readCachedResponse(key, 0);
  const bundle = result?.mantenimiento ? result : current || {};
  const responsibleIds = payload.ResponsableIDs || payload.responsables;
  await cacheResponse(key, {
    ...bundle,
    mantenimiento: { ...(bundle.mantenimiento || {}), ...row },
    responsables: result?.responsables || (Array.isArray(responsibleIds) ? responsibleIds.map((UsuarioID) => ({ UsuarioID })) : bundle.responsables || []),
    dispositivos: result?.dispositivos || bundle.dispositivos || [],
    offlineQueued: Boolean(row.OfflinePendiente),
  });
}

async function patchMaintenanceLists(row, deviceDelta = 0) {
  await updateCachedResponses(
    (entry) => ['maintenance.list', 'mantenimientos.list'].includes(cacheRoute(entry)),
    (data) => {
      let nextRow = row;
      const existing = normalizeItems(data).find((item) => String(pick(item, ['MantenimientoID', 'maintenanceId', 'id'])) === String(row.MantenimientoID));
      if (existing && deviceDelta) {
        nextRow = { ...existing, ...row, DispositivosRegistrados: Math.max(0, Number(existing.DispositivosRegistrados || 0) + deviceDelta) };
      }
      return rebuildCollection(data, upsertBy(normalizeItems(data), nextRow, ['MantenimientoID', 'maintenanceId', 'id']));
    },
  );
}

function localMaintenanceDevice(payload, result = {}) {
  const id = String(pick(result, ['EvidenciaMantenimientoID', 'deviceId', 'id'], pick(payload, ['deviceId', 'EvidenciaMantenimientoID'])));
  return {
    ...payload,
    ...result,
    EvidenciaMantenimientoID: id,
    MantenimientoRef: pick(payload, ['maintenanceId', 'MantenimientoID', 'MantenimientoRef']),
    Categoria: pick(result, ['Categoria'], pick(payload, ['Categoria', 'TipoDispositivo'])),
    NombreDispositivo: pick(result, ['NombreDispositivo'], pick(payload, ['NombreDispositivo', 'nombre'])),
    Zona: pick(result, ['Zona'], pick(payload, ['Zona', 'zona'])),
    Imagenes: result.Imagenes || [],
    OfflinePendiente: !Object.keys(result).length,
    Activo: true,
  };
}

function localMaintenanceImage(payload, result = {}) {
  const id = String(pick(result, ['FotoDispositivoID', 'imageId', 'id'], pick(payload, ['imageId', 'FotoDispositivoID'])));
  const mimeType = pick(result, ['MimeType'], pick(payload, ['mimeType'], 'image/jpeg'));
  return {
    ...result,
    FotoDispositivoID: id,
    DispositivoMantenimientoRef: pick(payload, ['deviceId', 'DispositivoMantenimientoRef']),
    Tipo: pick(result, ['Tipo'], pick(payload, ['Tipo', 'tipo'], 'Antes')),
    Nota: pick(result, ['Nota'], pick(payload, ['Nota', 'nota'])),
    Nombre: pick(result, ['Nombre'], pick(payload, ['fileName'], 'Evidencia')),
    MimeType: mimeType,
    DriveFileID: pick(result, ['DriveFileID']),
    DriveURL: pick(result, ['DriveURL'], payload.base64 ? `data:${mimeType};base64,${payload.base64}` : ''),
    PreviewURL: pick(result, ['PreviewURL'], payload.base64 ? `data:${mimeType};base64,${payload.base64}` : ''),
    OfflinePendiente: !pick(result, ['DriveFileID']),
    Activo: true,
  };
}

async function patchMaintenanceCache(kind, payload, result, sessionToken) {
  const maintenanceId = String(pick(payload, ['maintenanceId', 'MantenimientoID', 'MantenimientoRef']));
  if (!maintenanceId) return;
  if (['maintenanceCreate', 'maintenanceUpdate'].includes(kind)) {
    const row = maintenanceRowFromPayload(payload, result);
    await cacheMaintenanceDetail(row, payload, result, sessionToken);
    await patchMaintenanceLists(row);
    return;
  }

  const key = responseCacheKey(MODULE_ROUTES.maintenance.get, { maintenanceId }, sessionToken);
  const current = await readCachedResponse(key, 0);
  if (!current) return;
  const row = current.mantenimiento || {};
  let devices = [...(current.dispositivos || [])];

  if (['maintenanceDeviceCreate', 'maintenanceDeviceUpdate', 'maintenanceDeviceAutosave'].includes(kind)) {
    const device = localMaintenanceDevice(payload, result);
    const existed = devices.some((item) => String(pick(item, ['EvidenciaMantenimientoID', 'id'])) === String(device.EvidenciaMantenimientoID));
    devices = upsertBy(devices, device, ['EvidenciaMantenimientoID', 'id']);
    if (!existed) await patchMaintenanceLists(row, 1);
  }
  if (kind === 'maintenanceImage') {
    const image = localMaintenanceImage(payload, result);
    const deviceId = String(image.DispositivoMantenimientoRef);
    devices = devices.map((device) => String(pick(device, ['EvidenciaMantenimientoID', 'id'])) === deviceId
      ? { ...device, Imagenes: upsertBy(device.Imagenes || [], image, ['FotoDispositivoID', 'id']) }
      : device);
  }
  if (kind === 'maintenanceImageUpdate') {
    const imageId = String(pick(payload, ['imageId', 'FotoDispositivoID']));
    devices = devices.map((device) => ({
      ...device,
      Imagenes: (device.Imagenes || []).map((image) => String(pick(image, ['FotoDispositivoID', 'id'])) === imageId
        ? { ...image, Tipo: pick(payload, ['Tipo', 'tipo'], image.Tipo), Nota: pick(payload, ['Nota', 'nota'], image.Nota) }
        : image),
    }));
  }
  if (kind === 'maintenanceImageDelete') {
    const imageId = pick(payload, ['imageId', 'FotoDispositivoID']);
    devices = devices.map((device) => ({ ...device, Imagenes: removeBy(device.Imagenes || [], imageId, ['FotoDispositivoID', 'id']) }));
  }
  await cacheResponse(key, { ...current, dispositivos: devices, offlineQueued: true });
}

async function applyOperationToCache(kind, payload, result, sessionToken) {
  if (kind.startsWith('ticket')) return patchTicketCache(kind, payload, result, sessionToken);
  if (kind.startsWith('maintenance')) return patchMaintenanceCache(kind, payload, result, sessionToken);
  return undefined;
}

function filterMasterCatalog(data, routes, payload) {
  const routeText = routesText(routes);
  let items = normalizeItems(data);
  if (payload.activo !== undefined) {
    items = items.filter((row) => String(row.Activo ?? true).toLowerCase() === String(payload.activo).toLowerCase()
      && String(row.Estado || 'ACTIVO').toUpperCase() !== 'INACTIVO');
  }
  if (routeText.includes('location') || routeText.includes('ubicacion')) {
    if (routeText.includes('equipment') || routeText.includes('ubicacionesequipo')) {
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

  const routeText = routesText(routes);
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
  if (kind.startsWith('ticket')) {
    const uid = pick(payload, ['boletaUid', 'BoletaUID']);
    if (['ticketCreate', 'ticketUpdate', 'ticketAutosave'].includes(kind)) {
      return { boleta: ticketRowFromPayload(payload, null), asignados: [], evidencias: [], offlineQueued: true, operationId: operation.id };
    }
    if (kind === 'ticketEvidence') return localEvidence(payload);
    return { ok: true, offlineQueued: true, boletaUid: uid, operationId: operation.id };
  }
  if (kind.startsWith('maintenance')) {
    const maintenanceId = pick(payload, ['maintenanceId', 'MantenimientoID']);
    if (['maintenanceCreate', 'maintenanceUpdate'].includes(kind)) {
      return { mantenimiento: maintenanceRowFromPayload(payload, null), responsables: [], dispositivos: [], offlineQueued: true, operationId: operation.id };
    }
    if (['maintenanceDeviceCreate', 'maintenanceDeviceUpdate', 'maintenanceDeviceAutosave'].includes(kind)) return localMaintenanceDevice(payload);
    if (kind === 'maintenanceImage') return localMaintenanceImage(payload);
    return { ok: true, offlineQueued: true, maintenanceId, operationId: operation.id };
  }
  return { ok: true, offlineQueued: true, operationId: operation.id };
}

async function queueOfflineWrite(routes, payload, kind, sessionToken) {
  if (isFinalizeKind(kind)) {
    throw new Error('Primero debe sincronizar todos los cambios. La opción de finalizar estará disponible cuando la boleta o el mantenimiento exista completamente en el servidor.');
  }
  const entityId = entityIdFor(kind, payload);
  const operation = await enqueueOperation({
    routes,
    payload,
    entityId,
    description: offlineDescription(kind),
    dedupeKey: dedupeKeyFor(kind, payload),
    kind,
  });
  await applyOperationToCache(kind, payload, null, sessionToken).catch(() => {});
  return queuedResponse(kind, payload, operation);
}

async function assertCanFinalize(kind, payload) {
  if (!isFinalizeKind(kind)) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('No es posible finalizar sin internet. Guarde los cambios y espere a que la sincronización termine.');
  }
  const state = await getEntityQueueState(entityIdFor(kind, payload));
  if (state.pending) {
    throw new Error(`Todavía hay ${state.pending} cambio${state.pending === 1 ? '' : 's'} pendiente${state.pending === 1 ? '' : 's'} de sincronización. La finalización se habilitará automáticamente cuando termine.`);
  }
}

export async function replayQueuedOperation(operation, sessionToken = '') {
  let lastError;
  for (const route of operation.routes || []) {
    try {
      const result = await requestRouteWithRetry(route, operation.payload || {}, sessionToken);
      await applyOperationToCache(operation.kind || offlineWriteKind(operation.routes), operation.payload || {}, result, sessionToken).catch(() => {});
      return result;
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
  const preparedPayload = writeKind ? prepareWritePayload(writeKind, payload) : payload;
  const cacheKey = read ? responseCacheKey(candidates, preparedPayload, sessionToken) : '';
  const browserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;

  await assertCanFinalize(writeKind, preparedPayload);

  if (browserOffline) {
    if (read) {
      const cached = await readOfflineResponse(candidates, preparedPayload, sessionToken, cacheKey);
      if (cached !== null) {
        window.dispatchEvent(new CustomEvent('dms-offline-cache-used'));
        return cached;
      }
      throw new Error('Sin conexión y todavía no hay datos guardados para esta sección. Conecte el dispositivo una vez para descargar la base operativa.');
    }
    if (writeKind) return queueOfflineWrite(candidates, preparedPayload, writeKind, sessionToken);
  }

  let lastError;
  for (const route of candidates) {
    try {
      const result = await requestRouteWithRetry(route, preparedPayload, sessionToken);
      if (read) await cacheResponse(cacheKey, result).catch(() => {});
      if (writeKind) await applyOperationToCache(writeKind, preparedPayload, result, sessionToken).catch(() => {});
      return result;
    } catch (error) {
      lastError = error;
      if (isMissingRouteError(error)) continue;
      if (isNetworkError(error)) {
        if (read) {
          const cached = await readOfflineResponse(candidates, preparedPayload, sessionToken, cacheKey);
          if (cached !== null) {
            window.dispatchEvent(new CustomEvent('dms-offline-cache-used'));
            return cached;
          }
        }
        if (writeKind) return queueOfflineWrite(candidates, preparedPayload, writeKind, sessionToken);
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
