import { calendarMonthRange, monthKey } from '../features/agenda/agendaDomain';
import { MAINTENANCE_LIST_PAGE_SIZE, maintenanceListPayload } from '../features/maintenance/maintenanceListDomain';
import { MODULE_ROUTES, requestAvailable } from './moduleApi';

const TICKET_PAGE_SIZE = 50;
const KNOWLEDGE_PAGE_SIZE = 30;
const IDLE_DATA_CONCURRENCY = 2;
const inflight = new Map();

function onlineAndWorthPrefetching() {
  if (typeof navigator === 'undefined') return true;
  if (navigator.onLine === false) return false;
  if (navigator.connection?.saveData) return false;
  return true;
}

function once(key, operation) {
  if (!key || inflight.has(key)) return inflight.get(key) || Promise.resolve(null);
  const promise = Promise.resolve()
    .then(operation)
    .catch(() => null)
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

function ticketPayload(status, userId, ticketListAdmin) {
  return {
    page: 1,
    pageSize: TICKET_PAGE_SIZE,
    search: '',
    estado: status === 'FINALIZADA' ? 'FINALIZADO' : status,
    status,
    dateFrom: '',
    dateTo: '',
    clienteId: '',
    categoriaId: '',
    tipoDispositivoId: '',
    fabricanteId: '',
    modeloId: '',
    asignadoUsuarioId: ticketListAdmin ? '' : String(userId || ''),
    sortBy: 'Fecha',
    sortDir: 'desc',
  };
}

function agendaPreload(sessionToken, isAdmin) {
  const range = calendarMonthRange(monthKey());
  if (!range.from || !range.to) return Promise.resolve(null);
  return once(`agenda|${range.from}|${range.to}|${sessionToken}|${isAdmin}`, async () => {
    const jobs = [
      requestAvailable(['agenda.list', 'agendas.list'], { from: range.from, to: range.to }, sessionToken),
    ];
    if (isAdmin) {
      jobs.push(
        requestAvailable(['users.assignment.list', 'users.list'], { pageSize: 1000 }, sessionToken),
        requestAvailable(MODULE_ROUTES.config.get, { section: 'AGENDA_TICKET_EXCEPTIONS' }, sessionToken),
      );
    }
    return Promise.allSettled(jobs);
  });
}

function knowledgePreload(sessionToken, canManageKnowledge) {
  return once(`knowledge|${sessionToken}|${canManageKnowledge}`, () => Promise.allSettled([
    requestAvailable(MODULE_ROUTES.knowledgeCategories.list, {
      page: 1,
      pageSize: 300,
      activo: true,
      sortBy: 'Nombre',
      sortDir: 'asc',
    }, sessionToken),
    requestAvailable(MODULE_ROUTES.knowledge.list, {
      page: 1,
      pageSize: KNOWLEDGE_PAGE_SIZE,
      search: '',
      categoriaId: '',
      autorUsuarioId: '',
      includeDrafts: canManageKnowledge,
      sortBy: 'FechaActualizacion',
      sortDir: 'desc',
    }, sessionToken),
  ]));
}

export function preloadNavigationData(pathname, {
  sessionToken = '',
  userId = '',
  isAdmin = false,
  ticketListAdmin = isAdmin,
  canManageKnowledge = isAdmin,
} = {}) {
  if (!sessionToken || !onlineAndWorthPrefetching()) return Promise.resolve(null);
  const path = String(pathname || '/').split('?')[0];

  if (path === '/agenda') return agendaPreload(sessionToken, isAdmin);
  if (path === '/conocimiento') return knowledgePreload(sessionToken, canManageKnowledge);

  if (path === '/boletas/pendientes') {
    const payload = ticketPayload('PENDIENTE', userId, ticketListAdmin);
    return once(`${path}|${sessionToken}|${userId}|${ticketListAdmin}`, () => requestAvailable(MODULE_ROUTES.tickets.list, payload, sessionToken));
  }

  if (path === '/boletas/finalizadas') {
    const payload = ticketPayload('FINALIZADA', userId, ticketListAdmin);
    return once(`${path}|${sessionToken}|${userId}|${ticketListAdmin}`, () => requestAvailable(MODULE_ROUTES.tickets.list, payload, sessionToken));
  }

  if (path === '/mantenimientos') {
    const payload = maintenanceListPayload({
      page: 1,
      pageSize: MAINTENANCE_LIST_PAGE_SIZE,
      status: 'PENDIENTE',
      search: '',
      filters: {},
    });
    return once(`${path}|${sessionToken}`, () => requestAvailable(MODULE_ROUTES.maintenance.list, payload, sessionToken));
  }

  if (path === '/clientes') {
    const payload = {
      page: 1,
      pageSize: 50,
      search: '',
      includeInactive: isAdmin,
      sortBy: 'Nombre',
      sortDir: 'asc',
    };
    return once(`${path}|${sessionToken}|${isAdmin}`, () => requestAvailable(MODULE_ROUTES.clients.list, payload, sessionToken));
  }

  return Promise.resolve(null);
}

/**
 * Calienta en segundo plano los mismos payloads que usarán las pantallas al
 * abrirse. Se limita a dos trabajos simultáneos para no convertir la mejora de
 * arranque en una ráfaga de solicitudes contra Google Sheets.
 */
export async function preloadNavigationDataBatch(pathnames = [], context = {}) {
  if (!context.sessionToken || !onlineAndWorthPrefetching()) return [];
  const paths = [...new Set(pathnames.map((path) => String(path || '').split('?')[0]).filter(Boolean))];
  if (!paths.length) return [];

  const results = new Array(paths.length);
  let cursor = 0;
  async function worker() {
    while (cursor < paths.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = { status: 'fulfilled', value: await preloadNavigationData(paths[index], context) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(IDLE_DATA_CONCURRENCY, paths.length) },
    () => worker(),
  ));
  return results;
}
