import test from 'node:test';
import assert from 'node:assert/strict';
import { materializeMaintenanceDeltaFromRows } from '../src/core/sync-maintenance-delta.js';

function event(id, operation = 'UPSERT') {
  return { EntityID: id, Operation: operation };
}

function countedIterable(rows) {
  let iterations = 0;
  return {
    iterable: {
      *[Symbol.iterator]() {
        iterations += 1;
        yield* rows;
      },
    },
    iterations: () => iterations,
  };
}

test('maintenance delta returns only changed authoritative rows and device counts', () => {
  const result = materializeMaintenanceDeltaFromRows({
    events: [event('M-2')],
    maintenances: [
      { MantenimientoID: 'M-1', Estado: 'PENDIENTE', Activo: true },
      { MantenimientoID: 'M-2', Estado: 'FINALIZADO', Activo: true, TituloMantenimiento: 'Segundo' },
    ],
    devices: [
      { EvidenciaMantenimientoID: 'D-1', MantenimientoRef: 'M-2', Activo: true },
      { EvidenciaMantenimientoID: 'D-2', MantenimientoRef: 'M-2', Activo: false },
    ],
  });

  assert.equal(result.upserts.length, 1);
  assert.equal(result.upserts[0].MantenimientoID, 'M-2');
  assert.equal(result.upserts[0].DispositivosRegistrados, 1);
  assert.deepEqual(result.counts, { pending: 1, finished: 1 });
});

test('maintenance deletion or inactive authoritative row becomes removal', () => {
  const result = materializeMaintenanceDeltaFromRows({
    events: [event('M-1'), event('M-2', 'DELETE')],
    maintenances: [
      { MantenimientoID: 'M-1', Estado: 'PENDIENTE', Activo: false },
      { MantenimientoID: 'M-2', Estado: 'PENDIENTE', Activo: true },
    ],
  });
  assert.deepEqual(result.upserts, []);
  assert.deepEqual(result.removed, ['M-1', 'M-2']);
});

test('maintenance finalized status is normalized for list convergence', () => {
  const result = materializeMaintenanceDeltaFromRows({
    events: [event('M-9')],
    maintenances: [{ MantenimientoID: 'M-9', Estado: 'FINALIZADA', Activo: true }],
  });
  assert.equal(result.upserts[0].Estado, 'FINALIZADO');
  assert.deepEqual(result.counts, { pending: 0, finished: 1 });
});

test('maintenance delta traverses maintenance and device snapshots only once', () => {
  const maintenanceRows = countedIterable([
    { MantenimientoID: 'M-1', Estado: 'PENDIENTE', Activo: true },
    { MantenimientoID: 'M-2', Estado: 'FINALIZADA', Activo: true },
  ]);
  const deviceRows = countedIterable([
    { MantenimientoRef: 'M-2', Activo: true },
    { MantenimientoRef: 'M-1', Activo: true },
  ]);

  const result = materializeMaintenanceDeltaFromRows({
    events: [event('M-2')],
    maintenances: maintenanceRows.iterable,
    devices: deviceRows.iterable,
  });

  assert.equal(maintenanceRows.iterations(), 1);
  assert.equal(deviceRows.iterations(), 1);
  assert.equal(result.upserts[0].MantenimientoID, 'M-2');
  assert.equal(result.upserts[0].DispositivosRegistrados, 1);
  assert.deepEqual(result.counts, { pending: 1, finished: 1 });
});
