import { isAbortError, isMissingRouteError, throwIfAborted } from './requestErrors';

const preferredAliases = new Map();
const MAX_PREFERENCES = 160;

export function normalizeRouteCandidates(routes) {
  return [...new Set((Array.isArray(routes) ? routes : [routes])
    .map((route) => String(route || '').trim())
    .filter(Boolean))];
}

function preferenceKey(candidates) {
  return candidates.join('\u001f');
}

function orderedCandidates(candidates) {
  const preferred = preferredAliases.get(preferenceKey(candidates));
  if (!preferred || !candidates.includes(preferred)) return candidates;
  return [preferred, ...candidates.filter((route) => route !== preferred)];
}

function rememberAlias(candidates, route) {
  const key = preferenceKey(candidates);
  preferredAliases.delete(key);
  preferredAliases.set(key, route);
  if (preferredAliases.size <= MAX_PREFERENCES) return;
  preferredAliases.delete(preferredAliases.keys().next().value);
}

export function clearAliasPreferences() {
  preferredAliases.clear();
}

export function preferredAliasFor(routes) {
  const candidates = normalizeRouteCandidates(routes);
  return preferredAliases.get(preferenceKey(candidates)) || '';
}

export async function requestFirstAvailable(routes, requester, { signal } = {}) {
  const candidates = normalizeRouteCandidates(routes);
  if (!candidates.length) throw new Error('No se definió ninguna ruta para la operación.');
  if (typeof requester !== 'function') throw new TypeError('requester debe ser una función.');

  throwIfAborted(signal);
  let lastMissingError;
  for (const route of orderedCandidates(candidates)) {
    throwIfAborted(signal);
    try {
      const result = await requester(route, { signal });
      rememberAlias(candidates, route);
      return result;
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (!isMissingRouteError(error)) throw error;
      lastMissingError = error;
    }
  }

  throw lastMissingError || new Error('La operación todavía no está disponible en el backend.');
}
