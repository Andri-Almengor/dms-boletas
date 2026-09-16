import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { buildTicketMetrics } from '../backend/src/services/ticket-metrics-query.service.js';
import { indexCatalogById } from '../src/utils/catalogCollection.js';

const base = process.env.PERF_BASE_SHA || 'e8bd6bf52b0d7d50515e5a6703fb65bcb41faa9d';
const previousSource = path => execFileSync('git', ['show', `${base}:${path}`], { encoding: 'utf8' });
const priorMetrics = await import(`data:text/javascript;base64,${Buffer.from(previousSource('backend/src/services/ticket-metrics-query.service.js')).toString('base64')}`);
const tickets = Array.from({ length: 10000 }, (_, i) => ({
  BoletaUID: `B${i}`, BoletaID: String(i), Activo: true, Estado: i % 3 ? 'PENDIENTE' : 'FINALIZADA',
  Cliente: `Cliente ${i % 25}`, Fecha: `2026-09-${String(i % 28 + 1).padStart(2, '0')}`, HorasTotales: i % 8 + 1,
}));
const assignments = tickets.flatMap(row => [{ BoletaUID: row.BoletaUID, UsuarioID: 'U1' }, { BoletaUID: row.BoletaUID, UsuarioID: 'U2' }]);
const users = [{ UsuarioID: 'U1', Nombre: 'Ana' }, { UsuarioID: 'U2', Nombre: 'Luis' }];
const input = { tickets, assignments, users, payload: {} };
const oldMetrics = () => ({ ...priorMetrics.buildTicketMetrics(input), tableAsignadoHoras: priorMetrics.buildFullAssignedHours(input) });
const newMetrics = () => buildTicketMetrics({ ...input, fullAssignedHours: true });
assert.deepEqual(newMetrics(), oldMetrics());
function median(operation) {
  for (let i = 0; i < 2; i++) operation();
  const times = [];
  for (let i = 0; i < 7; i++) { const start = performance.now(); operation(); times.push(performance.now() - start); }
  return Number(times.sort((a, b) => a - b)[3].toFixed(3));
}
function countMetrics(operation) {
  const count = { ticketVisits: 0, assignmentVisits: 0 };
  const counted = (rows, key) => ({ *[Symbol.iterator]() { for (const row of rows) { count[key]++; yield row; } } });
  operation({ ...input, tickets: counted(tickets, 'ticketVisits'), assignments: counted(assignments, 'assignmentVisits') });
  return count;
}
function loadFilter(source) {
  return new Function(source.slice(source.indexOf('export function filterRows('), source.indexOf('export function sheetsRepositorySnapshot')).replace('export ', '') + '; return filterRows;')();
}
const beforeFilter = loadFilter(previousSource('backend/src/infra/sheets.repository.js'));
const afterFilter = loadFilter(readFileSync('backend/src/infra/sheets.repository.js', 'utf8'));
const listInput = Array.from({ length: 100000 }, (_, id) => ({ id, Activo: true, Nombre: `Row ${id}` }));
const payload = { page: 2, pageSize: 50 };
assert.deepEqual(beforeFilter(listInput, payload), afterFilter(listInput, payload));
// Measure retained matching references in the actual implementations, not heap estimates.
let beforeRetained = 0;
const trackedRows = [...listInput];
trackedRows.filter = predicate => { const result = listInput.filter(predicate); beforeRetained = result.length; return result; };
beforeFilter(trackedRows, payload);
let afterRetained = 0;
const originalPush = Array.prototype.push;
try {
  Array.prototype.push = function (...values) { if (values[0] && typeof values[0].id === 'number') afterRetained += values.length; return originalPush.apply(this, values); };
  afterFilter(listInput, payload);
} finally { Array.prototype.push = originalPush; }
let lookupVisits = 0;
const catalog = Array.from({ length: 750 }, (_, id) => ({ get id() { lookupVisits++; return id; }, Nombre: `Tipo ${id}` }));
const lookupIds = Array.from({ length: 1000 }, (_, id) => id % 750);
const oldNames = lookupIds.map(id => catalog.find(row => String(row.id) === String(id)).Nombre);
const beforeVisits = lookupVisits;
lookupVisits = 0;
const index = indexCatalogById(catalog, 'id');
assert.deepEqual(lookupIds.map(id => index.get(String(id)).Nombre), oldNames);
const report = {
  base, fixture: { tickets: tickets.length, assignments: assignments.length, listRows: listInput.length, catalogRows: catalog.length, lookups: lookupIds.length },
  metrics: {
    before: { ...countMetrics(data => { priorMetrics.buildTicketMetrics(data); priorMetrics.buildFullAssignedHours(data); }), medianMs: median(oldMetrics) },
    after: { ...countMetrics(data => buildTicketMetrics({ ...data, fullAssignedHours: true })), medianMs: median(newMetrics) },
  },
  unsortedList: { before: { retainedMatchingReferences: beforeRetained, medianMs: median(() => beforeFilter(listInput, payload)) }, after: { retainedMatchingReferences: afterRetained, medianMs: median(() => afterFilter(listInput, payload)) } },
  catalog: { beforeIdVisits: beforeVisits, afterIdVisits: lookupVisits },
  note: 'Synthetic in-process fixtures; median of 7 runs after 2 warmups. No production latency, Google calls, browser render time or heap reduction inferred.',
};
mkdirSync('.artifacts', { recursive: true });
writeFileSync('.artifacts/global-work-benchmark.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
