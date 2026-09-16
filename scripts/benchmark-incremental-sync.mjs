import { performance } from 'node:perf_hooks';

const DATASETS = [1_000, 10_000];
const RUNS = 40;

function makeTicket(index) {
  const id = `B${String(index + 1).padStart(6, '0')}`;
  return {
    BoletaUID: id,
    BoletaID: index + 1,
    Estado: index % 4 === 0 ? 'FINALIZADA' : 'PENDIENTE',
    Fecha: `2026-09-${String((index % 28) + 1).padStart(2, '0')}`,
    ClienteID: `C${String(index % 80).padStart(3, '0')}`,
    Cliente: `Cliente ${index % 80}`,
    Titulo: `Atención técnica ${index + 1}`,
    CategoriaID: `CAT${index % 12}`,
    TipoDispositivoID: `T${index % 20}`,
    FabricanteID: `F${index % 16}`,
    ModeloID: `M${index % 120}`,
    Activo: true,
    FechaActualizacion: '2026-09-16T12:00:00.000Z',
  };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function timeMedian(fn) {
  const samples = [];
  let result;
  for (let index = 0; index < RUNS; index += 1) {
    const started = performance.now();
    result = fn();
    samples.push(performance.now() - started);
  }
  return { ms: Number(median(samples).toFixed(4)), result };
}

function fullList(tickets) {
  return {
    items: tickets,
    total: tickets.length,
    page: 1,
    pageSize: tickets.length,
  };
}

function deltaEnvelope({ cursor, upserts = [], removed = [], counts = null, notModified = false, detail = undefined }) {
  const result = {
    generation: 'benchmark-generation',
    schemaVersion: 1,
    fromCursor: cursor,
    cursor: cursor + Math.max(0, upserts.length + removed.length),
    hasMore: false,
    fullSnapshotRequired: false,
    upserts,
    removed,
    invalidated: [],
    counts,
  };
  if (notModified) result.notModified = true;
  if (detail !== undefined) result.detail = detail;
  return result;
}

function counts(tickets) {
  let pending = 0;
  let finished = 0;
  for (const ticket of tickets) {
    if (ticket.Estado === 'PENDIENTE') pending += 1;
    else if (ticket.Estado === 'FINALIZADA') finished += 1;
  }
  return { pending, finished };
}

function detailFor(ticket) {
  return {
    ...ticket,
    Descripcion: 'Detalle técnico de benchmark sin media binaria.',
    Tecnicos: [{ UsuarioID: 'U1', Nombre: 'Técnico Benchmark' }],
    Evidencias: Array.from({ length: 4 }, (_, index) => ({
      EvidenciaID: `${ticket.BoletaUID}-E${index + 1}`,
      Tipo: index % 2 ? 'ARCHIVO' : 'IMAGEN',
      Nombre: `evidencia-${index + 1}.jpg`,
      Nota: 'Solo metadata; el binario continúa lazy.',
    })),
  };
}

function row({ dataset, scenario, full, delta, changedEntities, rowsInspectedModel, sheetsCallsModel, idbWrites }) {
  const fullTimed = timeMedian(() => JSON.stringify(full));
  const deltaTimed = timeMedian(() => JSON.stringify(delta));
  return {
    dataset,
    scenario,
    fullResponseBytes: Buffer.byteLength(fullTimed.result),
    deltaResponseBytes: Buffer.byteLength(deltaTimed.result),
    fullEntitiesSerialized: Array.isArray(full.items) ? full.items.length : 1,
    deltaEntitiesSerialized: changedEntities,
    fullSerializeMedianMs: fullTimed.ms,
    deltaSerializeMedianMs: deltaTimed.ms,
    modeledSheetsCalls: sheetsCallsModel,
    modeledRowsInspected: rowsInspectedModel,
    modeledTemporaryEntityRefs: changedEntities,
    modeledIndexedDbWriteCount: idbWrites,
  };
}

const results = [];
for (const dataset of DATASETS) {
  const tickets = Array.from({ length: dataset }, (_, index) => makeTicket(index));
  const full = fullList(tickets);
  const baseCounts = counts(tickets);
  const cursor = 8500;

  results.push(row({
    dataset,
    scenario: 'REVISIT_NO_CHANGES',
    full,
    delta: deltaEnvelope({ cursor }),
    changedEntities: 0,
    rowsInspectedModel: { syncChanges: 0, authoritative: 0 },
    sheetsCallsModel: { syncChanges: 1, authoritative: 0 },
    idbWrites: 1,
  }));

  for (const changeCount of [1, 10]) {
    const changed = tickets.slice(-changeCount).map((ticket, index) => ({
      ...ticket,
      Titulo: `${ticket.Titulo} / cambio ${index + 1}`,
    }));
    results.push(row({
      dataset,
      scenario: `REVISIT_${changeCount}_CHANGE${changeCount === 1 ? '' : 'S'}`,
      full,
      delta: deltaEnvelope({ cursor, upserts: changed, counts: baseCounts }),
      changedEntities: changeCount,
      // El materializador actual reutiliza snapshots Boletas/BoletaAsignados cuando
      // están calientes, pero todavía recorre esos arrays para permisos y counts.
      // Son filas en memoria; no equivalen necesariamente a I/O de Sheets.
      rowsInspectedModel: { syncChanges: changeCount, authoritativeCachedRows: dataset * 2 },
      sheetsCallsModel: { syncChanges: 1, authoritativeWarmCache: 0, authoritativeColdCache: 2 },
      idbWrites: 1,
    }));
  }

  const moving = { ...tickets[1], Estado: 'FINALIZADA', FechaActualizacion: '2026-09-16T12:05:00.000Z' };
  results.push(row({
    dataset,
    scenario: 'PENDING_TO_FINISHED',
    full,
    delta: deltaEnvelope({
      cursor,
      upserts: [moving],
      counts: { pending: baseCounts.pending - 1, finished: baseCounts.finished + 1 },
    }),
    changedEntities: 1,
    rowsInspectedModel: { syncChanges: 1, authoritativeCachedRows: dataset * 2 },
    sheetsCallsModel: { syncChanges: 1, authoritativeWarmCache: 0, authoritativeColdCache: 2 },
    idbWrites: 1,
  }));

  results.push(row({
    dataset,
    scenario: 'TECHNICIAN_LOSES_ACCESS',
    full,
    delta: deltaEnvelope({ cursor, removed: [tickets[2].BoletaUID], counts: baseCounts }),
    changedEntities: 0,
    rowsInspectedModel: { syncChanges: 1, authoritativeCachedRows: dataset * 2 },
    sheetsCallsModel: { syncChanges: 1, authoritativeWarmCache: 0, authoritativeColdCache: 2 },
    idbWrites: 1,
  }));

  const detail = detailFor(tickets[3]);
  results.push(row({
    dataset,
    scenario: 'DETAIL_UNCHANGED',
    full: detail,
    delta: deltaEnvelope({ cursor: cursor + 20, notModified: true }),
    changedEntities: 0,
    rowsInspectedModel: { syncChanges: 0, authoritative: 0 },
    sheetsCallsModel: { syncChanges: 1, authoritative: 0 },
    idbWrites: 1,
  }));

  const changedDetail = detailFor({ ...tickets[3], Titulo: 'Detalle actualizado' });
  results.push(row({
    dataset,
    scenario: 'DETAIL_CHANGED',
    full: detail,
    delta: deltaEnvelope({ cursor: cursor + 20, upserts: [tickets[3]], detail: changedDetail }),
    changedEntities: 1,
    rowsInspectedModel: { syncChanges: 1, authoritative: 'handler-dependent' },
    sheetsCallsModel: { syncChanges: 1, authoritative: 'handler-dependent' },
    idbWrites: 2,
  }));
}

console.log(JSON.stringify({
  benchmark: 'incremental-sync',
  synthetic: true,
  note: 'Bytes y tiempos de JSON.stringify son mediciones locales reproducibles. Sheets calls, rows inspected, temporary refs e IndexedDB writes son un modelo explícito de la arquitectura actual; no son métricas de producción.',
  runsPerScenario: RUNS,
  results,
}, null, 2));
