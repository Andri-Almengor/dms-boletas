import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { pick } from '../backend/src/core/utils.js';
import { selectTicketPage } from '../backend/src/services/ticket-list-query.service.js';
import { criticalTickets } from '../tests/fixtures/critical-tickets.mjs';

const BASE_SHA = process.env.CRITICAL_LIST_BASE_SHA || '8bcaacc5a56709deb62cba5b8972e21e5ceba9bb';
const WARMUPS = 2;
const MEASUREMENTS = 7;
const DATASETS = [1000, 10000];
const ARTIFACT = '.artifacts/critical-ticket-routes-benchmark.json';

const sourceAt = (ref, path) => execFileSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8' });
const currentSource = path => readFileSync(path, 'utf8');

function median(values) {
  const ordered = [...values].sort((a, b) => a - b);
  return Number(ordered[Math.floor(ordered.length / 2)].toFixed(3));
}

async function medianAsync(factory) {
  for (let i = 0; i < WARMUPS; i++) await factory()();
  const values = [];
  for (let i = 0; i < MEASUREMENTS; i++) {
    const operation = factory();
    const started = performance.now();
    await operation();
    values.push(performance.now() - started);
  }
  return median(values);
}

function loadFilterRows(source) {
  const start = source.indexOf('export function filterRows(');
  const end = source.indexOf('export function sheetsRepositorySnapshot');
  assert.ok(start >= 0 && end > start, 'No se pudo localizar filterRows en la referencia anterior.');
  const body = source.slice(start, end).replace('export function filterRows', 'function filterRows');
  return new Function(`${body}; return filterRows;`)();
}

const previousFilterRows = loadFilterRows(sourceAt(BASE_SHA, 'backend/src/infra/sheets.repository.js'));
let activeTables = null;
let activeReadStats = null;
const readTables = async names => {
  for (const name of names) {
    if (activeReadStats) activeReadStats[name] = (activeReadStats[name] || 0) + 1;
  }
  return Object.fromEntries(names.map(name => [name, activeTables?.[name] || []]));
};

function loadListHandler(source) {
  const code = source
    .replace(/^import .*;\n/gm, '')
    .replace('export const ticketAccessHandlers', 'const ticketAccessHandlers');
  const error = message => new Error(message);
  return new Function(
    'forbidden', 'notFound', 'pick', 'filterRows', 'findById', 'readTable', 'readTables', 'ticketHandlers', 'selectTicketPage',
    `${code}; return ticketAccessHandlers.list;`,
  )(
    error,
    error,
    pick,
    previousFilterRows,
    async () => null,
    async () => [],
    readTables,
    {},
    selectTicketPage,
  );
}

const beforeList = loadListHandler(sourceAt(BASE_SHA, 'backend/src/modules/ticket-access.module.js'));
const afterList = loadListHandler(currentSource('backend/src/modules/ticket-access.module.js'));
const admin = { user: { UsuarioID: 'u0' }, permissions: ['BOLETAS_GESTIONAR'] };
const payload = { status: 'PENDIENTE', page: 1, pageSize: 50 };

function trackedRows(rows, stats) {
  const copy = [...rows];
  Object.defineProperty(copy, 'filter', {
    configurable: true,
    value(predicate, thisArg) {
      stats.logicalTicketPasses += 1;
      stats.rowsInspected += this.length;
      return Array.prototype.filter.call(this, predicate, thisArg);
    },
  });
  Object.defineProperty(copy, Symbol.iterator, {
    configurable: true,
    value: function* iterator() {
      stats.logicalTicketPasses += 1;
      for (const row of Array.prototype.values.call(this)) {
        stats.rowsInspected += 1;
        yield row;
      }
    },
  });
  return copy;
}

function workStats() {
  return {
    rowsInspected: 0,
    logicalTicketPasses: 0,
    assignmentRowsInspected: 0,
    logicalAssignmentPasses: 0,
    sortCalls: 0,
    elementsSorted: 0,
    peakRetainedForSort: 0,
    tableReads: {},
  };
}

async function measureWork(handler, tables) {
  const stats = workStats();
  activeTables = { ...tables, Boletas: trackedRows(tables.Boletas, stats) };
  activeReadStats = stats.tableReads;
  const originalSort = Array.prototype.sort;
  Array.prototype.sort = function trackedSort(compareFn) {
    stats.sortCalls += 1;
    stats.elementsSorted += this.length;
    stats.peakRetainedForSort = Math.max(stats.peakRetainedForSort, this.length);
    return originalSort.call(this, compareFn);
  };
  try {
    const result = await handler({ ...admin, payload });
    return { result, stats };
  } finally {
    Array.prototype.sort = originalSort;
    activeTables = null;
    activeReadStats = null;
  }
}

function withTables(tables, operation) {
  return async () => {
    activeTables = tables;
    activeReadStats = null;
    try {
      return await operation();
    } finally {
      activeTables = null;
    }
  };
}

function summarize(work, medianMs) {
  return {
    rowsInspected: work.stats.rowsInspected,
    logicalTicketPasses: work.stats.logicalTicketPasses,
    assignmentRowsInspected: work.stats.assignmentRowsInspected,
    logicalAssignmentPasses: work.stats.logicalAssignmentPasses,
    retainedForSorting: work.stats.elementsSorted,
    elementsActuallySorted: work.stats.elementsSorted,
    peakRetainedForSort: work.stats.peakRetainedForSort,
    sortCalls: work.stats.sortCalls,
    tableReads: work.stats.tableReads,
    medianMs,
  };
}

const report = JSON.parse(readFileSync(ARTIFACT, 'utf8'));
report.meta.primaryMeasuredScenarios = {
  home: 'technicianAssigned',
  pending: 'admin',
  finalized: 'technicianAssigned',
  detail: 'technicianAssigned',
};
delete report.meta.primaryMeasuredScenario;

for (const count of DATASETS) {
  const tables = criticalTickets(count);
  const before = await measureWork(beforeList, tables);
  const after = await measureWork(afterList, tables);

  assert.deepEqual(after.result, before.result);
  assert.deepEqual(after.result.items.map(row => row.BoletaUID), before.result.items.map(row => row.BoletaUID));
  assert.equal(after.result.total, before.result.total);
  assert.equal(after.result.page, 1);
  assert.equal(after.result.pageSize, 50);
  assert.ok(before.result.total > 50, `El fixture de ${count} debe tener más de 50 pendientes para medir selección acotada.`);
  assert.equal(before.stats.peakRetainedForSort, before.result.total);
  assert.equal(after.stats.peakRetainedForSort, 50);

  const beforeMedian = await medianAsync(() => withTables(tables, () => beforeList({ ...admin, payload })));
  const afterMedian = await medianAsync(() => withTables(tables, () => afterList({ ...admin, payload })));

  report.datasets[String(count)].pending = {
    measuredScenario: 'admin',
    totalMatches: after.result.total,
    ids: after.result.items.map(row => row.BoletaUID),
    page: after.result.page,
    pageSize: after.result.pageSize,
    exactPayload: true,
    before: summarize(before, beforeMedian),
    after: summarize(after, afterMedian),
  };

  console.log(`\nPENDING (admin override, ${count.toLocaleString('en-US')} boletas)`);
  console.log(`before rowsInspected: ${before.stats.rowsInspected}`);
  console.log(`after rowsInspected: ${after.stats.rowsInspected}`);
  console.log(`before retained: ${before.stats.peakRetainedForSort}`);
  console.log(`after retained: ${after.stats.peakRetainedForSort}`);
  console.log(`before sorted: ${before.stats.elementsSorted}`);
  console.log(`after sorted: ${after.stats.elementsSorted}`);
  console.log(`before medianMs: ${beforeMedian}`);
  console.log(`after medianMs: ${afterMedian}`);
  console.log(`total matches: ${after.result.total}`);
}

writeFileSync(ARTIFACT, JSON.stringify(report, null, 2));
console.log(`\nUpdated artifact: ${ARTIFACT}`);
