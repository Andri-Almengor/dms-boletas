import { MAINTENANCE_LIST_PAGE_SIZE, maintenanceListPayload } from '../features/maintenance/maintenanceListDomain';
import { MODULE_ROUTES, requestAvailable } from './moduleApi';

const TICKET_PAGE_SIZE = 50;
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

function ticketPayload(status, userId, isAdmin) {
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
    asignadoUsuarioId: isAdmin ? '' : String(userId || ''),
    sortBy: 'Fecha',
    sortDir: 'desc',
  };
}

export function preloadNavigationData(pathname, {
  sessionToken = '',
  userId = '',
  isAdmin = false,
} = {}) {
  if (!sessionToken || !onlineAndWorthPrefetching()) return Promise.resolve(null);
  const path = String(pathname || '/').split('?')[0];

  if (path === '/boletas/pendientes') {
    const payload = ticketPayload('PENDIENTE', userId, isAdmin);
    return once(`${path}|${sessionToken}|${userId}|${isAdmin}`, () => requestAvailable(MODULE_ROUTES.tickets.list, payload, sessionToken));
  }

  if (path === '/boletas/finalizadas') {
    const payload = ticketPayload('FINALIZADA', userId, isAdmin);
    return once(`${path}|${sessionToken}|${userId}|${isAdmin}`, () => requestAvailable(MODULE_ROUTES.tickets.list, payload, sessionToken));
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
