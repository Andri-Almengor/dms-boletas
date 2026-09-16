import test from 'node:test';
import assert from 'node:assert/strict';
import { materializeCrudDeltaFromRows } from '../src/core/sync-crud-delta.js';

function event(id, operation = 'UPSERT') {
  return { EntityID: id, Operation: operation };
}

test('CRUD delta materializes changed rows and strips repository row metadata', () => {
  const result = materializeCrudDeltaFromRows({
    events: [event('C-2')],
    rows: [
      { ClienteID: 'C-1', Nombre: 'Uno', __rowNumber: 2 },
      { ClienteID: 'C-2', Nombre: 'Dos', __rowNumber: 3 },
    ],
    idField: 'ClienteID',
  });

  assert.deepEqual(result.upserts, [{ ClienteID: 'C-2', Nombre: 'Dos' }]);
  assert.deepEqual(result.removed, []);
  assert.equal(result.upserts[0].__rowNumber, undefined);
});

test('CRUD delta treats deletes and missing changed rows as removals', () => {
  const result = materializeCrudDeltaFromRows({
    events: [event('C-1', 'DELETE'), event('C-404')],
    rows: [{ ClienteID: 'C-1', Nombre: 'Uno' }],
    idField: 'ClienteID',
  });

  assert.deepEqual(result.upserts, []);
  assert.deepEqual(result.removed.sort(), ['C-1', 'C-404']);
});

test('CRUD delta applies resource sanitization transform once per entity', () => {
  const result = materializeCrudDeltaFromRows({
    events: [event('C-1'), event('C-1')],
    rows: [{ ClienteID: 'C-1', Nombre: 'Uno', ChatWebhook: 'secret' }],
    idField: 'ClienteID',
    transformRow: ({ ChatWebhook: _secret, ...row }) => ({ ...row, ChatConfigurado: true }),
  });

  assert.deepEqual(result.upserts, [{ ClienteID: 'C-1', Nombre: 'Uno', ChatConfigurado: true }]);
  assert.equal(result.upserts[0].ChatWebhook, undefined);
});
