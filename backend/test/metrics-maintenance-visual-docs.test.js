import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMaintenanceVisualReportHtml,
  buildHealthDonutPng,
  buildMaintenanceVisualReportModel,
  finalizeMaintenanceVisualDoc,
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
    Mantenimiento: [{ MantenimientoID: 'm1', Cliente: 'Cliente seguro', Fecha: '2026-11-17', TituloMantenimiento: 'Revisión de videovigilancia', Ubicacion: 'Sede Central' }],
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
    ['Cámaras', 3, 2], ['Puertas', 2, 2], ['Sensores', 1, 0],
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
  assert.match(documentHtml, /Distribución por tipo de dispositivo/);
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

test('Google Docs: la portada lleva el cliente como título, ubicación real y logo corporativo', () => {
  const data = metrics();
  const report = buildMaintenanceVisualReportModel(data, 'todos');
  assert.equal(report.client, 'Cliente seguro');
  assert.equal(report.maintenanceLabel, 'Revisión de videovigilancia');
  assert.equal(report.siteLabel, 'Sede Central');
  const html = buildMaintenanceVisualReportHtml(report);
  assert.match(html, /<h1>Cliente: Cliente seguro<\/h1>/);
  assert.match(html, /Resumen visual del estado del sistema/);
  assert.match(html, /Fecha del informe/);
  assert.match(html, /Mantenimiento:<\/b> Revisión de videovigilancia/);
  assert.match(html, /Sitio:<\/b> Sede Central/);
  assert.match(html, /img src="https:\/\/raw\.githubusercontent\.com\/Andri-Almengor\/dms-boletas\/main\/src\/assets\/dms-report-logo\.png"/);
  assert.match(html, /Total dispositivos/);
  assert.match(html, /En buen estado/);
  assert.match(html, /Dispositivos dañados/);
  assert.match(html, /Salud general/);
  assert.match(html, /Distribución por tipo de dispositivo/);
  assert.match(html, /Recomendaciones/);
  assert.ok(html.indexOf('Cámara crítica') < html.indexOf('Cámara moderada'));
  assert.ok(html.indexOf('Cámara moderada') < html.indexOf('Puerta leve'));
  assert.ok(html.indexOf('Puerta leve') < html.indexOf('Cámara sana'));
});

test('Google Docs: el modelo conserva mantenimientos múltiples sin inventar sitio ni número', () => {
  const original = metrics();
  const data = {
    ...original,
    reportContext: {
      mantenimientos: [
        { titulo: 'Visita inicial', ubicacion: 'Edificio 1' },
        { titulo: 'Visita seguimiento', ubicacion: 'Edificio 2' },
      ],
    },
  };
  const report = buildMaintenanceVisualReportModel(data);
  assert.equal(report.maintenanceLabel, '2 mantenimientos');
  assert.equal(report.siteLabel, 'Varias ubicaciones');
  const html = buildMaintenanceVisualReportHtml(report);
  assert.match(html, /2 mantenimientos/);
  assert.match(html, /Varias ubicaciones/);
  const zero = buildMaintenanceVisualReportModel({ ...data, reportContext: null });
  assert.equal(zero.maintenanceLabel, '');
  assert.equal(zero.siteLabel, '');
  assert.doesNotMatch(buildMaintenanceVisualReportHtml(zero), /<b>Sitio:<\/b>/);
});

test('Google Docs: se establece A4 vertical y se recupera el logo si faltó al convertir', async () => {
  const calls = [];
  const docsApi = {
    documents: {
      get: async () => ({ data: { inlineObjects: {} } }),
      batchUpdate: async (payload) => { calls.push(payload); return { data: {} }; },
    },
  };
  const result = await finalizeMaintenanceVisualDoc({ docsApi, documentId: 'document-123' });
  assert.equal(result.logoRestored, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].documentId, 'document-123');
  const [format, logo] = calls[0].requestBody.requests;
  assert.equal(format.updateDocumentStyle.documentStyle.pageSize.width.magnitude, 595.3);
  assert.equal(format.updateDocumentStyle.documentStyle.pageSize.height.magnitude, 841.9);
  assert.equal(logo.insertInlineImage.location.index, 1);
  assert.match(logo.insertInlineImage.uri, /dms-report-logo\.png/);
});

test('Google Docs: no duplica el logotipo cuando la importación HTML lo conservó', async () => {
  const requests = [];
  const docsApi = {
    documents: {
      get: async () => ({ data: { inlineObjects: { image_1: { inlineObjectProperties: { embeddedObject: { title: 'DMS Solutions Provider' } } } } } }),
      batchUpdate: async (payload) => { requests.push(...payload.requestBody.requests); },
    },
  };
  const result = await finalizeMaintenanceVisualDoc({ docsApi, documentId: 'report-123' });
  assert.equal(result.logoImported, true);
  assert.equal(result.logoRestored, false);
  assert.equal(requests.length, 1);
  assert.ok(requests[0].updateDocumentStyle);
});

test('Google Docs: el cliente y la ubicación se escapan antes de convertir el documento', () => {
  const base = buildMaintenanceVisualReportModel(metrics());
  const html = buildMaintenanceVisualReportHtml({
    ...base, client: '<script>Cliente</script>', siteLabel: 'Norte & Sur',
  });
  assert.match(html, /<h1>Cliente: &lt;script&gt;Cliente&lt;\/script&gt;<\/h1>/);
  assert.match(html, /Norte &amp; Sur/);
  assert.doesNotMatch(html, /<script>/);
});

test('Google Docs: una tabla extensa conserva todos los dispositivos y no solo la primera página', () => {
  const data = metrics();
  const total = 250;
  const detailRows = Array.from({ length: total }, (_, index) => ({
    ...data.detailRows[0], deviceId: `dev-${index}`, nombreDispositivo: `Dispositivo ${index}`,
  }));
  const large = buildMaintenanceVisualReportModel({
    ...data,
    detailRows,
    reportDetailCount: total,
    totals: { ...data.totals, dispositivosFiltrados: total },
  });
  const html = buildMaintenanceVisualReportHtml(large);
  assert.equal(large.rows.length, total);
  assert.match(html, /Dispositivo 249/);
  assert.equal((html.match(/<span style="display:inline-block;border-radius:14px/g) || []).length, total);
});

test('diseño aprobado: bandas rojas, contexto, resumen y gráficos en el orden solicitado', () => {
  const report = buildMaintenanceVisualReportModel(metrics(), 'danados');
  const html = buildMaintenanceVisualReportHtml(report);
  const sections = ['Informe de mantenimiento', 'Responsables / Técnicos', 'Resumen general', 'Salud del sistema', 'Distribución por tipo de dispositivo', 'Dispositivos con fallas', 'Recomendaciones'];
  for (let index = 1; index < sections.length; index++) {
    assert.ok(html.indexOf(sections[index]) > html.indexOf(sections[index - 1]), sections[index]);
  }
  assert.match(html, /class="section-band"/);
  assert.match(html, /class="category-chart"/);
  assert.match(html, /2 fallas/);
  assert.match(html, /data:image\/png;base64,/);
  assert.match(html, /Evidencias:/);
  assert.match(html, /Sin evaluar: 1/);
  assert.equal(report.rows.length, 4);
  assert.equal(report.total, 6);
});

test('dona PNG local: formato válido para importación y extremos de salud', () => {
  for (const model of [{ evaluated: 0, healthy: 0 }, { evaluated: 5, healthy: 0 }, { evaluated: 5, healthy: 5 }]) {
    const png = buildHealthDonutPng(model);
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(png.readUInt32BE(16), 160);
    assert.equal(png.readUInt32BE(20), 160);
    assert.ok(png.length > 100);
  }
});

test('una dona importada sin logo no impide restaurar el logo corporativo', async () => {
  const requests = [];
  const docsApi = { documents: {
    get: async () => ({ data: { inlineObjects: { chart: { inlineObjectProperties: { embeddedObject: { title: 'Gráfico de salud del sistema', size: { width: { magnitude: 81 }, height: { magnitude: 81 } } } } } } } }),
    batchUpdate: async (payload) => { requests.push(...payload.requestBody.requests); },
  } };
  const result = await finalizeMaintenanceVisualDoc({ docsApi, documentId: 'chart-only' });
  assert.equal(result.logoRestored, true);
  assert.ok(requests[1].insertInlineImage);
});


test('PDF visual comparte exactamente el modelo de Docs y conserva las 250 filas en la selección', async () => {
  const { buildMaintenanceVisualReportModel: sharedModel } = await import('../src/services/maintenance-visual-report.model.js');
  assert.equal(sharedModel, buildMaintenanceVisualReportModel);
  const original = metrics();
  const rows = Array.from({ length: 250 }, (_, index) => ({
    ...original.detailRows[0], deviceId: 'pdf-' + index, nombreDispositivo: 'Equipo ' + index,
  }));
  const data = { ...original, detailRows: rows, reportDetailCount: rows.length,
    totals: { ...original.totals, dispositivosFiltrados: rows.length } };
  const report = sharedModel(data, 'danados');
  assert.equal(report.rows.length, 250);
  assert.equal(report.total, 250);
  assert.equal(report.health, 0);
  assert.throws(() => sharedModel({ ...data, reportDetailCount: 249 }, 'todos'), /incompletos/);
});
