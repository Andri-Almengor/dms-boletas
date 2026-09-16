export const READ_ROUTE_CLASS = Object.freeze({
  DELTA_SYNCED: 'DELTA_SYNCED',
  VERSIONED_CACHE: 'VERSIONED_CACHE',
  ALWAYS_ONLINE: 'ALWAYS_ONLINE',
  MEDIA_STREAM: 'MEDIA_STREAM',
  GENERATED_ARTIFACT: 'GENERATED_ARTIFACT',
  SECURITY_SENSITIVE: 'SECURITY_SENSITIVE',
});

const DELTA_LIST_DETAIL_PREFIXES = Object.freeze([
  'boletas.', 'tickets.',
  'maintenance.', 'mantenimientos.',
  'agenda.', 'agendas.',
  'clients.', 'clientes.',
  'clientLocations.', 'ubicacionesCliente.',
  'equipmentLocations.', 'ubicacionesEquipo.',
  'contacts.', 'contactosCliente.',
  'catalog.categories.', 'categories.', 'categorias.',
  'catalog.deviceTypes.', 'deviceTypes.', 'tiposDispositivo.',
  'catalog.manufacturers.', 'manufacturers.', 'fabricantes.',
  'catalog.models.', 'models.', 'modelos.',
  'catalog.failureTypes.', 'failureTypes.', 'tiposFalla.',
  'catalog.deviceManufacturers.', 'deviceManufacturers.', 'tipoDispositivoFabricantes.',
  'catalog.operational.categories.',
  'catalog.operational.deviceTypes.',
  'catalog.operational.manufacturers.',
  'catalog.operational.models.',
  'catalog.operational.failureTypes.',
  'catalog.operational.deviceManufacturers.',
  'customerCases.', 'casos.cliente.',
  'knowledge.', 'baseConocimientos.', 'conocimiento.', 'tutorials.',
  'categoriasConocimiento.',
]);

const SECURITY_PREFIXES = Object.freeze([
  'auth.', 'users.', 'roles.',
  'ticket.signature.public.', 'boletas.firma.publica.',
  'maintenance.signature.public.', 'mantenimientos.firma.publica.',
]);

const SECURITY_ROUTES = new Set([
  'ticket.signature.link', 'boletas.signature.link', 'boletas.firma.enlace',
  'maintenance.signature.link', 'mantenimientos.firma.enlace',
  'maintenance.signature.test.link', 'mantenimientos.firma.prueba.enlace',
  'customerCases.public.get', 'casos.cliente.public.get',
  'survey.public.get', 'encuesta.publica.get',
]);

const GENERATED_ROUTES = new Set([
  'boletas.generatePdf', 'tickets.generatePdf',
  'maintenance.report.spreadsheet', 'mantenimientos.reporte.excel',
  'maintenance.report.slides', 'mantenimientos.reporte.presentacion',
]);

const ALWAYS_ONLINE_ROUTES = new Set([
  'config.get', 'app.config.get',
  'assistant.chat', 'asistente.chat',
  'metrics.tickets.get', 'metricas.boletas.get',
  'metrics.maintenance.get', 'metricas.mantenimientos.get',
  'legacy.tickets.preview', 'migracion.boletas.previsualizar',
  'survey.questions.list', 'encuestas.preguntas.list',
  'survey.responses.list', 'encuestas.respuestas.list',
  'survey.responses.get', 'encuestas.respuestas.get',
  'clients.relations.get', 'clientes.relaciones.get',
  'customerCases.clientLink.get', 'casos.cliente.enlace.get',
  'maintenance.questions.list', 'mantenimientos.preguntas.list', 'catalog.maintenanceQuestions.list',
  'maintenance.config', 'mantenimientos.config',
]);

function clean(route) {
  return String(route || '').trim();
}

function isMediaRoute(route) {
  return /\.media\.get$/i.test(route);
}

function isDeltaListOrDetail(route) {
  if (!/\.(list|get)$/.test(route)) return false;
  if (ALWAYS_ONLINE_ROUTES.has(route) || SECURITY_ROUTES.has(route)) return false;
  return DELTA_LIST_DETAIL_PREFIXES.some((prefix) => route.startsWith(prefix));
}

export function classifyReadRoute(route) {
  const value = clean(route);
  if (!value) return null;
  if (isMediaRoute(value)) return READ_ROUTE_CLASS.MEDIA_STREAM;
  if (GENERATED_ROUTES.has(value)) return READ_ROUTE_CLASS.GENERATED_ARTIFACT;
  if (SECURITY_ROUTES.has(value) || SECURITY_PREFIXES.some((prefix) => value.startsWith(prefix))) {
    return READ_ROUTE_CLASS.SECURITY_SENSITIVE;
  }
  if (isDeltaListOrDetail(value)) return READ_ROUTE_CLASS.DELTA_SYNCED;
  if (ALWAYS_ONLINE_ROUTES.has(value)) return READ_ROUTE_CLASS.ALWAYS_ONLINE;
  return null;
}

export const readRouteInventory = Object.freeze({
  [READ_ROUTE_CLASS.DELTA_SYNCED]: Object.freeze([
    'boletas.list/get + tickets.list/get',
    'maintenance.list/get + mantenimientos.list/get',
    'agenda.list/get + agendas.list/get',
    'clients/clientLocations/equipmentLocations/contacts list/get and aliases',
    'catalog categories/deviceTypes/manufacturers/models/failureTypes/deviceManufacturers list/get and aliases',
    'customerCases.list/get + casos.cliente.list/get',
    'knowledge articles/categories list/get and aliases',
  ]),
  [READ_ROUTE_CLASS.VERSIONED_CACHE]: Object.freeze([]),
  [READ_ROUTE_CLASS.ALWAYS_ONLINE]: Object.freeze([
    'runtime config', 'assistant', 'metrics', 'legacy preview', 'survey administration',
    'client relation aggregate', 'customer-case client-link status', 'maintenance questions/config',
  ]),
  [READ_ROUTE_CLASS.MEDIA_STREAM]: Object.freeze([
    '*.media.get for tickets, maintenance, customer cases and knowledge',
  ]),
  [READ_ROUTE_CLASS.GENERATED_ARTIFACT]: Object.freeze([
    'ticket PDF', 'maintenance spreadsheet/slides reports',
  ]),
  [READ_ROUTE_CLASS.SECURITY_SENSITIVE]: Object.freeze([
    'auth/users/roles', 'public signing payloads and signing links', 'public case/survey token reads',
  ]),
});
