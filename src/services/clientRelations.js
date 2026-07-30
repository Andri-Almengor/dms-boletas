import { MODULE_ROUTES, normalizeItems, pick, requestAvailable } from './moduleApi';
import { isMissingRouteError, isNetworkError } from './requestErrors';

const CLIENT_RELATION_ROUTES = ['clients.relations.get', 'clientes.relaciones.get'];
const FALLBACK_PAGE = Object.freeze({ page: 1, pageSize: 1000, includeInactive: false, sortBy: 'Nombre', sortDir: 'asc' });

function fallbackAllowed(error) {
  if (isMissingRouteError(error) || isNetworkError(error)) return true;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const text = String(error?.message || '').toLowerCase();
  return text.includes('sin conexión') || text.includes('datos guardados');
}

function normalizeRelations(data = {}) {
  return {
    locations: normalizeItems(data.locations || data.ubicaciones || []),
    equipment: normalizeItems(data.equipment || data.ubicacionesEquipo || []),
    contacts: normalizeItems(data.contacts || data.contactos || []),
  };
}

async function loadLegacyRelations(clientId, sessionToken, signal) {
  const [locationsData, contactsData, equipmentData] = await Promise.all([
    requestAvailable(MODULE_ROUTES.clients.locationsList, {
      ...FALLBACK_PAGE,
      clienteId: clientId,
      ClienteID: clientId,
    }, sessionToken, { signal }),
    requestAvailable(MODULE_ROUTES.clients.contactsList, {
      ...FALLBACK_PAGE,
      clienteId: clientId,
      ClienteID: clientId,
    }, sessionToken, { signal }),
    requestAvailable(MODULE_ROUTES.clients.equipmentLocationsList, FALLBACK_PAGE, sessionToken, { signal }),
  ]);

  const locations = normalizeItems(locationsData);
  const locationIds = new Set(locations
    .map((row) => String(pick(row, ['UbicacionID', 'ubicacionId', 'id'])))
    .filter(Boolean));

  return {
    locations,
    equipment: normalizeItems(equipmentData).filter((row) => locationIds.has(String(pick(row, ['UbicacionID', 'ubicacionId'])))),
    contacts: normalizeItems(contactsData),
  };
}

export async function fetchClientRelations({ clientId, sessionToken = '', signal } = {}) {
  const normalizedClientId = String(clientId || '').trim();
  if (!normalizedClientId) return { locations: [], equipment: [], contacts: [] };

  try {
    const data = await requestAvailable(CLIENT_RELATION_ROUTES, {
      clienteId: normalizedClientId,
      ClienteID: normalizedClientId,
      includeInactive: false,
    }, sessionToken, { signal });
    return normalizeRelations(data);
  } catch (error) {
    if (!fallbackAllowed(error)) throw error;
    return loadLegacyRelations(normalizedClientId, sessionToken, signal);
  }
}
