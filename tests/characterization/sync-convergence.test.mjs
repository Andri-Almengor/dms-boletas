import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSyncFixture, loadSyncManager } from '../helpers/load-sync-fixture.mjs';
import { materializeTicketDeltaFromRows, ticketSyncAllowedIds } from '../../backend/src/core/sync-ticket-delta.js';
import { selectTicketPage } from '../../backend/src/services/ticket-list-query.service.js';

const canonical = (items) => items.map(({ __sync, ...row }) => row);

test('seeded ticket mutations converge for admin and both technicians, including replay', async () => {
  const core = await loadSyncFixture();
  const { patchTicketCollection } = await loadSyncManager(core, () => {});
  const users = [
    { user: { UsuarioID: 'admin' }, permissions: ['USUARIOS_GESTIONAR'] },
    { user: { UsuarioID: 'U1' }, permissions: ['BOLETAS_VER'] },
    { user: { UsuarioID: 'U2' }, permissions: ['BOLETAS_VER'] },
  ];
  const queries = [{ status: 'PENDIENTE' }, { status: 'FINALIZADA' }, { clienteId: 'C1', search: 'ticket' }]
    .map((query) => ({ ...query, page: 1, pageSize: 1000 }));
  const tickets = [];
  let assignments = [];
  const caches = users.map(() => queries.map(() => ({ items: [], total: 0, page: 1, pageSize: 1000 })));
  let seed = 84917;
  const random = (max) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  for (let step = 0; step < 300; step += 1) {
    const index = random(Math.max(1, tickets.length));
    let row = tickets[index];
    const action = step % 8;
    if (!row || action === 0) {
      row = { BoletaUID: `B${tickets.length}`, BoletaID: tickets.length + 1, Titulo: 'ticket', ClienteID: `C${random(2)}`, Estado: 'PENDIENTE', Activo: true, Fecha: '2026-09-16' };
      tickets.push(row);
    } else if (action === 1) row.Titulo = `ticket update ${step}`;
    else if (action === 2) assignments.push({ BoletaUID: row.BoletaUID, UsuarioID: random(2) ? 'U1' : 'U2', Activo: true });
    else if (action === 3) assignments = assignments.filter((a) => a.BoletaUID !== row.BoletaUID);
    else if (action === 4) row.Estado = 'FINALIZADA';
    else if (action === 5) row.Estado = 'PENDIENTE';
    else if (action === 6) row.Estado = 'ANULADA';
    else row.FechaActualizacion = `evidence-${step}`;
    for (const [userIndex, ctx] of users.entries()) {
      const delta = materializeTicketDeltaFromRows({ ctx, tickets, assignments, events: [{ EntityID: row.BoletaUID, Operation: 'UPSERT' }] });
      for (const [queryIndex, query] of queries.entries()) {
        const next = patchTicketCollection(caches[userIndex][queryIndex], query, delta);
        assert.deepEqual(patchTicketCollection(next, query, delta), next, `idempotence ${step}`);
        caches[userIndex][queryIndex] = structuredClone(next);
        const full = selectTicketPage(tickets, query, ticketSyncAllowedIds(ctx, assignments));
        assert.deepEqual(canonical(next.items), full.items, `step ${step}, user ${userIndex}, query ${queryIndex}`);
        assert.equal(next.total, full.total);
      }
    }
  }
});

test('partial page requires repair after boundary changes instead of claiming convergence', async () => {
  const core = await loadSyncFixture();
  const { patchTicketCollection } = await loadSyncManager(core, () => {});
  const result = patchTicketCollection({ items: [{ BoletaUID: 'B1', Estado: 'PENDIENTE' }], total: 10, page: 1, pageSize: 1 },
    { status: 'PENDIENTE', page: 1, pageSize: 1 }, { removed: ['B1'], counts: { pending: 9, finished: 0 } });
  assert.equal(result.syncIntegrityPending, true);
  assert.equal(result.total, 9);
});
