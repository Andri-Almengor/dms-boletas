import { apiRequest } from '../api';

export const MODULE_ROUTES = {
  tickets: {
    list: ['boletas.list', 'tickets.list'],
    get: ['boletas.get', 'tickets.get'],
    create: ['boletas.create', 'tickets.create'],
    update: ['boletas.update', 'tickets.update'],
    finalize: ['boletas.finalize', 'tickets.finalize', 'boletas.update', 'tickets.update'],
  },
  clients: {
    list: ['clients.list', 'clientes.list'],
    create: ['clients.create', 'clientes.create'],
    update: ['clients.update', 'clientes.update'],
  },
  categories: {
    list: ['categories.list', 'categorias.list'],
    create: ['categories.create', 'categorias.create'],
    update: ['categories.update', 'categorias.update'],
  },
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

function isMissingRouteError(error) {
  const text = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
  return text.includes('route')
    || text.includes('ruta')
    || text.includes('not_found')
    || text.includes('no encontrada')
    || text.includes('unknown action');
}

export async function requestAvailable(routes, payload = {}, sessionToken = '') {
  let lastError;
  for (const route of routes) {
    try {
      return await apiRequest(route, payload, sessionToken);
    } catch (error) {
      lastError = error;
      if (!isMissingRouteError(error)) throw error;
    }
  }
  throw lastError || new Error('La operación todavía no está disponible en el backend.');
}
