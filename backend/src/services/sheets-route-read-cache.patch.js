import { BoundedCache } from '../core/bounded-cache.js';
import {
  readSheetNames,
  SheetRevisionTracker,
  sheetSetsIntersect,
  writeSheetNames,
} from '../core/sheet-cache-coherence.js';
import { env } from '../config/env.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { sheetsApi } from '../infra/google.js';
import {
  recordCacheEvictions,
  recordCacheHit,
  recordCacheMiss,
} from './performance-observability.service.js';

const INSTALL_FLAG = Symbol.for('dms.sheetsRouteReadCachePatch');
const routeStorage = new AsyncLocalStorage();
const responseCache = new BoundedCache({maxBytes:env.memoryBudgetMb * 1024 * 1024 / 64, maxEntries:320});
const inflightReads = new Map();
const revisionTracker = new SheetRevisionTracker();

const MAX_CACHE_ENTRIES = 320;
const ASSISTANT_OPERATIONAL_TTL_MS = 60_000;
const ASSISTANT_CATALOG_TTL_MS = 10 * 60_000;
const PASSWORD_VAULT_TTL_MS = 5 * 60_000;
const PASSWORD_VAULT_CLIENTS_TTL_MS = 2 * 60_000;
const METADATA_TTL_MS = 10 * 60_000;

const ASSISTANT_ROUTES = new Set(['assistant.chat', 'asistente.chat']);
const PASSWORD_VAULT_READ_ROUTES = new Set([
  'passwordVault.dashboard.get',
  'credenciales.dashboard.get',
  'passwordVault.credentials.reveal',
  'credenciales.reveal',
]);

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
  staleInflightBypasses: 0,
  cacheWriteSkips: 0,
  apiReads: 0,
  selectiveInvalidations: 0,
  fullInvalidations: 0,
};

function routeProfile(route) {
  const value = String(route || '').trim();
  if (ASSISTANT_ROUTES.has(value)) return 'assistant';
  if (PASSWORD_VAULT_READ_ROUTES.has(value)) return 'password-vault';
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
    if (entry.expiresAt <= now || !revisionTracker.isCurrent(entry.revision)) responseCache.delete(key);
  }
  if (responseCache.size <= MAX_CACHE_ENTRIES) return;
  const oldest = [...responseCache.entries()]
    .sort((left, right) => left[1].storedAt - right[1].storedAt)
    .slice(0, responseCache.size - MAX_CACHE_ENTRIES);
  oldest.forEach(([key]) => responseCache.delete(key));
}

function intersects(left, right) {
  return sheetSetsIntersect(left, right);
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

function currentInflight(entry) {
  return entry && revisionTracker.isCurrent(entry.revision);
}

function wrapRead(owner, property, method) {
  const original = owner?.[property];
  if (typeof original !== 'function') return;

  owner[property] = async function cachedRouteRead(args = {}) {
    const repositoryRead = args.valueRenderOption === 'UNFORMATTED_VALUE'
      && ((method === 'spreadsheets.values.get' && /!1:1$/.test(args.range || ''))
        || (method === 'spreadsheets.values.batchGet' && Array.isArray(args.ranges)
          && args.ranges.every((range) => /!A:[A-Z]+$/i.test(range))));
    if (repositoryRead) return original.call(this, args);
    const profile = routeStorage.getStore()?.profile || '';
    if (!profile) return original.call(this, args);

    const sheetNames = readSheetNames(method, args);
    const ttlMs = ttlFor(profile, method, sheetNames);
    if (ttlMs <= 0) return original.call(this, args);

    const key = stableKey(profile, method, args);
    const now = Date.now();
    const cachedCandidate = responseCache.get(key);
    const cached = cachedCandidate && revisionTracker.isCurrent(cachedCandidate.revision)
      ? cachedCandidate
      : null;
    if (cachedCandidate && !cached) responseCache.delete(key);
    if (cached && cached.expiresAt > now) {
      stats.cacheHits += 1;
      recordCacheHit();
      return cached.value;
    }
    recordCacheMiss();
    if (cached) responseCache.delete(key);

    const requestCache = routeStorage.getStore()?.requestCache;
    const requestEntry = requestCache?.get(key);
    if (currentInflight(requestEntry)) {
      stats.inflightHits += 1;
      return requestEntry.promise;
    }
    if (requestEntry) requestCache.delete(key);

    const sharedEntry = inflightReads.get(key);
    if (currentInflight(sharedEntry)) {
      stats.inflightHits += 1;
      requestCache?.set(key, sharedEntry);
      return sharedEntry.promise;
    }
    if (sharedEntry) stats.staleInflightBypasses += 1;

    const revision = revisionTracker.snapshot(sheetNames);
    const entry = { revision, sheetNames, promise: null };
    const request = Promise.resolve()
      .then(() => {
        stats.apiReads += 1;
        return original.call(this, args);
      })
      .then((value) => {
        if (revisionTracker.isCurrent(revision)) {
          const storedAt = Date.now();
          const evictionsBefore = responseCache.evictions;
          responseCache.set(key, {
            value: { data: value.data },
            storedAt,
            expiresAt: storedAt + ttlMs,
            sheetNames,
            revision,
          });
          recordCacheEvictions(responseCache.evictions - evictionsBefore);
          cleanupCache();
        } else {
          stats.cacheWriteSkips += 1;
        }
        return value;
      })
      .finally(() => {
        if (inflightReads.get(key) === entry) inflightReads.delete(key);
        if (requestCache?.get(key) === entry) requestCache.delete(key);
      });

    entry.promise = request;
    inflightReads.set(key, entry);
    requestCache?.set(key, entry);
    return request;
  };
}

function wrapWrite(owner, property, method) {
  const original = owner?.[property];
  if (typeof original !== 'function') return;

  owner[property] = async function selectivelyInvalidatingWrite(args = {}) {
    const result = await original.call(this, args);
    const sheetNames = writeSheetNames(method, args);
    revisionTracker.advance(sheetNames);
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
    revisionTracker: revisionTracker.snapshotState(),
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
  passwordVaultWritesCached: false,
  completedAssistantResponsesCached: false,
});