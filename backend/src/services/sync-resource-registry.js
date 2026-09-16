import { pick } from '../core/utils.js';

export const SYNC_MUTATION_CLASS = Object.freeze({
  SYNC_RESOURCE: 'SYNC_RESOURCE',
  SECURITY_INVALIDATION: 'SECURITY_INVALIDATION',
  NO_SYNC_REQUIRED: 'NO_SYNC_REQUIRED',
});

const TICKET_MUTATIONS = new Set([
  'boletas.create', 'tickets.create',
  'boletas.update', 'tickets.update',
  'boletas.autosave',
  'boletas.finalize', 'tickets.finalize',
  'boletas.returnPending', 'boletas.annul',
  'boletas.evidence.upload', 'tickets.evidence.upload',
  'boletas.evidence.update', 'tickets.evidence.update',
  'boletas.evidence.delete', 'tickets.evidence.delete',
  'boletas.signature.upload',
]);

const TICKET_GROUP_MUTATIONS = new Set([
  'boletas.create', 'tickets.create',
  'boletas.finalize', 'tickets.finalize',
  'boletas.returnPending',
  'boletas.signature.upload',
]);

const PUBLIC_SIGNATURE_MUTATIONS = new Set([
  'ticket.signature.public.submit', 'boletas.firma.publica.guardar',
  'maintenance.signature.public.submit', 'mantenimientos.firma.publica.guardar',
]);

const TICKET_LARGE_CHUNKS = new Set([
  'boletas.evidence.large.chunk', 'tickets.evidence.large.chunk',
]);

const MAINTENANCE_MUTATIONS = new Set([
  'maintenance.create', 'mantenimientos.create',
  'maintenance.update', 'mantenimientos.update',
  'maintenance.update.locations', 'mantenimientos.update.ubicaciones',
  'maintenance.locations.update', 'mantenimientos.ubicaciones.actualizar',
  'maintenance.delete', 'mantenimientos.delete',
  'maintenance.finalize', 'mantenimientos.finalize',
  'maintenance.reopen', 'mantenimientos.reopen',
  'maintenance.devices.create', 'mantenimientos.dispositivos.create',
  'maintenance.devices.update', 'mantenimientos.dispositivos.update',
  'maintenance.devices.autosave', 'mantenimientos.dispositivos.autosave',
  'maintenance.devices.delete', 'mantenimientos.dispositivos.delete',
  'maintenance.images.upload', 'mantenimientos.imagenes.upload',
  'maintenance.images.uploadBatch', 'mantenimientos.imagenes.subirLote',
  'maintenance.images.update', 'mantenimientos.imagenes.update',
  'maintenance.images.updateBatch', 'mantenimientos.imagenes.actualizarLote',
  'maintenance.images.delete', 'mantenimientos.imagenes.delete',
]);

const MAINTENANCE_LARGE_CHUNKS = new Set([
  'maintenance.images.large.chunk', 'mantenimientos.imagenes.grande.bloque',
]);

const AGENDA_MUTATIONS = new Set([
  'agenda.create', 'agendas.create', 'agenda.update', 'agendas.update',
]);

const SECURITY_MUTATIONS = new Set([
  'users.create', 'users.update', 'users.password.reset', 'users.resetPassword',
  'usuarios.contrasena.restablecer', 'auth.changePassword', 'auth.change-password',
]);

// Keep the most-specific client aliases before clients./clientes. so nested
// resources cannot be swallowed by the generic client prefix. Operational
// aliases use the same aggregate as their administrative counterparts.
const RESOURCE_PREFIXES = Object.freeze([
  {
    prefixes: [
      'clientLocations.', 'clients.locations.', 'clientes.ubicaciones.', 'ubicacionesCliente.',
      'clients.operational.locations.', 'clientLocations.operational.',
      'clientes.ubicaciones.operational.', 'ubicacionesCliente.operational.',
    ],
    resource: 'clientLocation',
  },
  {
    prefixes: [
      'equipmentLocations.', 'clients.equipmentLocations.', 'clientes.ubicacionesEquipo.', 'ubicacionesEquipo.',
      'clients.operational.equipmentLocations.', 'equipmentLocations.operational.',
      'clientes.ubicacionesEquipo.operational.', 'ubicacionesEquipo.operational.',
    ],
    resource: 'equipmentLocation',
  },
  {
    prefixes: [
      'contacts.', 'clients.contacts.', 'clientes.contactos.', 'contactosCliente.',
      'clients.operational.contacts.', 'contacts.operational.',
      'clientes.contactos.operational.', 'contactosCliente.operational.',
    ],
    resource: 'contact',
  },
  { prefixes: ['catalog.categories.', 'catalog.operational.categories.', 'categories.', 'categorias.'], resource: 'catalogCategory' },
  { prefixes: ['catalog.deviceTypes.', 'catalog.operational.deviceTypes.', 'deviceTypes.', 'tiposDispositivo.'], resource: 'deviceType' },
  { prefixes: ['catalog.manufacturers.', 'catalog.operational.manufacturers.', 'manufacturers.', 'fabricantes.'], resource: 'manufacturer' },
  { prefixes: ['catalog.models.', 'catalog.operational.models.', 'models.', 'modelos.'], resource: 'model' },
  { prefixes: ['catalog.failureTypes.', 'catalog.operational.failureTypes.', 'failureTypes.', 'tiposFalla.'], resource: 'failureType' },
  { prefixes: ['catalog.deviceManufacturers.', 'catalog.operational.deviceManufacturers.', 'deviceManufacturers.', 'tipoDispositivoFabricantes.'], resource: 'deviceManufacturerRelation' },
  { prefixes: ['clients.', 'clientes.'], resource: 'client' },
  { prefixes: ['customerCases.', 'casos.cliente.'], resource: 'customerCase' },
  { prefixes: ['knowledge.', 'baseConocimientos.', 'conocimiento.', 'tutorials.'], resource: 'knowledgeArticle' },
]);

const RESOURCE_ENTITY_KEYS = Object.freeze({
  client: ['ClienteID', 'clienteId', 'clientId', 'id'],
  clientLocation: ['UbicacionID', 'ubicacionId', 'locationId', 'id'],
  equipmentLocation: ['UbicacionEquipoID', 'ubicacionEquipoId', 'equipmentLocationId', 'id'],
  contact: ['ContactoID', 'contactoId', 'contactId', 'id'],
  catalogCategory: ['CategoriaID', 'categoriaId', 'categoryId', 'id'],
  deviceType: ['TipoDispositivoID', 'tipoDispositivoId', 'deviceTypeId', 'id'],
  manufacturer: ['FabricanteID', 'fabricanteId', 'manufacturerId', 'id'],
  model: ['ModeloID', 'modeloId', 'modelId', 'id'],
  failureType: ['TipoFallaID', 'tipoFallaId', 'failureTypeId', 'id'],
  deviceManufacturerRelation: ['RelacionID', 'relacionId', 'relationshipId', 'id'],
  customerCase: ['CasoID', 'casoId', 'caseId', 'id'],
  knowledgeArticle: ['TutorialID', 'tutorialId', 'ArticuloID', 'articleId', 'id'],
  knowledgeCategory: ['CategoriaConocimientoID', 'categoriaConocimientoId', 'CategoriaID', 'categoriaId', 'id'],
});

function clean(value) {
  return String(value ?? '').trim();
}

function resultEntityId(result, keys = []) {
  const sources = [
    result?.boleta,
    result?.ticket,
    result?.maintenance,
    result?.mantenimiento,
    result?.item,
    result?.record,
    result,
  ].filter(Boolean);
  for (const source of sources) {
    const value = pick(source, keys, '');
    if (clean(value)) return clean(value);
  }
  return '';
}

function ticketEntityId(payload = {}, result = {}) {
  return resultEntityId(result, ['BoletaUID', 'boletaUid', 'uid', 'id'])
    || clean(pick(payload, ['boletaUid', 'BoletaUID', 'ticketId', 'id'], ''))
    || clean(result?.BoletaUID)
    || clean(result?.boleta?.BoletaUID)
    || clean(result?.ticket?.BoletaUID)
    || clean(result?.ticket?.uid);
}

function ticketGroupEntityIds(payload = {}, result = {}) {
  const ids = new Set();
  const primary = ticketEntityId(payload, result);
  if (primary) ids.add(primary);
  const sources = [
    result?.grupoVisitas?.visits,
    result?.ticket?.visits,
    result?.visitasRelacionadas,
  ];
  for (const visits of sources) {
    if (!Array.isArray(visits)) continue;
    for (const visit of visits) {
      const id = clean(pick(visit, ['BoletaUID', 'boletaUid', 'uid', 'id'], ''));
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

function maintenanceEntityId(payload = {}, result = {}) {
  return resultEntityId(result, ['MantenimientoID', 'mantenimientoId', 'maintenanceId', 'uid', 'id'])
    || clean(pick(payload, ['mantenimientoId', 'MantenimientoID', 'maintenanceId', 'id'], ''))
    || clean(result?.maintenance?.MantenimientoID)
    || clean(result?.maintenance?.uid);
}

function genericEntityId(payload = {}, result = {}) {
  const candidate = resultEntityId(result, [
    'ClienteID', 'UbicacionID', 'UbicacionEquipoID', 'ContactoID', 'CategoriaID',
    'TipoDispositivoID', 'FabricanteID', 'ModeloID', 'TipoFallaID', 'RelacionID',
    'CasoID', 'TutorialID', 'CategoriaConocimientoID', 'AgendaID', 'UsuarioID', 'id',
  ]);
  if (candidate) return candidate;
  for (const [key, value] of Object.entries(payload || {})) {
    if (/ID$|Id$|id$/.test(key) && clean(value)) return clean(value);
  }
  return '';
}

function resourceEntityId(resource, payload = {}, result = {}) {
  const keys = RESOURCE_ENTITY_KEYS[resource] || [];
  return resultEntityId(result, keys)
    || clean(pick(payload, keys, ''))
    || genericEntityId(payload, result);
}

function genericMutationOperation(route) {
  return /\.delete$|\.annul$/.test(route) ? 'DELETE' : 'UPSERT';
}

function ticketMutationOperation(route) {
  return route === 'boletas.annul' ? 'DELETE' : 'UPSERT';
}

function maintenanceMutationOperation(route) {
  return route === 'maintenance.delete' || route === 'mantenimientos.delete' ? 'DELETE' : 'UPSERT';
}

function isWriteVerb(route) {
  return /\.(create|update|delete|process|submit|upload|uploadBatch|autosave|finalize|reopen|returnPending|annul|commit)$/.test(route);
}

function metadataFor(route) {
  return { action: clean(route).slice(0, 120) };
}

function classifyPublicSignature(route, result = {}) {
  if (result?.testMode) return { classification: SYNC_MUTATION_CLASS.NO_SYNC_REQUIRED, reason: 'signature_test' };
  const maintenance = result?.maintenance || (result?.ticket?.subjectType === 'maintenance' ? result.ticket : null);
  if (maintenance) {
    return {
      classification: SYNC_MUTATION_CLASS.SYNC_RESOURCE,
      resource: 'maintenance',
      entityId: maintenanceEntityId({}, { maintenance }),
      operation: 'UPSERT',
      metadata: metadataFor(route),
    };
  }
  const entityIds = ticketGroupEntityIds({}, result);
  return {
    classification: SYNC_MUTATION_CLASS.SYNC_RESOURCE,
    resource: 'ticket',
    entityId: entityIds[0] || ticketEntityId({}, result),
    entityIds,
    operation: 'UPSERT',
    metadata: metadataFor(route),
  };
}

export function classifyMutationRoute(route, payload = {}, result = null) {
  const normalizedRoute = clean(route);
  if (!normalizedRoute) return { classification: SYNC_MUTATION_CLASS.NO_SYNC_REQUIRED };

  if (PUBLIC_SIGNATURE_MUTATIONS.has(normalizedRoute)) return classifyPublicSignature(normalizedRoute, result || {});

  if (TICKET_LARGE_CHUNKS.has(normalizedRoute)) {
    if (!result?.completed && !result?.complete && !result?.finalized) {
      return { classification: SYNC_MUTATION_CLASS.NO_SYNC_REQUIRED, reason: 'media_chunk' };
    }
    return {
      classification: SYNC_MUTATION_CLASS.SYNC_RESOURCE,
      resource: 'ticket',
      entityId: ticketEntityId(payload, result),
      operation: 'UPSERT',
      metadata: metadataFor(normalizedRoute),
    };
  }

  if (MAINTENANCE_LARGE_CHUNKS.has(normalizedRoute)) {
    if (!result?.completed && !result?.complete && !result?.finalized) {
      return { classification: SYNC_MUTATION_CLASS.NO_SYNC_REQUIRED, reason: 'media_chunk' };
    }
    return {
      classification: SYNC_MUTATION_CLASS.SYNC_RESOURCE,
      resource: 'maintenance',
      entityId: maintenanceEntityId(payload, result),
      operation: 'UPSERT',
      metadata: metadataFor(normalizedRoute),
    };
  }

  if (TICKET_MUTATIONS.has(normalizedRoute)) {
    if (normalizedRoute === 'boletas.autosave' && result?.throttled) {
      return { classification: SYNC_MUTATION_CLASS.NO_SYNC_REQUIRED, reason: 'autosave_throttled' };
    }
    const entityIds = TICKET_GROUP_MUTATIONS.has(normalizedRoute)
      ? ticketGroupEntityIds(payload, result || {})
      : [];
    return {
      classification: SYNC_MUTATION_CLASS.SYNC_RESOURCE,
      resource: 'ticket',
      entityId: entityIds[0] || ticketEntityId(payload, result),
      entityIds,
      operation: ticketMutationOperation(normalizedRoute),
      metadata: metadataFor(normalizedRoute),
    };
  }

  if (MAINTENANCE_MUTATIONS.has(normalizedRoute)) {
    if (/\.autosave$/.test(normalizedRoute) && result?.throttled) {
      return { classification: SYNC_MUTATION_CLASS.NO_SYNC_REQUIRED, reason: 'autosave_throttled' };
    }
    return {
      classification: SYNC_MUTATION_CLASS.SYNC_RESOURCE,
      resource: 'maintenance',
      entityId: maintenanceEntityId(payload, result),
      operation: maintenanceMutationOperation(normalizedRoute),
      metadata: metadataFor(normalizedRoute),
    };
  }

  if (AGENDA_MUTATIONS.has(normalizedRoute)) {
    return {
      classification: SYNC_MUTATION_CLASS.SYNC_RESOURCE,
      resource: 'agenda',
      entityId: resultEntityId(result, ['AgendaID', 'agendaId', 'id']) || genericEntityId(payload, result),
      operation: genericMutationOperation(normalizedRoute),
      metadata: metadataFor(normalizedRoute),
    };
  }

  if (SECURITY_MUTATIONS.has(normalizedRoute)) {
    return {
      classification: SYNC_MUTATION_CLASS.SECURITY_INVALIDATION,
      resource: 'security',
      entityId: resultEntityId(result, ['UsuarioID', 'userId', 'id']) || genericEntityId(payload, result) || 'global',
      operation: 'INVALIDATE',
      metadata: metadataFor(normalizedRoute),
    };
  }

  for (const entry of RESOURCE_PREFIXES) {
    if (!entry.prefixes.some((prefix) => normalizedRoute.startsWith(prefix))) continue;
    if (!isWriteVerb(normalizedRoute)) return { classification: SYNC_MUTATION_CLASS.NO_SYNC_REQUIRED };
    const resource = entry.resource === 'knowledgeArticle' && /categor/i.test(normalizedRoute)
      ? 'knowledgeCategory'
      : entry.resource;
    return {
      classification: SYNC_MUTATION_CLASS.SYNC_RESOURCE,
      resource,
      entityId: resourceEntityId(resource, payload, result),
      operation: genericMutationOperation(normalizedRoute),
      metadata: metadataFor(normalizedRoute),
    };
  }

  return { classification: SYNC_MUTATION_CLASS.NO_SYNC_REQUIRED };
}

export function mutationIdFrom(payload = {}) {
  return clean(pick(payload, ['MutationID', 'mutationId', 'clientMutationId', 'mutationID'], '')).slice(0, 160);
}

export const syncResourceRegistry = Object.freeze({
  ticket: Object.freeze({ snapshotRoute: 'boletas.list', detailRoute: 'boletas.get', permission: 'BOLETAS_VER' }),
  maintenance: Object.freeze({ snapshotRoute: 'maintenance.list', detailRoute: 'maintenance.get', permissions: ['MANTENIMIENTOS_VER','MANTENIMIENTOS_CREAR','MANTENIMIENTOS_EDITAR','MANTENIMIENTOS_GESTIONAR','BOLETAS_VER'] }),
  agenda: Object.freeze({ snapshotRoute: 'agenda.list', detailRoute: 'agenda.get' }),
  client: Object.freeze({ snapshotRoute: 'clients.list', detailRoute: 'clients.get' }),
  clientLocation: Object.freeze({ snapshotRoute: 'clientLocations.list', detailRoute: 'clientLocations.get' }),
  equipmentLocation: Object.freeze({ snapshotRoute: 'equipmentLocations.list', detailRoute: 'equipmentLocations.get' }),
  contact: Object.freeze({ snapshotRoute: 'contacts.list', detailRoute: 'contacts.get' }),
  catalogCategory: Object.freeze({ snapshotRoute: 'catalog.categories.list', detailRoute: 'catalog.categories.get' }),
  deviceType: Object.freeze({ snapshotRoute: 'catalog.deviceTypes.list', detailRoute: 'catalog.deviceTypes.get' }),
  manufacturer: Object.freeze({ snapshotRoute: 'catalog.manufacturers.list', detailRoute: 'catalog.manufacturers.get' }),
  model: Object.freeze({ snapshotRoute: 'catalog.models.list', detailRoute: 'catalog.models.get' }),
  failureType: Object.freeze({ snapshotRoute: 'catalog.failureTypes.list', detailRoute: 'catalog.failureTypes.get' }),
  deviceManufacturerRelation: Object.freeze({ snapshotRoute: 'catalog.deviceManufacturers.list', detailRoute: 'catalog.deviceManufacturers.get' }),
  customerCase: Object.freeze({ snapshotRoute: 'customerCases.list', detailRoute: 'customerCases.get', permission: 'USUARIOS_GESTIONAR' }),
  knowledgeArticle: Object.freeze({ snapshotRoute: 'knowledge.list', detailRoute: 'knowledge.get' }),
  knowledgeCategory: Object.freeze({ snapshotRoute: 'knowledge.categories.list', detailRoute: 'knowledge.categories.get' }),
});
