import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SheetRevisionTracker } from '../../backend/src/core/sheet-cache-coherence.js';
import { groupRowsBy, indexRowsBy } from '../../backend/src/core/row-index.js';
import { pick } from '../../backend/src/core/utils.js';
import { criticalTickets } from '../fixtures/critical-tickets.mjs';
const read = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
function load(source, dependencies, exports) {
  const code = source.replace(/^import [\s\S]*?;\n/gm, '').replace(/export /g, '');
  return new Function(...Object.keys(dependencies), `${code}; return { ${exports} };`)(...Object.values(dependencies));
}
function harness({ optimized = true, legacy = false, permission = 'USUARIOS_GESTIONAR', assigned = true, emptyCatalogs = false } = {}) {
  const tracker = new SheetRevisionTracker();
  const tables = criticalTickets(1000);
  Object.assign(tables.Boletas[1], { GrupoVisitaID: legacy ? '' : 'b1', BoletaPrincipalUID: legacy ? '' : 'b1', TipoDispositivoID: legacy ? 'wrong' : 'd1', TipoDispositivo: 'Cámara' });
  if (emptyCatalogs) for (const key of ['TipoDispositivoID','TipoDispositivo','FabricanteID','ModeloID']) tables.Boletas[1][key] = '';
  tables.Boletas[2] = { ...tables.Boletas[2], GrupoVisitaID: 'b1', BoletaPrincipalUID: 'b1', NumeroVisita: 2 };
  tables.Usuarios = [{ UsuarioID: 'u1', Nombre: 'old' }, { UsuarioID: 'u1', Nombre: 'latest' }];
  tables.EvidenciasBoleta = tables.Boletas.map(row => ({ BoletaUID: row.BoletaUID, EvidenciaID: `e${row.BoletaUID}`, Activo: true }));
  tables.TiposFalla = [];
  tables.TiposDispositivo = [{ TipoDispositivoID: 'd1', Nombre: 'Cámara' }];
  tables.Fabricantes = []; tables.Modelos = [];
  if (!assigned) tables.BoletaAsignados = tables.BoletaAsignados.filter(row => row.BoletaUID !== 'b1');
  const reads = [], writes = [];
  const errors = { notFound: msg => new Error(msg), forbidden: msg => new Error(msg) };
  const idColumns = {
    Boletas: 'BoletaUID',
    BoletaAsignados: 'BoletaAsignadoID',
    EvidenciasBoleta: 'EvidenciaID',
    Usuarios: 'UsuarioID',
    TiposFalla: 'TipoFallaID',
    TiposDispositivo: 'TipoDispositivoID',
    Fabricantes: 'FabricanteID',
    Modelos: 'ModeloID',
  };
  const readTable = async name => { reads.push(name); return tables[name] || []; };
  const readTables = async names => Object.fromEntries(await Promise.all(names.map(async name => [name, await readTable(name)])));
  const findRows = async (name, criteria = {}) => {
    reads.push(name);
    return (tables[name] || []).filter((row) => Object.entries(criteria).every(([key, expected]) => {
      if (Array.isArray(expected)) return expected.map(String).includes(String(row[key]));
      return String(row[key]) === String(expected);
    }));
  };
  const findById = async (name, id, idColumn = idColumns[name]) => {
    reads.push(name);
    const row = (tables[name] || []).find((item) => String(item[idColumn]) === String(id));
    if (!row) throw errors.notFound(`No se encontró el registro en ${name}.`);
    return row;
  };
  const ensureColumns = async () => [];
  const updateRows = async (name, updates, idColumn = idColumns[name]) => {
    const result = [];
    for (const { idValue, patch } of updates) {
      writes.push({ name, id: idValue, patch });
      tables[name] = (tables[name] || []).map((row) => String(row[idColumn]) === String(idValue) ? { ...row, ...patch } : row);
      result.push((tables[name] || []).find((row) => String(row[idColumn]) === String(idValue)));
    }
    tracker.advance(new Set([name]));
    return result;
  };
  const updateRow = async (name, id, patch, idColumn = idColumns[name]) => (await updateRows(name, [{ idValue: id, patch }], idColumn))[0];
  const snapshotFactory = load(
    read('backend/src/services/ticket-detail-snapshot.service.js'),
    { readTable, findById, findRows },
    'createTicketDetailSnapshot',
  ).createTicketDetailSnapshot;
  const group = load(
    read('backend/src/services/ticket-visit-group.service.js'),
    { ...errors, ensureColumns, findById, findRows, updateRow, updateRows, nowIso: () => 'fixed-time' },
    'ensureVisitGroupForTicket, groupSummary, ticketGroupId, ticketRootId, ticketVisitNumber',
  );
  const baseTicketHandlers = { get: async () => { throw Error('duplicate base enrichment'); } };
  const source = optimized ? read('backend/src/modules/ticket-multi.module.js') : read('tests/fixtures/ticket-detail-reference.mjs');
  const { enrichWithVisitGroup } = load(source, { ...group, baseTicketHandlers, groupRowsBy, indexRowsBy, pick, readTables, updateRow, nowIso: () => 'fixed-time' }, 'enrichWithVisitGroup');
  const ticketMultiHandlers = { get: async ctx => enrichWithVisitGroup(await baseTicketHandlers.get(ctx), 'u1', ctx.__ticketDetailSnapshot) };
  const ticketAccessHandlers = load(
    read('backend/src/modules/ticket-access.module.js'),
    { ...errors, readTable, readTables, findById, filterRows: (rows) => rows, selectTicketPage: () => ({}), ticketHandlers: {}, pick },
    'ticketAccessHandlers',
  ).ticketAccessHandlers;
  const { assertTicketPayloadAccess } = load(
    read('backend/src/services/ticket-access.service.js'),
    { ...errors, findById, findRows, pick },
    'assertTicketPayloadAccess',
  );
  const ticketDeliveryHandlers = { get: async () => ({ candidates: true }) };
  load(read('backend/src/services/ticket-detail-read-optimization.patch.js'), { ...errors, pick, findById, baseTicketHandlers, ticketMultiHandlers, ticketAccessHandlers, ticketDeliveryHandlers, assertTicketPayloadAccess, createTicketDetailSnapshot: optimized ? snapshotFactory : () => ({ read: readTable, locate: (rows, id) => rows.find(row => row.BoletaUID === id) }) }, '');
  const ctx = { payload: { boletaUid: 'b1' }, user: { UsuarioID: 'u1' }, permissions: [permission] };
  return { get: () => ticketDeliveryHandlers.get(ctx), ctx, reads, writes, tables, tracker, snapshotFactory, group, ticketDeliveryHandlers };
}

test('detalle: payload canónico e histórico idéntico, sin enrichment base duplicado', async () => {
  for (const legacy of [false, true]) for (const emptyCatalogs of [false, true]) {
    const before = harness({ optimized: false, legacy, emptyCatalogs });
    const after = harness({ legacy, emptyCatalogs });
    assert.deepEqual(await after.get(), await before.get());
    assert.deepEqual(after.writes, before.writes);
    assert.equal(after.reads.filter(name => name === 'Boletas').length, legacy && !emptyCatalogs ? 2 : 1);
    assert.equal(after.reads.filter(name => name === 'BoletaAsignados').length, 1);
    if (emptyCatalogs) assert.equal(after.reads.some(name => ['TiposFalla','TiposDispositivo','Fabricantes','Modelos'].includes(name)), false);
  }
});
test('detalle: ambas políticas siguen denegando técnicos sin asignación y rol gestionar no omite segunda validación', async () => {
  for (const permission of ['BOLETAS_VER','BOLETAS_GESTIONAR']) {
    for (const optimized of [false, true]) {
      const denied = harness({ optimized, permission, assigned: false });
      await assert.rejects(denied.get(), /Solo puede/);
      assert.equal(denied.writes.length, 0);
      const allowed = harness({ optimized, permission });
      assert.equal((await allowed.get()).boleta.BoletaUID, 'b1');
      if (optimized) assert.equal(allowed.reads.filter(name => name === 'BoletaAsignados').length, 1);
    }
  }
});
test('snapshot: coalesce lecturas y limita relaciones al grupo de la boleta', async () => {
  const h = harness();
  const seed = h.tables.Boletas.find((row) => row.BoletaUID === 'b1');
  const snapshot = h.snapshotFactory(seed);
  const before = h.reads.length;
  const [a, b] = await Promise.all([snapshot.read('Boletas'), snapshot.read('Boletas')]);
  assert.equal(a, b);
  assert.ok(a.some((row) => row.BoletaUID === 'b1'));
  const afterFirst = h.reads.length;
  assert.ok(afterFirst > before);
  const c = await snapshot.read('Boletas');
  assert.equal(c, a);
  assert.equal(h.reads.length, afterFirst);
  const assignments = await snapshot.read('BoletaAsignados');
  const groupIds = new Set(a.map((row) => String(row.BoletaUID)));
  assert.ok(assignments.every((row) => groupIds.has(String(row.BoletaUID))));
});
test('detalle: selector de vinculaciones mantiene el handler anterior', async () => {
  const h = harness(); h.ctx.payload.visitLinkCandidates = true;
  assert.deepEqual(await h.get(), { candidates: true });
  assert.equal(h.reads.length, 0);
});
