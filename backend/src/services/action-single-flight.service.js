import { pick } from '../core/utils.js';

const inFlight = new Map();

function clean(value) {
  return String(value ?? '').trim();
}

function normalizedRoute(route) {
  return clean(route).toLowerCase();
}

function isMaintenanceFinalizeRoute(route) {
  return ['maintenance.finalize', 'mantenimientos.finalize'].includes(normalizedRoute(route));
}

function isTicketGetRoute(route) {
  return ['boletas.get', 'tickets.get'].includes(normalizedRoute(route));
}

function maintenanceFinalizeKey(route, payload = {}, sessionToken = '') {
  if (!isMaintenanceFinalizeRoute(route)) return '';
  const maintenanceId = clean(pick(payload, ['maintenanceId', 'MantenimientoID', 'id']));
  const token = clean(sessionToken);
  if (!maintenanceId || !token) return '';
  const mode = payload?.testMode || payload?.prueba ? 'test' : 'live';
  return `maintenance-finalize:${mode}:${maintenanceId}:${token}`;
}

function ticketGetKey(route, payload = {}, sessionToken = '') {
  if (!isTicketGetRoute(route) || payload?.visitLinkCandidates === true) return '';
  const ticketId = clean(pick(payload, ['boletaUid', 'BoletaUID', 'id']));
  const token = clean(sessionToken);
  if (!ticketId || !token) return '';
  return `ticket-get:${ticketId}:${token}`;
}

export function runWithActionSingleFlight({ route, payload, sessionToken }, operation) {
  if (typeof operation !== 'function') throw new TypeError('operation debe ser una función.');
  const key = maintenanceFinalizeKey(route, payload, sessionToken)
    || ticketGetKey(route, payload, sessionToken);
  if (!key) return operation();

  const current = inFlight.get(key);
  if (current) return current;

  const promise = Promise.resolve()
    .then(operation)
    .finally(() => {
      if (inFlight.get(key) === promise) inFlight.delete(key);
    });
  inFlight.set(key, promise);
  return promise;
}

export function actionSingleFlightSnapshot() {
  let maintenanceFinalizations = 0;
  let ticketReads = 0;
  for (const key of inFlight.keys()) {
    if (key.startsWith('maintenance-finalize:')) maintenanceFinalizations += 1;
    if (key.startsWith('ticket-get:')) ticketReads += 1;
  }
  return {
    total: inFlight.size,
    maintenanceFinalizations,
    ticketReads,
  };
}
