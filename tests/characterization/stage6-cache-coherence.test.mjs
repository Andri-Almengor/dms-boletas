import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (relativePath) => readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');

const googleSource = source('backend/src/infra/google.js');
const repositorySource = source('backend/src/infra/sheets.repository.js');
const routeCacheSource = source('backend/src/services/sheets-route-read-cache.patch.js');
const boundedCacheSource = source('backend/src/core/bounded-cache.js');
const envSource = source('backend/src/config/env.js');

test('Etapa 6: las cachés de Sheets permanecen acotadas por memoria y entradas', () => {
  assert.match(googleSource, /new BoundedCache\(\{maxBytes:env\.memoryBudgetMb \* 1024 \* 1024 \/ 64\}\)/);
  assert.match(repositorySource, /tableCache = new BoundedCache\(\{maxBytes:env\.memoryBudgetMb \* 1024 \* 1024 \/ 32\}\)/);
  assert.match(repositorySource, /staleTableCache = new BoundedCache\(\{maxBytes:env\.memoryBudgetMb \* 1024 \* 1024 \/ 32\}\)/);
  assert.match(routeCacheSource, /maxEntries:320/);
  assert.match(boundedCacheSource, /if \(weight > this\.maxBytes\) return this/);
  assert.match(boundedCacheSource, /this\.size >= this\.maxEntries/);
});

test('Etapa 6: lecturas de repositorio conservan TTL, coalescencia force y stale solo ante cuota', () => {
  assert.match(envSource, /sheetsCacheTtlMs:\s*optionalNumber\('SHEETS_CACHE_TTL_MS', 120_000\)/);
  assert.match(envSource, /sheetsForceCoalesceMs:\s*optionalNumber\('SHEETS_FORCE_COALESCE_MS', 5_000\)/);
  assert.match(repositorySource, /Date\.now\(\) - cached\.at >= env\.sheetsCacheTtlMs/);
  assert.match(repositorySource, /Date\.now\(\) - cachedEntry\.at < env\.sheetsForceCoalesceMs/);
  assert.match(repositorySource, /if \(!options\.force && isQuotaError\(error\) && stale\) return stale/);
});

test('Etapa 6: headers siguen separados del caché de tablas y nunca usan una lectura completa', () => {
  assert.match(repositorySource, /range:\s*`\$\{quote\(sheetName\)\}!1:1`/);
  assert.match(googleSource, /headerRead = method === 'spreadsheets\.values\.get' && \/!1:1\$\//);
  assert.match(routeCacheSource, /repositoryRead = args\.valueRenderOption === 'UNFORMATTED_VALUE'/);
  assert.match(routeCacheSource, /!1:1\$/);
});

test('Etapa 6: las escrituras del repositorio mantienen su caché coherente sin volver a leer toda la tabla', () => {
  assert.match(repositorySource, /appendToCachedTable\(sheetName, headers, chunk/);
  assert.match(repositorySource, /patchCachedRows\(sheetName, cachePatches\)/);
  assert.match(repositorySource, /setTableCache\(sheetName, \[\.\.\.cached\.records, \.\.\.appended\]\)/);
  assert.match(repositorySource, /patch \? \{ \.\.\.row, \.\.\.patch, __rowNumber: row\.__rowNumber \} : row/);
});

test('Etapa 6: caché especializado sigue aislado a asistente y password vault', () => {
  assert.match(routeCacheSource, /ASSISTANT_ROUTES/);
  assert.match(routeCacheSource, /PASSWORD_VAULT_READ_ROUTES/);
  assert.match(routeCacheSource, /requestCache:\s*new Map\(\)/);
  assert.match(routeCacheSource, /completedAssistantResponsesCached:\s*false/);
  assert.match(routeCacheSource, /passwordVaultWritesCached:\s*false/);
});

test('Etapa 6: las escrituras especializadas invalidan solo hojas relacionadas', () => {
  assert.match(routeCacheSource, /writeSheetNames/);
  assert.match(routeCacheSource, /intersects\(entry\.sheetNames, sheetNames\)/);
  assert.match(routeCacheSource, /invalidateReadCache\(writeSheetNames\(method, args\)\)/);
  assert.match(routeCacheSource, /selectiveInvalidations/);
});

test('Etapa 6: el caché global conserva stale únicamente para errores transitorios y excluye lecturas de repositorio', () => {
  assert.match(googleSource, /repositoryRead = method === 'spreadsheets\.values\.batchGet'/);
  assert.match(googleSource, /if \(!repositoryRead && !headerRead/);
  assert.match(googleSource, /if \(stale && stale\.staleUntil > Date\.now\(\)\)/);
  assert.match(googleSource, /if \(isSheetsTransientError\(error\)\)/);
});
