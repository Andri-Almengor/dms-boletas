import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { buildExistingVisitLinkPlan } from '../../backend/src/services/ticket-existing-visit-link.domain.js';

function ticket(id, number, client = 'CLIENTE-A', extra = {}) {
  return {
    BoletaUID: id,
    BoletaID: number,
    ClienteID: client,
    Estado: 'PENDIENTE',
    Activo: true,
    GrupoVisitaID: id,
    BoletaPrincipalUID: id,
    NumeroVisita: 1,
    Version: 1,
    ...extra,
  };
}

function targetGroup(visits) {
  return {
    id: visits[0].GrupoVisitaID,
    rootId: visits[0].BoletaPrincipalUID,
    root: visits[0],
    visits,
  };
}

test('existing pending tickets from the same client are appended to the current visit group', () => {
  const root = ticket('A', 100, 'CLIENTE-A', { GrupoVisitaID: 'A', BoletaPrincipalUID: 'A', NumeroVisita: 1 });
  const second = ticket('B', 101, 'CLIENTE-A', { GrupoVisitaID: 'A', BoletaPrincipalUID: 'A', NumeroVisita: 2, EsVisitaPrincipal: false });
  const candidateOne = ticket('C', 103, 'CLIENTE-A', { Fecha: '2026-09-13' });
  const candidateTwo = ticket('D', 102, 'CLIENTE-A', { Fecha: '2026-09-12' });

  const plan = buildExistingVisitLinkPlan({
    rows: [root, second, candidateOne, candidateTwo],
    targetGroup: targetGroup([root, second]),
    selectedIds: ['C', 'D'],
    actor: 'USER-1',
    timestamp: '2026-09-14T12:00:00.000Z',
  });

  assert.deepEqual(plan.linkedIds, ['D', 'C']);
  assert.equal(plan.updates[0].patch.NumeroVisita, 3);
  assert.equal(plan.updates[1].patch.NumeroVisita, 4);
  assert.equal(plan.updates[0].patch.GrupoVisitaID, 'A');
  assert.equal(plan.updates[0].patch.BoletaPrincipalUID, 'A');
  assert.equal(plan.updates[0].patch.EsVisitaPrincipal, false);
  assert.equal(plan.updates.at(-1).idValue, 'A');
});

test('linking rejects a pending ticket from another client', () => {
  const root = ticket('A', 100, 'CLIENTE-A');
  const foreign = ticket('B', 101, 'CLIENTE-B');
  assert.throws(() => buildExistingVisitLinkPlan({
    rows: [root, foreign],
    targetGroup: targetGroup([root]),
    selectedIds: ['B'],
  }), /pertenece a otro cliente/i);
});

test('linking rejects a ticket that already belongs to another multi-visit follow-up', () => {
  const root = ticket('A', 100, 'CLIENTE-A');
  const otherRoot = ticket('B', 101, 'CLIENTE-A', { GrupoVisitaID: 'B', BoletaPrincipalUID: 'B' });
  const otherVisit = ticket('C', 102, 'CLIENTE-A', { GrupoVisitaID: 'B', BoletaPrincipalUID: 'B', NumeroVisita: 2 });
  assert.throws(() => buildExistingVisitLinkPlan({
    rows: [root, otherRoot, otherVisit],
    targetGroup: targetGroup([root]),
    selectedIds: ['B'],
  }), /otro seguimiento/i);
});

test('linking is idempotent when the selected ticket is already in the target group', () => {
  const root = ticket('A', 100, 'CLIENTE-A');
  const second = ticket('B', 101, 'CLIENTE-A', { GrupoVisitaID: 'A', BoletaPrincipalUID: 'A', NumeroVisita: 2 });
  const plan = buildExistingVisitLinkPlan({
    rows: [root, second],
    targetGroup: targetGroup([root, second]),
    selectedIds: ['B'],
  });
  assert.deepEqual(plan.linkedIds, []);
  assert.deepEqual(plan.alreadyLinkedIds, ['B']);
  assert.deepEqual(plan.updates, []);
});

test('linking only operates on fully pending target groups', () => {
  const root = ticket('A', 100, 'CLIENTE-A', { Estado: 'FINALIZADA' });
  const candidate = ticket('B', 101, 'CLIENTE-A');
  assert.throws(() => buildExistingVisitLinkPlan({
    rows: [root, candidate],
    targetGroup: targetGroup([root]),
    selectedIds: ['B'],
  }), /completamente pendiente/i);
});

test('existing visit linking reuses ticket access, shared signature and existing update route', () => {
  const service = fs.readFileSync('backend/src/services/ticket-existing-visit-link.service.js', 'utf8');
  const visibility = fs.readFileSync('backend/src/services/ticket-visibility.patch.js', 'utf8');
  const modal = fs.readFileSync('src/components/tickets/TicketLinkExistingVisitsModal.jsx', 'utf8');
  const panel = fs.readFileSync('src/components/tickets/TicketVisitGroupPanel.jsx', 'utf8');

  assert.match(service, /assertTicketPayloadAccess\(ctx, \{ boletaUid: candidateId \}\)/);
  assert.match(service, /synchronizeVisitGroupSignature\(targetGroup\.rootId, actor\)/);
  assert.match(service, /readTable\('Boletas', \{ force: true \}\)/);
  assert.match(visibility, /key === 'update' && isExistingVisitLinkRequest/);
  assert.match(modal, /apiRequest\('boletas\.update'/);
  assert.match(modal, /type="checkbox"/);
  assert.match(modal, /status: 'PENDIENTE'/);
  assert.match(modal, /clienteId/);
  assert.match(panel, /Vincular boletas/);
  assert.match(panel, /Añadir otra visita/);
});
