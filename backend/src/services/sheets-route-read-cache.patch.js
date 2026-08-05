import { AsyncLocalStorage } from 'node:async_hooks';
import { sheetsApi } from '../infra/google.js';

const INSTALL_FLAG = Symbol.for('dms.sheetsRouteReadCachePatch');
const routeStorage = new AsyncLocalStorage();
const responseCache = new Map();
const inflightReads = new Map();

const MAX_CACHE_ENTRIES = 320;
const ASSISTANT_OPERATIONAL_TTL_MS = 60_000;
const ASSISTANT_CATALOG_TTL_MS = 10 * 60_000;
const PASSWORD_VAULT_TTL_MS = 5 * 60_000;
const PASSWORD_VAULT_CLIENTS_TTL_MS = 2 * 60_000;
const METADATA_TTL_MS = 10 * 60_000;

const ASSISTANT_ROUTES = new Set(['assistant.chat', 'asistente.chat']);
const PASSWORD_VAULT_PREFIXES = Object.freeze(['passwordVault.', 'credenciales.']);

const PASSWORD_VAULT_SHEETS = new Set([
  'CategoriasCredenciales',
  'CredencialesClientes',
]);

const ASSISTANT_CATALOG_SHEETS = new Set([
  'Clientes',
  'Configuracion',
  'CategoriasCredenciales',
  'Fabricantes',
  'Modelos',
  'TiposDispositivo',
  'TipoDispositivoFabricantes',
  'KnowledgeCategories',
  'KnowledgeArticleCategories',
]);

const ASSISTANT_OPERATIONAL_SHEETS = new Set([
  'Boletas',
  'Mantenimiento',
  'Evidencia_Mantenimientos',
  'Mantenimiento imagenes',
  'CasosClientes',
  'Encuestas',
  'EncuestaRespuestas',
  'KnowledgeArticles',
  'ClienteUbicaciones',
  'ClienteUbicacionesEquipo',
]);

const stats = {
  cacheHits: 0,
  inflightHits: 0,
  apiReads: 0,
  selectiveInvalidations: 0,
  fullInvalidations: 0,
};

function routeProfile(route) {
  const value = String(route || '').trim();
  if (ASSISTANT_ROUTES.has(value)) return 'assistant';
  if (PASSWORD_VAULT_PREFIXES.some((prefix) => value.startsWith(prefix))) return 'password-vault';
  return '';
}

function stableKey(profile, method, args) {
  let serialized;
  try {
    serialized = JSON.stringify(args || {});
  } catch {
    serialized = String(args || '');
  }
  return `${profile}|${method}|${serialized}`;
}

function sheetNameFromRange(range) {
  const value = String(range || '').trim();
  const separator = value.indexOf('!');
  if (separator < 0) return value || '';
  const raw = value.slice(0, separator).trim();
  if (raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1).replace(/''/g, "'");
  }
  return raw;
}

function readSheetNames(method, args = {}) {
  if (method === 'spreadsheets.get') return new Set(['*metadata*']);
  if (method === 'spreadsheets.values.get') {
    return new Set([sheetNameFromRange(args.range)].filter(Boolean));
  }
  if (method === 'spreadsheets.values.batchGet') {
    return new Set((args.ranges || []).map(sheetNameFromRange).filter(Boolean));
  }
  return new Set();
}

function writeSheetNames(method, args = {}) {
  if (['spreadsheets.values.append', 'spreadsheets.values.update', 'spreadsheets.values.clear'].includes(method)) {
    const name = sheetNameFromRange(args.range);
    return name ? new Set([name]) : null;
  }
  if (method === 'spreadsheets.values.batchUpdate') {
    const names = (args.requestBody?.data || [])
      .map((item) => sheetNameFromRange(item?.range))
      .filter(Boolean);
    return names.length ? new Set(names) : null;
  }
  if (method === 'spreadsheets.values.batchClear') {
    const names = (args.requestBody?.ranges || [])
      .map(sheetNameFromRange)
      .filter(Boolean);
    return names.length ? new Set(names) : null;
  }
  return null;
}

function ttlFor(profile, method, sheets) {
  if (!profile) return 0;
  if (method === 'spreadsheets.get' || sheets.has('*metadata*')) return METADATA_TTL_MS;

  if (profile === 'password-vault') {
    if ([...sheets].some((name) => PASSWORD_VAULT_SHEETS.has(name))) return PASSWORD_VAULT_TTL_MS;
    if (sheets.has('Clientes')) return PASSWORD_VAULT_CLIENTS_TTL_MS;
    return ASSISTANT_OPERATIONAL_TTL_MS;
  }

  if ([...sheets].some((name) => PASSWORD_VAULT_SHEETS.has(name))) return PASSWORD_VAULT_TTL_MS;
  if (sheets.size && [...sheets].every((name) => ASSISTANT_CATALOG_SHEETS.has(name))) {
    return ASSISTANT_CATALOG_TTL_MS;
  }
  if ([...sheets].some((name) => ASSISTANT_OPERATIONAL_SHEETS.has(name))) {
    return ASSISTANT_OPERATIONAL_TTL_MS;
  }
  return ASSISTANT_OPERATIONAL_TTL_MS;
}

function cleanupCache() {
  const now = Date.now();
  for (const [key, entry] of responseCache.entries()) {
    if (entry.expiresAt <= now) responseCache.delete(key);
  }
  if (responseCache.size <= MAX_CACHE_ENTRIES) return;
  const oldest = [...responseCache.entries()]
    .sort((left, right) => left[1].storedAt - right[1].storedAt)
    .slice(0, responseCache.size - MAX_CACHE_ENTRIES);
  oldest.forEach(([key]) => responseCache.delete(key));
}

function intersects(left, right) {
  for (const value of left) if (right.has(value)) return true;
  return false;
}

function invalidateReadCache(sheetNames = null) {
  if (!sheetNames) {
    responseCache.clear();
    stats.fullInvalidations += 1;
    return;
  }

  for (const [key, entry] of responseCache.entries()) {
    if (intersects(entry.sheetNames, sheetNames)) responseCache.delete(key);
  }
  stats.selectiveInvalidations += 1;
}

function wrapRead(owner, property, method) {
  const original = owner?.[property];
  if (typeof original !== 'function') return;

  owner[property] = async function cachedRouteRead(args = {}) {
    const profile = routeStorage.getStore()?.profile || '';
    if (!profile) return original.call(this, args);

    const sheetNames = readSheetNames(method, args);
    const ttlMs = ttlFor(profile, method, sheetNames);
    if (ttlMs <= 0) return original.call(this, args);

    const key = stableKey(profile, method, args);
    const now = Date.now();
    const cached = responseCache.get(key);
    if (cached && cached.expiresAt > now) {
      stats.cacheHits += 1;
      return cached.value;
    }
    if (cached) responseCache.delete(key);

    const requestCache = routeStorage.getStore()?.requestCache;
    if (requestCache?.has(key)) {
      stats.inflightHits += 1;
      return requestCache.get(key);
    }
    if (inflightReads.has(key)) {
      stats.inflightHits += 1;
      return inflightReads.get(key);
    }

    const request = Promise.resolve()
      .then(() => {
        stats.apiReads += 1;
        return original.call(this, args);
      })
      .then((value) => {
        const storedAt = Date.now();
        responseCache.set(key, {
          value,
          storedAt,
          expiresAt: storedAt + ttlMs,
          sheetNames,
        });
        cleanupCache();
        return value;
      })
      .finally(() => {
        inflightReads.delete(key);
        requestCache?.delete(key);
      });

    inflightReads.set(key, request);
    requestCache?.set(key, request);
    return request;
  };
}

function wrapWrite(owner, property, method) {
  const original = owner?.[property];
  if (typeof original !== 'function') return;

  owner[property] = async function selectivelyInvalidatingWrite(args = {}) {
    const result = await original.call(this, args);
    invalidateReadCache(writeSheetNames(method, args));
    return result;
  };
}

function install() {
  if (sheetsApi[INSTALL_FLAG]) return;

  wrapRead(sheetsApi.spreadsheets, 'get', 'spreadsheets.get');
  wrapRead(sheetsApi.spreadsheets.values, 'get', 'spreadsheets.values.get');
  wrapRead(sheetsApi.spreadsheets.values, 'batchGet', 'spreadsheets.values.batchGet');

  wrapWrite(sheetsApi.spreadsheets, 'create', 'spreadsheets.create');
  wrapWrite(sheetsApi.spreadsheets, 'batchUpdate', 'spreadsheets.batchUpdate');
  wrapWrite(sheetsApi.spreadsheets.values, 'append', 'spreadsheets.values.append');
  wrapWrite(sheetsApi.spreadsheets.values, 'update', 'spreadsheets.values.update');
  wrapWrite(sheetsApi.spreadsheets.values, 'batchUpdate', 'spreadsheets.values.batchUpdate');
  wrapWrite(sheetsApi.spreadsheets.values, 'clear', 'spreadsheets.values.clear');
  wrapWrite(sheetsApi.spreadsheets.values, 'batchClear', 'spreadsheets.values.batchClear');

  Object.defineProperty(sheetsApi, INSTALL_FLAG, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

install();

export function runWithSheetsRouteReadCache(route, operation) {
  const profile = routeProfile(route);
  if (!profile) return operation();
  return routeStorage.run({
    profile,
    route: String(route || ''),
    requestCache: new Map(),
  }, operation);
}

export function sheetsRouteReadCacheSnapshot() {
  cleanupCache();
  return {
    entries: responseCache.size,
    inflight: inflightReads.size,
    ...stats,
  };
}

export const SHEETS_ROUTE_READ_CACHE_POLICY = Object.freeze({
  assistantOperationalTtlMs: ASSISTANT_OPERATIONAL_TTL_MS,
  assistantCatalogTtlMs: ASSISTANT_CATALOG_TTL_MS,
  passwordVaultTtlMs: PASSWORD_VAULT_TTL_MS,
  passwordVaultClientsTtlMs: PASSWORD_VAULT_CLIENTS_TTL_MS,
  metadataTtlMs: METADATA_TTL_MS,
  encryptedRowsOnly: true,
  completedAssistantResponsesCached: false,
});
