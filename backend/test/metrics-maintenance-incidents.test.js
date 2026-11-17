import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMaintenanceMetrics } from '../src/modules/metrics.module.js';

const client = 'Cliente de prueba';
const date = '2026-11-13';

function sampleTables() {
  const devices = Array.from({ length: 506 }, (_, i) => ({
    EvidenciaMantenimientoID: `falla-${i}`,
    MantenimientoRef: 'maintenance-1',
    NombreDispositivo: `Cámara ${i}`,
    Zona: 'Edificio Central',
    Categoria: 'Cámaras',
    Funcionamiento: i === 0 ? 'No funciona' : 'NO',
    CreadoPor: i === 0 ? 'technician-1' : '',
    EnUso: 'SI, EN USO',
    Observacion: 'Sin señal de video. Revisar cableado y alimentación.',
  }));
  devices.push({
    EvidenciaMantenimientoID: 'functional-1',
    MantenimientoRef: 'maintenance-1',
    NombreDispositivo: 'Cámara funcional',
    Categoria: 'Cámaras',
    Funcionamiento: 'SI',
    EnUso: 'NO, ESTÁ GUARDADO',
  }, {
    EvidenciaMantenimientoID: 'unknown-1',
    MantenimientoRef: 'maintenance-1',
    NombreDispositivo: 'Cámara sin revisar',
    Categoria: 'Cámaras',
    Funcionamiento: '',
  }, {
    EvidenciaMantenimientoID: 'other-date-failure',
    MantenimientoRef: 'maintenance-3',
    NombreDispositivo: 'Fecha diferente',
    Categoria: 'Cámaras',
    Funcionamiento: 'NO',
  }, {
    EvidenciaMantenimientoID: 'other-client-failure',
    MantenimientoRef: 'maintenance-2',
    NombreDispositivo: 'No debe incluirse',
    Categoria: 'Cámaras',
    Funcionamiento: 'NO',
  });
  return {
    Mantenimiento: [
      { MantenimientoID: 'maintenance-1', Cliente: client, Fecha: date, CantCámaras: 508 },
      { MantenimientoID: 'maintenance-2', Cliente: 'Otro cliente', Fecha: date, CantCámaras: 1 },
      { MantenimientoID: 'maintenance-3', Cliente: client, Fecha: '2026-11-14', CantCámaras: 1 },
    ],
    Evidencia_Mantenimientos: devices,
    'Mantenimiento imagenes': [],
    Usuarios: [{ UsuarioID: 'technician-1', NombreCompleto: 'Técnico Responsable' }],
  };
}

test('el dashboard devuelve dispositivos de todos los estados, respetando filtros existentes', () => {
  const tables = sampleTables();
  const result = buildMaintenanceMetrics(tables, { cliente: client, fecha: date });
  assert.equal(result.totals.dispositivosRegistrados, 508);
  assert.equal(result.totals.dispositivosFiltrados, 508);
  assert.equal(result.charts.operating, 1);
  assert.equal(result.charts.failing, 507); // Incluye "sin dato" como antes en la gráfica.
  assert.equal(result.charts.activeUse, 506);
  assert.equal(result.charts.stored, 1);
  assert.equal(result.detailRows.length, 500); // Límite histórico solo del dashboard.

  const functional = buildMaintenanceMetrics(tables, { cliente: client, fecha: date, funcionamientoGrupo: 'operativo' });
  assert.equal(functional.detailRows.length, 1);
  assert.equal(functional.detailRows[0].nombreDispositivo, 'Cámara funcional');
  assert.equal(functional.charts.operating, 1);

  const notFunctional = buildMaintenanceMetrics(tables, { cliente: client, fecha: date, funcionamientoGrupo: 'falla' });
  assert.equal(notFunctional.detailRows.length, 500);
  assert.equal(notFunctional.totals.dispositivosFiltrados, 507);
  assert.equal(notFunctional.charts.failing, 507);

  const unknown = buildMaintenanceMetrics(tables, { cliente: client, fecha: date, funcionamiento: 'Sin dato' });
  assert.equal(unknown.detailRows.length, 1);
  assert.equal(unknown.detailRows[0].nombreDispositivo, 'Cámara sin revisar');
});

test('la exportación permite solo fallas, todos o solo funcionales sin alterar las métricas', () => {
  const tables = sampleTables();
  const exportBase = { cliente: client, fecha: date, reporteIncidencias: true };
  const failures = buildMaintenanceMetrics(tables, { ...exportBase, detalleReporte: 'fallas' });
  const all = buildMaintenanceMetrics(tables, { ...exportBase, detalleReporte: 'todos' });
  const functional = buildMaintenanceMetrics(tables, { ...exportBase, detalleReporte: 'funcionales' });

  assert.equal(failures.detailRows.length, 506);
  assert.equal(all.detailRows.length, 508); // No se limita a 500 para el PDF.
  assert.equal(functional.detailRows.length, 1);
  assert.equal(functional.detailRows[0].nombreDispositivo, 'Cámara funcional');
  assert.ok(all.detailRows.some((row) => row.nombreDispositivo === 'Cámara sin revisar'));
  assert.ok(failures.detailRows.every((row) => row.averiado && !row.operativo));
  assert.ok(!failures.detailRows.some((row) => row.nombreDispositivo === 'Cámara sin revisar'));
  assert.ok(!failures.detailRows.some((row) => row.nombreDispositivo === 'Cámara funcional'));
  for (const report of [failures, all, functional]) {
    assert.equal(report.totals.dispositivosFiltrados, 508);
    assert.equal(report.charts.operating, 1);
    assert.equal(report.charts.failing, 507);
    assert.ok(report.detailRows.every((row) => row.cliente === client && row.fechaMantenimiento === date));
  }
  assert.equal(failures.detailRows.find((row) => row.nombreDispositivo === 'Cámara 0').creador, 'Técnico Responsable');
  assert.equal(failures.filtersApplied.detalleReporte, 'fallas');
  assert.equal(all.filtersApplied.detalleReporte, 'todos');
  assert.equal(functional.filtersApplied.detalleReporte, 'funcionales');

  // Compatibilidad con el botón/consumidor previo que enviaba solo reporteIncidencias.
  assert.equal(buildMaintenanceMetrics(tables, exportBase).detailRows.length, 506);
});

test('la exportación exige cliente y fecha para evitar informes globales accidentales', () => {
  assert.throws(
    () => buildMaintenanceMetrics(sampleTables(), { reporteIncidencias: true, cliente: client }),
    /cliente y una fecha/,
  );
  assert.throws(
    () => buildMaintenanceMetrics(sampleTables(), { reporteIncidencias: true, fecha: date }),
    /cliente y una fecha/,
  );
});

test('la selección del PDF se valida en backend aunque no se envíe el indicador legado', () => {
  assert.throws(
    () => buildMaintenanceMetrics(sampleTables(), { cliente: client, fecha: date, detalleReporte: 'desconocido' }),
    /tipo válido/,
  );
  assert.throws(
    () => buildMaintenanceMetrics(sampleTables(), { cliente: client, detalleReporte: 'todos' }),
    /cliente y una fecha/,
  );
  const all = buildMaintenanceMetrics(sampleTables(), { cliente: client, fecha: date, detalleReporte: 'todos' });
  assert.equal(all.detailRows.length, 508);
});
