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
const shimSource = source('backend/src/infra/sheets.repository.js');
const repositorySource = source('backend/src/infra/postgres.repository.core.js');
const querySource = source('backend/src/infra/postgres.repository.queries.js');
const routeCacheSource = source('backend/src/services/sheets-route-read-cache.patch.js');
const memoryGuardSource = source('backend/src/services/sheets-memory-guard.service.js');
const boundedCacheSource = source('backend/src/core/bounded-cache.js');

test('Etapa 6: la caché genérica permanece acotada para los usos no relacionados con persistencia', () => {
  const cache = new BoundedCache({ maxBytes: 10_000, maxEntries: 2 });
  const a = { value: 'a' };
  const b = { value: 'b' };
  const c = { value: 'c' };
  cache.set('a', a);
  cache.set('b', b);
  cache.set('c', c);
  assert.ok(cache.snapshot().entries <= 2);
  assert.match(boundedCacheSource, /if \(weight > this\.maxBytes\) return this/);
  assert.match(boundedCacheSource, /this\.size >= this\.maxEntries/);
});

test('Etapa 6: el shim histórico delega toda persistencia al repositorio PostgreSQL', () => {
  assert.match(shimSource, /postgres\.repository\.js/);
  assert.doesNotMatch(shimSource, /sheetsApi|google\.sheets|spreadsheets\.|tableCache|staleTableCache/);
  assert.match(repositorySource, /export async function readTable/);
  assert.match(repositorySource, /export async function findRows/);
  assert.match(repositorySource, /export async function updateRows/);
  assert.match(repositorySource, /return withTransaction\(async \(\) =>/);
});

test('Etapa 6: las rutas críticas filtran y paginan en SQL en vez de cachear tablas de Sheets', () => {
  assert.match(querySource, /export async function queryTicketPage/);
  assert.match(querySource, /COUNT\(\*\)::bigint AS total/);
  assert.match(querySource, /LIMIT \$/);
  assert.match(querySource, /OFFSET \$/);
  assert.match(querySource, /export async function queryCustomerCasePage/);
  assert.doesNotMatch(querySource, /spreadsheets\.|sheetsApi/);
});

test('Etapa 6: los antiguos cachés y guards operacionales de Sheets están desactivados', () => {
  assert.match(routeCacheSource, /enabled:\s*false/);
  assert.match(routeCacheSource, /return operation\(\)/);
  assert.match(memoryGuardSource, /enabled:\s*false/);
  assert.match(memoryGuardSource, /postgres-persistence/);
  assert.doesNotMatch(routeCacheSource, /AsyncLocalStorage|inflightReads|responseCache/);
  assert.doesNotMatch(memoryGuardSource, /HEAVY_SHEETS|splitRepositoryRanges|serializeRepositoryRead/);
});

test('Etapa 6: Google Sheets queda disponible únicamente para documentos o reportes generados', () => {
  assert.match(googleSource, /google\.sheets/);
  assert.match(googleSource, /reportOnly:\s*true/);
  assert.match(googleSource, /generated-reports-only/);
  assert.doesNotMatch(googleSource, /readCache|staleReadCache|withSheetsTransientRetry/);
});

test('Etapa 6: los helpers históricos de rangos siguen siendo deterministas sin gobernar la DB operacional', () => {
  assert.equal(sheetNameFromRange("'Mantenimiento imagenes'!A2:C9"), 'Mantenimiento imagenes');
  assert.equal(sheetNameFromRange("'Cliente''s'!A1"), "Cliente's");
  assert.deepEqual([...readSheetNames('spreadsheets.values.batchGet', {
    ranges: ["'Boletas'!A:C", "'Usuarios'!A:D"],
  })].sort(), ['Boletas', 'Usuarios']);
  assert.deepEqual([...writeSheetNames('spreadsheets.values.batchUpdate', {
    requestBody: { data: [{ range: "'Boletas'!C2" }, { range: "'Usuarios'!D3" }] },
  })].sort(), ['Boletas', 'Usuarios']);
  assert.equal(sheetSetsIntersect(new Set(['Boletas']), new Set(['Usuarios'])), false);
});

test('Etapa 6: SheetRevisionTracker mantiene su semántica aislada para compatibilidad', () => {
  const tracker = new SheetRevisionTracker();
  const boletas = new Set(['Boletas']);
  const users = new Set(['Usuarios']);
  const before = tracker.snapshot(boletas);
  tracker.advance(users);
  assert.equal(tracker.isCurrent(before), true);
  tracker.advance(boletas);
  assert.equal(tracker.isCurrent(before), false);
});
