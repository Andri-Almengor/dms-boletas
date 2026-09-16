import test from 'node:test';
import assert from 'node:assert/strict';
import { materializeTicketDeltaFromRows } from '../src/core/sync-ticket-delta.js';

const tickets = [
  { BoletaUID: 'B-1', BoletaID: 1, Estado: 'PENDIENTE', Fecha: '2026-09-16', Activo: true },
  { BoletaUID: 'B-2', BoletaID: 2, Estado: 'FINALIZADA', Fecha: '2026-09-15', Activo: true },
  { BoletaUID: 'B-3', BoletaID: 3, Estado: 'ANULADA', Fecha: '2026-09-14', Activo: true },
];

const assignments = [
  { BoletaAsignadoID: 'A-1', BoletaUID: 'B-1', UsuarioID: 'U-1', Activo: true },
  { BoletaAsignadoID: 'A-2', BoletaUID: 'B-2', UsuarioID: 'U-2', Activo: true },
];

function context(userId, permissions = ['BOLETAS_VER']) {
  return { user: { UsuarioID: userId }, permissions };
}

function event(entityId, operation = 'UPSERT') {
  return { EntityID: entityId, Operation: operation, __rowNumber: 10 };
}

test('assigned technician receives only authoritative visible ticket', () => {
  const result = materializeTicketDeltaFromRows({
    ctx: context('U-1'),
    events: [event('B-1'), event('B-2')],
    tickets,
    assignments,
  });
  assert.deepEqual(result.upserts.map((row) => row.BoletaUID), ['B-1']);
  assert.deepEqual(result.removed, ['B-2']);
  assert.deepEqual(result.counts, { pending: 1, finished: 0 });
});

test('assignment removal becomes removal even while ticket still exists', () => {
  const result = materializeTicketDeltaFromRows({
    ctx: context('U-1'),
    events: [event('B-1')],
    tickets,
    assignments: assignments.filter((row) => row.BoletaUID !== 'B-1'),
  });
  assert.deepEqual(result.upserts, []);
  assert.deepEqual(result.removed, ['B-1']);
});

test('assignment gain becomes upsert', () => {
  const result = materializeTicketDeltaFromRows({
    ctx: context('U-1'),
    events: [event('B-2')],
    tickets,
    assignments: [...assignments, { BoletaAsignadoID: 'A-3', BoletaUID: 'B-2', UsuarioID: 'U-1', Activo: true }],
  });
  assert.equal(result.upserts.length, 1);
  assert.equal(result.upserts[0].BoletaUID, 'B-2');
  assert.deepEqual(result.counts, { pending: 1, finished: 1 });
});

test('administrator keeps current full visibility and authoritative counts', () => {
  const result = materializeTicketDeltaFromRows({
    ctx: context('ADMIN', ['BOLETAS_VER', 'USUARIOS_GESTIONAR']),
    events: [event('B-1'), event('B-2')],
    tickets,
    assignments,
  });
  assert.deepEqual(result.upserts.map((row) => row.BoletaUID), ['B-1', 'B-2']);
  assert.deepEqual(result.counts, { pending: 1, finished: 1 });
});

test('annulled, missing and explicit deletes always remove cached entity', () => {
  const result = materializeTicketDeltaFromRows({
    ctx: context('ADMIN', ['BOLETAS_VER', 'USUARIOS_GESTIONAR']),
    events: [event('B-3'), event('B-404'), event('B-2', 'DELETE')],
    tickets,
    assignments,
  });
  assert.deepEqual(result.upserts, []);
  assert.deepEqual(result.removed, ['B-3', 'B-404', 'B-2']);
});
