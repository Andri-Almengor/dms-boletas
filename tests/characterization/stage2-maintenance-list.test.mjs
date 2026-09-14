import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addVisibleMaintenanceDeviceCounts,
  selectMaintenancePage,
} from '../../backend/src/services/maintenance-list-domain.js';

test('Etapa 2: cliente se filtra antes del slice y el total usa todo el conjunto filtrado', () => {
  const rows = [
    ...Array.from({ length: 45 }, (_, index) => ({ MantenimientoID: `acme-${index}`, Cliente: 'Acme', Estado: 'PENDIENTE', Fecha: `2026-08-${String((index % 28) + 1).padStart(2, '0')}`, Activo: true })),
    ...Array.from({ length: 45 }, (_, index) => ({ MantenimientoID: `beta-${index}`, Cliente: 'Beta', Estado: 'PENDIENTE', Fecha: `2026-07-${String((index % 28) + 1).padStart(2, '0')}`, Activo: true })),
  ];
  const result = selectMaintenancePage(rows, { activo: true, estado: 'PENDIENTE', cliente: 'Beta', page: 1, pageSize: 40, sortBy: 'Fecha', sortDir: 'desc' });
  assert.equal(result.total, 45);
  assert.equal(result.items.length, 40);
  assert.ok(result.items.every((row) => row.Cliente === 'Beta'));
});

test('Etapa 2: estado, fechas, búsqueda, orden y total se resuelven antes de paginar', () => {
  const rows = [
    { MantenimientoID: 'm1', Cliente: 'Beta', Estado: 'FINALIZADO', Fecha: '2026-08-03', Responsables: 'Supervisor Norte', TituloMantenimiento: 'Revisión', Activo: true },
    { MantenimientoID: 'm2', ClienteRef: 'Beta', Estado: 'FINALIZADA', Fecha: '2026-08-04', Responsable: 'Supervisor Sur', TituloMantenimiento: 'Revisión', Activo: true },
    { MantenimientoID: 'm3', Cliente: 'Beta', Estado: 'PENDIENTE', Fecha: '2026-08-05', Responsables: 'Supervisor Norte', TituloMantenimiento: 'Revisión', Activo: true },
    { MantenimientoID: 'm4', Cliente: 'Otro', Estado: 'FINALIZADO', Fecha: '2026-08-06', Responsables: 'Supervisor Norte', TituloMantenimiento: 'Revisión', Activo: true },
    { MantenimientoID: 'm5', Cliente: 'Beta', Estado: 'FINALIZADO', Fecha: '2026-07-31', Responsables: 'Supervisor Norte', TituloMantenimiento: 'Revisión', Activo: true },
  ];
  const result = selectMaintenancePage(rows, { activo: true, status: 'FINALIZADO', client: 'Beta', dateFrom: '2026-08-01', dateTo: '2026-08-31', search: 'supervisor', sortBy: 'Fecha', sortDir: 'desc', page: 2, pageSize: 1 });
  assert.equal(result.total, 2);
  assert.deepEqual(result.items.map((row) => row.MantenimientoID), ['m1']);
});

test('Etapa 2: el conteo recorre dispositivos una sola vez y cuenta solo IDs visibles', () => {
  const page = [{ MantenimientoID: 'm1' }, { MantenimientoID: 'm2' }];
  const rawDevices = [
    { MantenimientoRef: 'm1', Activo: true },
    { MantenimientoRef: 'm1', Activo: true },
    { MantenimientoRef: 'm2', Activo: true },
    { MantenimientoRef: 'm2', Activo: false },
    ...Array.from({ length: 100 }, () => ({ MantenimientoRef: 'hidden', Activo: true })),
  ];
  let iterations = 0;
  const devices = { *[Symbol.iterator]() { for (const device of rawDevices) { iterations += 1; yield device; } } };
  const result = addVisibleMaintenanceDeviceCounts(page, devices);
  assert.equal(iterations, rawDevices.length);
  assert.deepEqual(result.map((row) => row.DispositivosRegistrados), [2, 1]);
});
