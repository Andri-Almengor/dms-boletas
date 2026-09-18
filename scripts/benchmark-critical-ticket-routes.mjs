import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { SheetRevisionTracker } from '../backend/src/core/sheet-cache-coherence.js';
import { groupRowsBy, indexRowsBy } from '../backend/src/core/row-index.js';
import { pick } from '../backend/src/core/utils.js';
import { selectTicketPage } from '../backend/src/services/ticket-list-query.service.js';
import { criticalTickets } from '../tests/fixtures/critical-tickets.mjs';

const LIST_BASE_SHA = process.env.CRITICAL_LIST_BASE_SHA || '8bcaacc5a56709deb62cba5b8972e21e5ceba9bb';
const DETAIL_BASE_SHA = process.env.CRITICAL_DETAIL_BASE_SHA || 'c3d0b9ecad2e2e9e5e859abd2cc2aca87449469b';
const WARMUPS = 2;
const MEASUREMENTS = 7;
const DATASETS = [1000, 10000];
const PRIMARY_SCENARIO = 'technicianAssigned';

const sourceAt = (ref, path) => execFileSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8' });
const currentSource = path => readFileSync(path, 'utf8');

function median(values) {
  const ordered = [...values].sort((a, b) => a - b);
  return Number(ordered[Math.floor(ordered.length / 2)].toFixed(3));
}

async function medianAsync(operationFactory) {
  for (let i = 0; i < WARMUPS; i++) await operationFactory()();
  const times = [];
  for (let i = 0; i < MEASUREMENTS; i++) {
    const operation = operationFactory();
    const start = performance.now();
    await operation();
    times.push(performance.now() - start);
  }
  return median(times);
}

function loadFilterRows(source) {
  const start = source.indexOf('export function filterRows(');
  const end = source.indexOf('export function sheetsRepositorySnapshot');
  assert.ok(start >= 0 && end > start, 'No se pudo localizar filterRows en la referencia anterior.');
  const body = source.slice(start, end).replace('export function filterRows', 'function filterRows');
  return new Function(`${body}; return filterRows;`)();
}

const previousFilterRows = loadFilterRows(sourceAt(LIST_BASE_SHA, 'backend/src/infra/sheets.repository.js'));
let activeListTables = null;
let activeListReadStats = null;
const listReadTables = async names => {
  for (const name of names) {
    if (activeListReadStats) activeListReadStats[name] = (activeListReadStats[name] || 0) + 1;
  }
  return Object.fromEntries(names.map(name => [name, activeListTables?.[name] || []]));
};

const listQueryTicketPage = async (payload = {}, { assignedUserId = '' } = {}) => {
  const assigned = String(assignedUserId || '').trim();
  let allowedIds = null;
  if (assigned) {
    allowedIds = new Set();
    for (const row of activeListTables?.BoletaAsignados || []) {
      if (String(row?.UsuarioID || '').trim() !== assigned) continue;
      if (row?.Activo === false || String(row?.Activo ?? 'true').toLowerCase() === 'false') continue;
      const id = String(row?.BoletaUID || '').trim();
      if (id) allowedIds.add(id);
    }
  }
  return selectTicketPage(activeListTables?.Boletas || [], payload, allowedIds);
};

function loadListHandler(source, filterRows) {
  const code = source
    .replace(/^import .*;\n/gm, '')
    .replace('export const ticketAccessHandlers', 'const ticketAccessHandlers');
  const error = message => new Error(message);
  return new Function(
    'forbidden', 'notFound', 'pick', 'filterRows', 'findById', 'findRows', 'readTable', 'readTables', 'queryTicketPage', 'ticketHandlers', 'selectTicketPage',
    `${code}; return ticketAccessHandlers.list;`,
  )(
    error,
    error,
    pick,
    filterRows,
    async () => null,
    async () => [],
    async () => [],
    listReadTables,
    listQueryTicketPage,
    {},
    selectTicketPage,
  );
}

const beforeListHandler = loadListHandler(
  sourceAt(LIST_BASE_SHA, 'backend/src/modules/ticket-access.module.js'),
  previousFilterRows,
);
const afterListHandler = loadListHandler(
  currentSource('backend/src/modules/ticket-access.module.js'),
  previousFilterRows,
);

function instrumentSourceArray(rows, kind, stats) {
  const copy = [...rows];
  Object.defineProperty(copy, 'filter', {
    configurable: true,
    value(predicate, thisArg) {
      stats[`${kind}Passes`] += 1;
      stats[`${kind}RowsInspected`] += this.length;
      return Array.prototype.filter.call(this, predicate, thisArg);
    },
  });
  Object.defineProperty(copy, Symbol.iterator, {
    configurable: true,
    value: function* iterator() {
      stats[`${kind}Passes`] += 1;
      for (let i = 0; i < this.length; i++) {
        stats[`${kind}RowsInspected`] += 1;
        yield this[i];
      }
    },
  });
  return copy;
}

function listWorkStats() {
  return {
    ticketPasses: 0,
    ticketRowsInspected: 0,
    assignmentPasses: 0,
    assignmentRowsInspected: 0,
    sortCalls: 0,
    elementsSorted: 0,
    peakRetainedForSort: 0,
    tableReads: {},
  };
}

async function measureListWork(operation, tables) {
  const stats = listWorkStats();
  activeListTables = {
    ...tables,
    Boletas: instrumentSourceArray(tables.Boletas, 'ticket', stats),
    BoletaAsignados: instrumentSourceArray(tables.BoletaAsignados, 'assignment', stats),
  };
  activeListReadStats = stats.tableReads;
  const originalSort = Array.prototype.sort;
  Array.prototype.sort = function trackedSort(compareFn) {
    stats.sortCalls += 1;
    stats.elementsSorted += this.length;
    stats.peakRetainedForSort = Math.max(stats.peakRetainedForSort, this.length);
    return originalSort.call(this, compareFn);
  };
  try {
    const result = await operation();
    return { result, stats };
  } finally {
    Array.prototype.sort = originalSort;
    activeListTables = null;
    activeListReadStats = null;
  }
}

function withListTables(tables, operation) {
  return async () => {
    activeListTables = tables;
    activeListReadStats = null;
    try {
      return await operation();
    } finally {
      activeListTables = null;
    }
  };
}

const accessScenarios = {
  admin: { payload: {}, user: { UsuarioID: 'u0' }, permissions: ['BOLETAS_GESTIONAR'] },
  technicianAssigned: { payload: {}, user: { UsuarioID: 'u1' }, permissions: ['BOLETAS_VER'] },
  technicianUnassigned: { payload: {}, user: { UsuarioID: 'u9' }, permissions: ['BOLETAS_VER'] },
};

async function beforeHome(ctx) {
  const latest = await beforeListHandler({ ...ctx, payload: { page: 1, pageSize: 3, sortBy: 'Fecha', sortDir: 'desc' } });
  const pending = await beforeListHandler({ ...ctx, payload: { page: 1, pageSize: 1, status: 'PENDIENTE', estado: 'PENDIENTE' } });
  const finished = await beforeListHandler({ ...ctx, payload: { page: 1, pageSize: 1, status: 'FINALIZADA', estado: 'FINALIZADA' } });
  return { ...latest, homeSummary: { pending: pending.total, finished: finished.total } };
}

async function afterHome(ctx) {
  return afterListHandler({ ...ctx, payload: { page: 1, pageSize: 3, homeSummary: true, sortBy: 'Fecha', sortDir: 'desc' } });
}

function listPayload(status) {
  return { status, page: 1, pageSize: 50 };
}

async function verifyListRoute(beforeOperation, afterOperation) {
  const before = await beforeOperation();
  const after = await afterOperation();
  assert.deepEqual(after.items.map(row => row.BoletaUID), before.items.map(row => row.BoletaUID));
  assert.equal(after.total, before.total);
  assert.equal(after.page, before.page);
  assert.equal(after.pageSize, before.pageSize);
  assert.deepEqual(after, before);
  return { idsAndOrder: true, total: true, page: true, pageSize: true, exactPayload: true };
}

function summarizeListSide(work, medianMs) {
  return {
    rowsInspected: work.stats.ticketRowsInspected,
    logicalTicketPasses: work.stats.ticketPasses,
    assignmentRowsInspected: work.stats.assignmentRowsInspected,
    logicalAssignmentPasses: work.stats.assignmentPasses,
    retainedForSorting: work.stats.elementsSorted,
    elementsActuallySorted: work.stats.elementsSorted,
    peakRetainedForSort: work.stats.peakRetainedForSort,
    sortCalls: work.stats.sortCalls,
    tableReads: work.stats.tableReads,
    medianMs,
  };
}

async function benchmarkListDataset(count) {
  const tables = criticalTickets(count);
  const verification = {};
  for (const [name, baseCtx] of Object.entries(accessScenarios)) {
    const ctx = { ...baseCtx, payload: {} };
    verification[name] = {
      home: await verifyListRoute(
        withListTables(tables, () => beforeHome(ctx)),
        withListTables(tables, () => afterHome(ctx)),
      ),
      pending: await verifyListRoute(
        withListTables(tables, () => beforeListHandler({ ...ctx, payload: listPayload('PENDIENTE') })),
        withListTables(tables, () => afterListHandler({ ...ctx, payload: listPayload('PENDIENTE') })),
      ),
      finalized: await verifyListRoute(
        withListTables(tables, () => beforeListHandler({ ...ctx, payload: listPayload('FINALIZADA') })),
        withListTables(tables, () => afterListHandler({ ...ctx, payload: listPayload('FINALIZADA') })),
      ),
    };
  }

  const ctx = { ...accessScenarios[PRIMARY_SCENARIO], payload: {} };
  const homeBeforeWork = await measureListWork(() => beforeHome(ctx), tables);
  const homeAfterWork = await measureListWork(() => afterHome(ctx), tables);
  assert.deepEqual(homeAfterWork.result, homeBeforeWork.result);
  assert.equal(homeAfterWork.stats.ticketPasses, 1);
  assert.equal(homeAfterWork.stats.assignmentPasses, 1);
  assert.equal(homeBeforeWork.stats.ticketPasses, 3);
  assert.equal(homeBeforeWork.stats.assignmentPasses, 3);

  const pendingCtx = { ...ctx, payload: listPayload('PENDIENTE') };
  const pendingBeforeWork = await measureListWork(() => beforeListHandler(pendingCtx), tables);
  const pendingAfterWork = await measureListWork(() => afterListHandler(pendingCtx), tables);
  assert.deepEqual(pendingAfterWork.result, pendingBeforeWork.result);
  assert.equal(pendingBeforeWork.stats.peakRetainedForSort, pendingBeforeWork.result.total);
  assert.equal(pendingAfterWork.stats.peakRetainedForSort, Math.min(50, pendingAfterWork.result.total));

  const finalizedCtx = { ...ctx, payload: listPayload('FINALIZADA') };
  const finalizedBeforeWork = await measureListWork(() => beforeListHandler(finalizedCtx), tables);
  const finalizedAfterWork = await measureListWork(() => afterListHandler(finalizedCtx), tables);
  assert.deepEqual(finalizedAfterWork.result, finalizedBeforeWork.result);
  assert.equal(finalizedBeforeWork.stats.peakRetainedForSort, finalizedBeforeWork.result.total);
  assert.equal(finalizedAfterWork.stats.peakRetainedForSort, Math.min(50, finalizedAfterWork.result.total));

  const timings = {
    home: {
      before: await medianAsync(() => withListTables(tables, () => beforeHome(ctx))),
      after: await medianAsync(() => withListTables(tables, () => afterHome(ctx))),
    },
    pending: {
      before: await medianAsync(() => withListTables(tables, () => beforeListHandler(pendingCtx))),
      after: await medianAsync(() => withListTables(tables, () => afterListHandler(pendingCtx))),
    },
    finalized: {
      before: await medianAsync(() => withListTables(tables, () => beforeListHandler(finalizedCtx))),
      after: await medianAsync(() => withListTables(tables, () => afterListHandler(finalizedCtx))),
    },
  };

  return {
    verification,
    home: {
      total: homeAfterWork.result.total,
      pending: homeAfterWork.result.homeSummary.pending,
      finished: homeAfterWork.result.homeSummary.finished,
      latestIds: homeAfterWork.result.items.map(row => row.BoletaUID),
      before: summarizeListSide(homeBeforeWork, timings.home.before),
      after: summarizeListSide(homeAfterWork, timings.home.after),
    },
    pending: {
      totalMatches: pendingAfterWork.result.total,
      ids: pendingAfterWork.result.items.map(row => row.BoletaUID),
      page: pendingAfterWork.result.page,
      pageSize: pendingAfterWork.result.pageSize,
      before: summarizeListSide(pendingBeforeWork, timings.pending.before),
      after: summarizeListSide(pendingAfterWork, timings.pending.after),
    },
    finalized: {
      totalMatches: finalizedAfterWork.result.total,
      ids: finalizedAfterWork.result.items.map(row => row.BoletaUID),
      page: finalizedAfterWork.result.page,
      pageSize: finalizedAfterWork.result.pageSize,
      before: summarizeListSide(finalizedBeforeWork, timings.finalized.before),
      after: summarizeListSide(finalizedAfterWork, timings.finalized.after),
    },
  };
}

function load(source, dependencies, exports) {
  const code = source.replace(/^import [\s\S]*?;\n/gm, '').replace(/export /g, '');
  return new Function(...Object.keys(dependencies), `${code}; return { ${exports} };`)(...Object.values(dependencies));
}

function newIndexStats() {
  return { builds: 0, rowsScanned: 0, retainedReferences: 0, byTable: {} };
}

function recordIndex(stats, table, scannedRows, retainedReferences) {
  stats.builds += 1;
  stats.rowsScanned += scannedRows;
  stats.retainedReferences += retainedReferences;
  const item = stats.byTable[table] || { builds: 0, rowsScanned: 0, retainedReferences: 0 };
  item.builds += 1;
  item.rowsScanned += scannedRows;
  item.retainedReferences += retainedReferences;
  stats.byTable[table] = item;
}

function detailHarness({ optimized, count, legacy = false, permission = 'BOLETAS_VER', assigned = true } = {}) {
  const tracker = new SheetRevisionTracker();
  const tables = criticalTickets(count);
  Object.assign(tables.Boletas[1], {
    GrupoVisitaID: legacy ? '' : 'b1',
    BoletaPrincipalUID: legacy ? '' : 'b1',
    TipoDispositivoID: legacy ? 'wrong' : 'd1',
    TipoDispositivo: 'Cámara',
  });
  tables.Boletas[2] = { ...tables.Boletas[2], GrupoVisitaID: 'b1', BoletaPrincipalUID: 'b1', NumeroVisita: 2 };
  tables.Usuarios = [
    { UsuarioID: 'u1', Nombre: 'old' },
    ...Array.from({ length: count }, (_, i) => ({ UsuarioID: `catalog-user-${i}`, Nombre: `Usuario ${i}` })),
    { UsuarioID: 'u1', Nombre: 'latest' },
  ];
  tables.EvidenciasBoleta = tables.Boletas.map(row => ({ BoletaUID: row.BoletaUID, EvidenciaID: `e${row.BoletaUID}`, Activo: true }));
  tables.TiposFalla = [];
  tables.TiposDispositivo = [{ TipoDispositivoID: 'd1', Nombre: 'Cámara' }];
  tables.Fabricantes = [];
  tables.Modelos = [];
  if (!assigned) tables.BoletaAsignados = tables.BoletaAsignados.filter(row => row.BoletaUID !== 'b1');

  const reads = [];
  const writes = [];
  const indexes = newIndexStats();
  let expensiveBaseEnrichmentCalls = 0;
  const readTable = async name => {
    reads.push(name);
    return tables[name] || [];
  };
  const readTables = async names => Object.fromEntries(await Promise.all(names.map(async name => [name, await readTable(name)])));
  const primaryKey = name => ({
    Boletas: 'BoletaUID',
    BoletaAsignados: 'BoletaAsignadoID',
    EvidenciasBoleta: 'EvidenciaID',
    Usuarios: 'UsuarioID',
  }[name] || 'ID');
  const findById = async (name, id) => {
    reads.push(name);
    const key = primaryKey(name);
    const row = (tables[name] || []).find(item => String(item?.[key] ?? '') === String(id ?? ''));
    if (!row) throw new Error(`No se encontró el registro en ${name}.`);
    return row;
  };
  const findRows = async (name, filters = {}, { limit = 50000 } = {}) => {
    reads.push(name);
    const rows = tables[name] || [];
    const matches = rows.filter(row => Object.entries(filters).every(([key, expected]) => {
      const values = Array.isArray(expected) ? expected : [expected];
      return values.some(value => String(row?.[key] ?? '') === String(value ?? ''));
    }));
    return matches.slice(0, limit);
  };
  const updateRow = async (name, id, patch) => {
    writes.push({ name, id, patch });
    tables[name] = tables[name].map(row => row.BoletaUID === id ? { ...row, ...patch } : row);
    tracker.advance(new Set([name]));
    return tables[name].find(row => row.BoletaUID === id);
  };
  const tableName = rows => {
    for (const name of ['BoletaAsignados', 'EvidenciasBoleta', 'Usuarios']) if (tables[name] === rows) return name;
    return 'other';
  };
  const trackedGroupRowsBy = (rows, keySelector, options) => {
    const result = groupRowsBy(rows, keySelector, options);
    recordIndex(indexes, tableName(rows), rows?.length || 0, [...result.values()].reduce((sum, group) => sum + group.length, 0));
    return result;
  };
  const trackedIndexRowsBy = (rows, keySelector, options) => {
    const result = indexRowsBy(rows, keySelector, options);
    recordIndex(indexes, tableName(rows), rows?.length || 0, result.size);
    return result;
  };
  const errors = { notFound: message => new Error(message), forbidden: message => new Error(message) };
  const getSource = path => optimized ? currentSource(path) : sourceAt(DETAIL_BASE_SHA, path);
  const snapshotFactory = optimized
    ? load(currentSource('backend/src/services/ticket-detail-snapshot.service.js'), { findById, findRows, readTable, sheetsRevisionTracker: tracker }, 'createTicketDetailSnapshot').createTicketDetailSnapshot
    : null;
  const group = load(getSource('backend/src/services/ticket-visit-group.service.js'), {
    ...errors,
    ensureColumns: async () => true,
    findById,
    findRows,
    readTable,
    updateRow,
    updateRows: async (name, updates) => Promise.all(updates.map(item => updateRow(name, item.idValue, item.patch))),
    nowIso: () => 'fixed-time',
    env: { sheetId: 'fixture' },
    sheetsApi: { spreadsheets: { values: { get: async () => ({ data: { values: [['GrupoVisitaID', 'BoletaPrincipalUID', 'NumeroVisita', 'EsVisitaPrincipal', 'FirmaOrigen', 'FirmaFecha', 'EstadoEntregaFirma', 'UltimoErrorEntregaFirma', 'FirmaReenviadaEn']] } }) } } },
  }, 'ensureVisitGroupForTicket, groupSummary, ticketGroupId, ticketRootId, ticketVisitNumber');
  const baseTicketHandlers = {
    get: async () => {
      expensiveBaseEnrichmentCalls += 1;
      throw new Error('duplicate base enrichment');
    },
  };
  const { enrichWithVisitGroup } = load(getSource('backend/src/modules/ticket-multi.module.js'), {
    ...group,
    baseTicketHandlers,
    groupRowsBy: trackedGroupRowsBy,
    indexRowsBy: trackedIndexRowsBy,
    pick,
    readTables,
    updateRow,
    nowIso: () => 'fixed-time',
  }, 'enrichWithVisitGroup');
  const ticketMultiHandlers = {
    get: async ctx => enrichWithVisitGroup(await baseTicketHandlers.get(ctx), 'u1', ctx.__ticketDetailSnapshot),
  };
  const ticketAccessHandlers = load(getSource('backend/src/modules/ticket-access.module.js'), {
    ...errors,
    findById,
    findRows,
    findTicketByStoredFileId: async () => null,
    queryTicketPage: listQueryTicketPage,
    readTable,
    readTables,
    ticketHandlers: {},
    selectTicketPage,
    pick,
  }, 'ticketAccessHandlers').ticketAccessHandlers;
  const { assertTicketPayloadAccess } = load(getSource('backend/src/services/ticket-access.service.js'), {
    ...errors,
    findById,
    findRows,
    readTable,
    pick,
  }, 'assertTicketPayloadAccess');
  const ticketDeliveryHandlers = { get: async () => ({ candidates: true }) };
  load(getSource('backend/src/services/ticket-detail-read-optimization.patch.js'), {
    ...errors,
    pick,
    findById,
    readTable,
    baseTicketHandlers,
    ticketMultiHandlers,
    ticketAccessHandlers,
    ticketDeliveryHandlers,
    assertTicketPayloadAccess,
    createTicketDetailSnapshot: snapshotFactory,
  }, '');
  const ctx = { payload: { boletaUid: 'b1' }, user: { UsuarioID: 'u1' }, permissions: [permission] };
  return {
    get: () => ticketDeliveryHandlers.get(ctx),
    reads,
    writes,
    indexes,
    get expensiveBaseEnrichmentCalls() { return expensiveBaseEnrichmentCalls; },
  };
}

function readCounts(reads) {
  const counts = {};
  for (const name of reads) counts[name] = (counts[name] || 0) + 1;
  const catalogNames = ['TiposFalla', 'TiposDispositivo', 'Fabricantes', 'Modelos'];
  return {
    byTable: counts,
    Boletas: counts.Boletas || 0,
    BoletaAsignados: counts.BoletaAsignados || 0,
    EvidenciasBoleta: counts.EvidenciasBoleta || 0,
    Usuarios: counts.Usuarios || 0,
    catalogs: catalogNames.reduce((sum, name) => sum + (counts[name] || 0), 0),
    total: reads.length,
  };
}

async function detailOutcome(harness) {
  try {
    return { ok: true, value: await harness.get() };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

async function verifyDetailCase(options) {
  const before = detailHarness({ ...options, optimized: false });
  const after = detailHarness({ ...options, optimized: true });
  const beforeOutcome = await detailOutcome(before);
  const afterOutcome = await detailOutcome(after);
  assert.deepEqual(afterOutcome, beforeOutcome);
  assert.deepEqual(after.writes, before.writes);
  return { exactPayloadOrError: true, writes: true, outcome: afterOutcome.ok ? 'payload' : 'denied' };
}

async function measureDetailWork(options, optimized) {
  const harness = detailHarness({ ...options, optimized });
  const outcome = await detailOutcome(harness);
  return {
    outcome,
    reads: readCounts(harness.reads),
    indexes: harness.indexes,
    expensiveBaseEnrichmentCalls: harness.expensiveBaseEnrichmentCalls,
    writes: harness.writes.length,
  };
}

async function benchmarkDetailDataset(count) {
  const cases = {
    canonicalAssigned: { count, legacy: false, permission: 'BOLETAS_VER', assigned: true },
    legacyAssigned: { count, legacy: true, permission: 'BOLETAS_VER', assigned: true },
    canonicalUnassigned: { count, legacy: false, permission: 'BOLETAS_VER', assigned: false },
    legacyUnassigned: { count, legacy: true, permission: 'BOLETAS_VER', assigned: false },
  };
  const verification = {};
  for (const [name, options] of Object.entries(cases)) verification[name] = await verifyDetailCase(options);

  const results = {};
  for (const name of ['canonicalAssigned', 'legacyAssigned']) {
    const options = cases[name];
    const before = await measureDetailWork(options, false);
    const after = await measureDetailWork(options, true);
    assert.deepEqual(after.outcome, before.outcome);
    assert.equal(after.expensiveBaseEnrichmentCalls, 0);
    assert.equal(before.expensiveBaseEnrichmentCalls, 0);
    const beforeMedian = await medianAsync(() => {
      const h = detailHarness({ ...options, optimized: false });
      return () => h.get();
    });
    const afterMedian = await medianAsync(() => {
      const h = detailHarness({ ...options, optimized: true });
      return () => h.get();
    });
    results[name] = {
      before: { ...before, medianMs: beforeMedian },
      after: { ...after, medianMs: afterMedian },
    };
  }
  return { verification, ...results };
}

function printSide(prefix, side, keys) {
  for (const key of keys) console.log(`${prefix} ${key}: ${typeof side[key] === 'object' ? JSON.stringify(side[key]) : side[key]}`);
}

function printDataset(count, data) {
  console.log(`\n=== ${count.toLocaleString('en-US')} BOLETAS / ${PRIMARY_SCENARIO} ===`);
  for (const [label, key] of [['HOME', 'home'], ['PENDING', 'pending'], ['FINALIZED', 'finalized']]) {
    const route = data[key];
    console.log(`\n${label}`);
    printSide('before', route.before, ['rowsInspected', 'logicalTicketPasses', 'logicalAssignmentPasses', 'retainedForSorting', 'elementsActuallySorted', 'sortCalls', 'medianMs']);
    printSide('after', route.after, ['rowsInspected', 'logicalTicketPasses', 'logicalAssignmentPasses', 'retainedForSorting', 'elementsActuallySorted', 'sortCalls', 'medianMs']);
    if (route.totalMatches !== undefined) console.log(`total matches: ${route.totalMatches}`);
    if (key === 'home') console.log(`summary: pending=${route.pending} finished=${route.finished} latest=${route.latestIds.join(',')}`);
  }
  for (const name of ['canonicalAssigned', 'legacyAssigned']) {
    const detail = data.detail[name];
    console.log(`\nDETAIL ${name}`);
    printSide('before', detail.before, ['reads', 'indexes', 'expensiveBaseEnrichmentCalls', 'medianMs']);
    printSide('after', detail.after, ['reads', 'indexes', 'expensiveBaseEnrichmentCalls', 'medianMs']);
  }
}

const report = {
  meta: {
    syntheticInProcess: true,
    listBaseSha: LIST_BASE_SHA,
    detailBaseSha: DETAIL_BASE_SHA,
    datasets: DATASETS,
    accessScenarios: Object.keys(accessScenarios),
    primaryMeasuredScenario: PRIMARY_SCENARIO,
    warmups: WARMUPS,
    measurements: MEASUREMENTS,
    timing: 'Median of 7 measurements after 2 warmups. Fixture construction is excluded from timed detail requests.',
  },
  datasets: {},
  note: 'Synthetic in-process benchmark. It validates exact behavior and relative work in fixtures; it does not measure Google latency, network latency, browser rendering, production RAM, or production speed.',
};

for (const count of DATASETS) {
  const list = await benchmarkListDataset(count);
  const detail = await benchmarkDetailDataset(count);
  report.datasets[String(count)] = { ...list, detail };
  printDataset(count, report.datasets[String(count)]);
}

mkdirSync('.artifacts', { recursive: true });
writeFileSync('.artifacts/critical-ticket-routes-benchmark.json', JSON.stringify(report, null, 2));
console.log('\nArtifact: .artifacts/critical-ticket-routes-benchmark.json');
