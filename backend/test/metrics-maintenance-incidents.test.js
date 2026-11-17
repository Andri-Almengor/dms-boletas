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
    EvidenciaMantenimientoID: 'other-client-failure',
    MantenimientoRef: 'maintenance-2',
    NombreDispositivo: 'No debe incluirse',
    Categoria: 'Cámaras',
    Funcionamiento: 'NO',
  });
  return {
    Mantenimiento: [
      { MantenimientoID: 'maintenance-1', Cliente: client, Fecha: date, CantCámaras: 507 },
      { MantenimientoID: 'maintenance-2', Cliente: 'Otro cliente', Fecha: date, CantCámaras: 1 },
    ],
    Evidencia_Mantenimientos: devices,
    'Mantenimiento imagenes': [],
    Usuarios: [],
  };
}

test('las métricas conservan los equipos funcionales y el detalle muestra solo incidencias', () => {
  const result = buildMaintenanceMetrics(sampleTables(), { cliente: client, fecha: date });
  assert.equal(result.totals.dispositivosRegistrados, 507);
  assert.equal(result.charts.operating, 1);
  assert.equal(result.charts.failing, 506);
  assert.equal(result.charts.activeUse, 506);
  assert.equal(result.charts.stored, 1);
  assert.equal(result.detailRows.length, 500);
  assert.ok(result.detailRows.every((row) => row.operativo === false));
  assert.ok(result.detailRows.some((row) => row.funcionamiento === 'No funciona'));
});

test('la exportación recupera todas las incidencias y nunca mezcla clientes ni fechas', () => {
  const result = buildMaintenanceMetrics(sampleTables(), {
    cliente: client,
    fecha: date,
    reporteIncidencias: true,
  });
  assert.equal(result.detailRows.length, 506);
  assert.equal(result.totals.dispositivosFiltrados, 507);
  assert.ok(result.detailRows.every((row) => row.cliente === client && row.fechaMantenimiento === date));
  assert.ok(!result.detailRows.some((row) => row.nombreDispositivo === 'Cámara funcional'));
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
