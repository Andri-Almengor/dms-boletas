import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMaintenanceVisualReportHtml,
  buildMaintenanceVisualReportModel,
  visualDeviceState,
} from '../src/services/maintenance-visual-docs.service.js';
import { buildMaintenanceMetrics } from '../src/modules/metrics.module.js';

function metrics() {
  const devices = [
    { EvidenciaMantenimientoID: 'healthy', NombreDispositivo: 'Cámara sana', Categoria: 'Cámaras', Estado: 'Buen estado', Funcionamiento: 'Sí' },
    { EvidenciaMantenimientoID: 'low', NombreDispositivo: 'Puerta leve', Categoria: 'Puertas', Estado: 'Mal estado', GravedadFalla: 'Leve', Funcionamiento: 'No' },
    { EvidenciaMantenimientoID: 'critical', NombreDispositivo: 'Cámara crítica', Categoria: 'Cámaras', Estado: 'Mal estado', GravedadFalla: 'Crítica', Funcionamiento: 'No', Observacion: '<script>alert("hola")</script>' },
    { EvidenciaMantenimientoID: 'moderate', NombreDispositivo: 'Cámara moderada', Categoria: 'Cámaras', Estado: 'Mal estado', GravedadFalla: 'Moderada', Funcionamiento: 'No' },
    { EvidenciaMantenimientoID: 'legacy', NombreDispositivo: 'Puerta histórica', Categoria: 'Puertas', Funcionamiento: 'NO' },
    { EvidenciaMantenimientoID: 'pending', NombreDispositivo: 'Equipo pendiente', Categoria: 'Sensores', Funcionamiento: 'Sin dato' },
  ].map((row) => ({ MantenimientoRef: 'm1', ...row }));
  const tables = {
    Mantenimiento: [{ MantenimientoID: 'm1', Cliente: 'Cliente seguro', Fecha: '2026-11-17' }],
    Evidencia_Mantenimientos: devices,
    'Mantenimiento imagenes': [],
    Usuarios: [],
  };
  return buildMaintenanceMetrics(tables, {
    cliente: 'Cliente seguro', fecha: '2026-11-17', reporteIncidencias: true, detalleReporte: 'todos',
  });
}

test('Google Docs: resumen usa todos los equipos; solo la tabla obedece al filtro', () => {
  const data = metrics();
  const all = buildMaintenanceVisualReportModel(data, 'todos');
  assert.equal(all.total, 6);
  assert.equal(all.healthy, 1);
  assert.equal(all.damaged, 4);
  assert.equal(all.pending, 1);
  assert.equal(all.evaluated, 5);
  assert.equal(all.health, 20);
  assert.deepEqual(all.categories.map((row) => [row.categoria, row.total, row.danados]), [
    ['Cámaras', 3, 2], ['Puertas', 2, 2], ['Sensores de movimiento', 1, 0],
  ]);
  assert.deepEqual(all.rows.map((r) => r.deviceId), ['critical', 'moderate', 'low', 'legacy', 'healthy', 'pending']);
  const bad = buildMaintenanceVisualReportModel(data, 'danados');
  const good = buildMaintenanceVisualReportModel(data, 'sanos');
  assert.deepEqual(bad.rows.map((r) => r.deviceId), ['critical', 'moderate', 'low', 'legacy']);
  assert.deepEqual(good.rows.map((r) => r.deviceId), ['healthy']);
  assert.equal(bad.health, 20);
  assert.equal(good.damaged, 4);
});

test('Google Docs: valida completos, filtro y evita contar pendientes como averías', () => {
  const data = metrics();
  assert.equal(visualDeviceState({ funcionamiento: 'Sin dato' }).kind, 'sin_evaluar');
  assert.equal(visualDeviceState({ estado: 'Mal estado', operativo: true, gravedadFalla: 'Crítica' }).kind, 'danado');
  assert.throws(() => buildMaintenanceVisualReportModel({ ...data, reportDetailCount: 2 }), /incompletos/);
  assert.throws(() => buildMaintenanceVisualReportModel(data, 'no_operativos'), /Seleccione/);
  const empty = buildMaintenanceVisualReportModel({
    ...data, detailRows: [], reportDetailCount: 0, totals: { dispositivosFiltrados: 0 },
  });
  assert.equal(empty.health, null);
  assert.equal(empty.total, 0);
});

test('Google Docs: tablas visuales, logo DMS y recomendaciones editables; observaciones escapadas', () => {
  const documentHtml = buildMaintenanceVisualReportHtml(buildMaintenanceVisualReportModel(metrics()));
  assert.match(documentHtml, /dms-report-logo\.png/);
  assert.match(documentHtml, /Salud del sistema/);
  assert.match(documentHtml, /Distribución por tipo/);
  assert.match(documentHtml, /Recomendaciones/);
  assert.match(documentHtml, /Crítica → Moderada → Leve/);
  assert.match(documentHtml, /&lt;script&gt;alert\(&quot;hola&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(documentHtml, /<script>/);
  assert.equal((documentHtml.match(/<td><b>Cámara|<td>Cámara/g) || []).length >= 1, true);
});

test('PDF existente: la tabla exportada conserva todas las filas y prioridad', () => {
  const data = metrics();
  assert.deepEqual(data.detailRows.map((r) => r.deviceId),
    ['critical', 'moderate', 'low', 'legacy', 'healthy', 'pending']);
  assert.equal(data.reportDetailCount, data.detailRows.length);
});
