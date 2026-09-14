import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BoundedCache } from '../../backend/src/core/bounded-cache.js';
import {
  readSheetNames,
  SheetRevisionTracker,
  sheetNameFromRange,
  sheetSetsIntersect,
  writeSheetNames,
} from '../../backend/src/core/sheet-cache-coherence.js';

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
  assert.match(repositorySource, /Date\.now\(\) - cachedEntry\.at < env\.sheetsForceCoalesceMs/);
  assert.match(repositorySource, /if \(!options\.force && isQuotaError\(error\) && stale\) return stale/);
  assert.doesNotMatch(envSource, /STAGE6|CACHE_STAGE6|SHEETS_STALE_CACHE_MAX/);
});

test('Etapa 6: headers siguen separados del caché de tablas y nunca usan una lectura completa', () => {
  assert.match(repositorySource, /range:\s*`\$\{quote\(sheetName\)\}!1:1`/);
  assert.match(googleSource, /headerRead = method === 'spreadsheets\.values\.get' && \/!1:1\$\//);
  assert.match(routeCacheSource, /repositoryRead = args\.valueRenderOption === 'UNFORMATTED_VALUE'/);
  assert.match(routeCacheSource, /!1:1\$/);
});

test('Etapa 6: parseo compartido identifica exactamente las hojas leídas y escritas', () => {
  assert.equal(sheetNameFromRange("'Mantenimiento imagenes'!A2:C9"), 'Mantenimiento imagenes');
  assert.equal(sheetNameFromRange("'Cliente''s'!A1"), "Cliente's");
  assert.deepEqual([...readSheetNames('spreadsheets.values.batchGet', {
    ranges: ["'Boletas'!A:C", "'Usuarios'!A:D"],
  })].sort(), ['Boletas', 'Usuarios']);
  assert.deepEqual([...writeSheetNames('spreadsheets.values.batchUpdate', {
    requestBody: { data: [{ range: "'Boletas'!C2" }, { range: "'Usuarios'!D3" }] },
  })].sort(), ['Boletas', 'Usuarios']);
  assert.equal(writeSheetNames('spreadsheets.batchUpdate', { requestBody: { requests: [] } }), null);
  assert.equal(sheetSetsIntersect(new Set(['Boletas']), new Set(['Usuarios'])), false);
  assert.equal(sheetSetsIntersect(new Set(['Boletas']), new Set(['Boletas', 'Usuarios'])), true);
});

test('Etapa 6: revisiones por hoja invalidan solo datos anteriores a la escritura correspondiente', () => {
  const tracker = new SheetRevisionTracker();
  const boletas = new Set(['Boletas']);
  const users = new Set(['Usuarios']);
  const before = tracker.snapshot(boletas);
  tracker.advance(users);
  assert.equal(tracker.isCurrent(before), true, 'Una escritura en Usuarios no debe invalidar una lectura de Boletas.');
  tracker.advance(boletas);
  assert.equal(tracker.isCurrent(before), false, 'La escritura en Boletas debe invalidar la revisión anterior de Boletas.');

  const justBeforeWrite = tracker.snapshot(boletas);
  tracker.advance(boletas);
  assert.equal(tracker.isSingleWriteAfter(justBeforeWrite, boletas), true);
  tracker.advance(boletas);
  assert.equal(tracker.isSingleWriteAfter(justBeforeWrite, boletas), false);

  const beforeStructuralChange = tracker.snapshot(boletas);
  tracker.advance(null);
  assert.equal(tracker.isCurrent(beforeStructuralChange), false, 'Un cambio estructural debe invalidar todas las revisiones.');
});

test('Etapa 6: una lectura en vuelo anterior a una escritura ya no puede reutilizarse ni repoblar caché como fresca', () => {
  assert.match(googleSource, /existing && sheetsRevisionTracker\.isCurrent\(existing\.revision\)/);
  assert.match(googleSource, /readInflightBypasses/);
  assert.match(googleSource, /if \(sheetsRevisionTracker\.isCurrent\(revision\)\)/);
  assert.match(googleSource, /readCacheWriteSkips/);
  assert.match(googleSource, /if \(readInflight\.get\(key\) === entry\) readInflight\.delete\(key\)/);

  assert.match(routeCacheSource, /currentInflight\(sharedEntry\)/);
  assert.match(routeCacheSource, /staleInflightBypasses/);
  assert.match(routeCacheSource, /if \(revisionTracker\.isCurrent\(revision\)\)/);
  assert.match(routeCacheSource, /cacheWriteSkips/);
  assert.match(routeCacheSource, /if \(inflightReads\.get\(key\) === entry\) inflightReads\.delete\(key\)/);
});

test('Etapa 6: una escritura conocida invalida globalmente solo las hojas tocadas; cambios estructurales conservan invalidación total', () => {
  assert.match(googleSource, /const sheetNames = writeSheetNames\(method, args\)/);
  assert.match(googleSource, /sheetsRevisionTracker\.advance\(sheetNames\)/);
  assert.match(googleSource, /invalidateReadCache\(sheetNames\)/);
  assert.match(googleSource, /sheetSetsIntersect\(entry\.sheetNames, sheetNames\)/);
  assert.match(googleSource, /stats\.selectiveInvalidations \+= 1/);
  assert.match(googleSource, /stats\.fullInvalidations \+= 1/);
  const writeWrapper = googleSource.slice(googleSource.indexOf('function wrapWrite'), googleSource.indexOf('const rawSpreadsheets'));
  assert.doesNotMatch(writeWrapper, /readCache\.clear\(\)/, 'El write normal no debe vaciar todo el caché directamente.');
});

test('Etapa 6: el repositorio rechaza caché/stale de una revisión anterior y evita coalescer una lectura activa obsoleta', () => {
  assert.match(repositorySource, /sheetsRevisionTracker\.isCurrent\(cached\.revision\)/);
  assert.match(repositorySource, /sheetsRevisionTracker\.isCurrent\(staleEntry\.revision\)/);
  assert.match(repositorySource, /existing && sheetsRevisionTracker\.isCurrent\(existing\.revision\)/);
  assert.match(repositorySource, /pendingReads\.get\(sheetName\) === existing/);
  assert.match(repositorySource, /if \(sheetsRevisionTracker\.isCurrent\(readRevision\)\)/);
  assert.match(repositorySource, /cacheCanPromoteAfterWrite/);
  assert.match(repositorySource, /isSingleWriteAfter\(beforeRevision, new Set\(\[sheetName\]\)\)/);
});

test('Etapa 6: fresh y stale comparten una sola medición de peso sin cambiar límites ni datos', () => {
  const fresh = new BoundedCache({ maxBytes: 10_000 });
  const stale = new BoundedCache({ maxBytes: 10_000 });
  const value = { rows: Array.from({ length: 20 }, (_, index) => ({ id: index, text: `row-${index}` })) };
  const weight = fresh.measure(value);
  fresh.setWithWeight('Rows', value, weight);
  stale.setWithWeight('Rows', value, weight);

  assert.equal(fresh.get('Rows'), value);
  assert.equal(stale.get('Rows'), value);
  assert.equal(fresh.snapshot().estimatedBytes, stale.snapshot().estimatedBytes);
  assert.equal(fresh.snapshot().weightEvaluations, 1);
  assert.equal(stale.snapshot().weightEvaluations, 0);
  assert.match(repositorySource, /const weight = tableCache\.measure\(entry\)/);
  assert.match(repositorySource, /tableCache\.setWithWeight\(sheetName, entry, weight\)/);
  assert.match(repositorySource, /staleTableCache\.setWithWeight\(sheetName, entry, weight\)/);
});

test('Etapa 6: caché especializado sigue aislado a asistente y password vault con invalidación selectiva', () => {
  assert.match(routeCacheSource, /ASSISTANT_ROUTES/);
  assert.match(routeCacheSource, /PASSWORD_VAULT_READ_ROUTES/);
  assert.match(routeCacheSource, /requestCache:\s*new Map\(\)/);
  assert.match(routeCacheSource, /intersects\(entry\.sheetNames, sheetNames\)/);
  assert.match(routeCacheSource, /revisionTracker\.advance\(sheetNames\)/);
  assert.match(routeCacheSource, /completedAssistantResponsesCached:\s*false/);
  assert.match(routeCacheSource, /passwordVaultWritesCached:\s*false/);
});

test('Etapa 6: el caché global conserva stale únicamente para errores transitorios y excluye lecturas de repositorio', () => {
  assert.match(googleSource, /repositoryRead = method === 'spreadsheets\.values\.batchGet'/);
  assert.match(googleSource, /if \(!repositoryRead && !headerRead/);
  assert.match(googleSource, /if \(stale && stale\.staleUntil > Date\.now\(\) && sheetsRevisionTracker\.isCurrent\(stale\.revision\)\)/);
  assert.match(googleSource, /if \(isSheetsTransientError\(error\)\)/);
});
