import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { selectTicketPage } from '../../backend/src/services/ticket-list-query.service.js';
import { referenceTicketList } from '../fixtures/ticket-list-reference.mjs';
import { criticalTickets } from '../fixtures/critical-tickets.mjs';

function loadHandler(tables, calls) {
  const source = readFileSync(new URL('../../backend/src/modules/ticket-access.module.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export const ticketAccessHandlers', 'const ticketAccessHandlers');
  const queryTicketPage = async (payload, { assignedUserId = '' } = {}) => {
    calls.push({ payload, assignedUserId });
    const assigned = String(assignedUserId || '').trim();
    const allowedIds = assigned
      ? new Set((tables.BoletaAsignados || [])
        .filter((row) => row.Activo !== false
          && String(row.Activo ?? 'true').toLowerCase() !== 'false'
          && String(row.UsuarioID || '').trim() === assigned)
        .map((row) => String(row.BoletaUID || '').trim())
        .filter(Boolean))
      : null;
    return selectTicketPage(tables.Boletas, payload, allowedIds);
  };
  return new Function('queryTicketPage', 'selectTicketPage', `${source}; return ticketAccessHandlers.list;`)(
    queryTicketPage,
    selectTicketPage,
  );
}
for (const count of [1000, 10000]) {
  test(`listas reales: equivalencia con ${count} boletas, admin/técnico, estados y páginas`, async () => {
    const tables = criticalTickets(count);
    const handler = loadHandler(tables, []);
    for (const admin of [true, false]) for (const status of ['PENDIENTE', 'FINALIZADA', 'FINALIZADO', '']) {
      for (const page of [1, 2, 7]) for (const extra of [{}, { search: 'cámara 1' }, { dateFrom: '2026-09-08', dateTo: '2026-09-22' }, { clienteId: 'c1', categoriaId: 'cat1' }, { asignadoUsuarioId: 'u2' }]) {
        const payload = { status, estado: 'FINALIZADO', page, pageSize: 50, ...extra };
        const ctx = { payload, user: { UsuarioID: 'u0' }, permissions: admin ? ['BOLETAS_GESTIONAR'] : [] };
        assert.deepEqual(await handler(ctx), referenceTicketList(tables, { ...ctx, admin }));
      }
    }
  });
}
test('Home: resumen coincide con los dos conteos anteriores, últimas 3 con el listado anterior', async () => {
  const tables = criticalTickets(10000);
  const reads = [];
  const handler = loadHandler(tables, reads);
  for (const admin of [true, false]) {
    const payload = { page: 1, pageSize: 3, homeSummary: true, sortBy: 'Fecha', sortDir: 'desc' };
    const ctx = { payload, user: { UsuarioID: 'u0' }, permissions: admin ? ['USUARIOS_GESTIONAR'] : [] };
    const expected = referenceTicketList(tables, { ...ctx, admin });
    const actual = await handler(ctx);
    assert.deepEqual(actual, { ...expected, homeSummary: {
      pending: referenceTicketList(tables, { ...ctx, admin, payload: { pageSize: 1, status: 'PENDIENTE', estado: 'PENDIENTE' } }).total,
      finished: referenceTicketList(tables, { ...ctx, admin, payload: { pageSize: 1, status: 'FINALIZADA', estado: 'FINALIZADA' } }).total,
    } });
    assert.equal(reads.at(-1)?.assignedUserId, admin ? '' : 'u0');
  }
});
test('top K conserva empates estables, entradas históricas de paginación y snapshot original', () => {
  const tables = criticalTickets(1000);
  tables.Boletas.forEach(row => { row.Fecha = '2026-01-01'; row.BoletaID = 1; row.FechaCreacion = ''; });
  const before = structuredClone(tables);
  for (const page of [1, 1.5, 2, 90, Infinity, 'invalid']) for (const pageSize of [3, 3.7, 1000, 'invalid']) {
    const payload = { page, pageSize };
    assert.deepEqual(selectTicketPage(tables.Boletas, payload), referenceTicketList(tables, { payload, admin: true }));
  }
  assert.deepEqual(tables, before);
});
