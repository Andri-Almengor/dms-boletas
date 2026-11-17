import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function source(path) {
  return readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
}

test('métricas: diseño Aegis se aplica sobre la ruta y los componentes compartidos existentes', () => {
  const routeStyles = source('src/styles/routes/metrics.js');
  const page = source('src/pages/admin/MetricsPage.jsx');
  const ticket = source('src/components/metrics/TicketMetricsDashboard.jsx');
  const maintenance = source('src/components/metrics/MaintenanceMetricsDashboard.jsx');
  const primitives = source('src/components/metrics/MetricsPrimitives.jsx');

  assert.match(routeStyles, /import '\.\.\/metrics\.css'/);
  assert.match(routeStyles, /import '\.\.\/metrics-interactions\.css'/);
  assert.match(page, /<TicketMetricsDashboard \/>/);
  assert.match(page, /<MaintenanceMetricsDashboard \/>/);
  assert.match(page, /Métricas operativas/);
  assert.doesNotMatch(page, /Google Sheets/);
  assert.match(ticket, /<MetricCard /);
  assert.match(ticket, /<DateColumns /);
  assert.match(ticket, /<DonutBreakdown /);
  assert.match(ticket, /<BarDistribution /);
  assert.match(maintenance, /<MetricCard /);
  assert.match(maintenance, /<DonutBreakdown /);
  assert.match(maintenance, /<ProgressBar /);
  assert.match(primitives, /export function MetricCard/);
  assert.match(primitives, /export function MetricsPanel/);
});

test('métricas: panel es oscuro/claro, contiene contraste y no afecta tokens globales', () => {
  const css = source('src/styles/metrics.css');
  const tokens = source('src/styles/tokens.css');

  assert.match(css, /Aegis Crimson Precision/);
  assert.match(css, /\.metrics-page\s*\{[\s\S]*?--metrics-card:\s*#fff;/);
  assert.match(css, /:root\[data-theme='dark'\] \.metrics-page\s*\{[\s\S]*?--metrics-card:\s*#191616;/);
  assert.match(css, /--metrics-crimson:\s*#af101a;/);
  assert.match(css, /\.metrics-page__hero\s*\{[^}]*background:\s*transparent;/s);
  assert.match(css, /\.metrics-page \.metrics-kpi\s*\{/);
  assert.match(css, /\.metrics-page \.metrics-panel\s*\{/);
  assert.match(css, /\.metrics-page \.metrics-table\s*\{/);
  assert.match(css, /\.metrics-page :is\(button, select, input\):focus-visible/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(tokens, /--primary:\s*#af101a/);
});

test('métricas: reflujo tablet/móvil mantiene gráficos, KPIs y filtro utilizables', () => {
  const css = source('src/styles/metrics.css');
  const desktopFixes = source('src/styles/metrics-desktop-fixes.css');
  assert.match(css, /\.metrics-layout--ticket\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1\.65fr\)/);
  assert.match(css, /\.metrics-layout--ticket > \.metrics-panel:last-child\s*\{\s*grid-column:\s*1 \/ -1;/);
  assert.match(css, /@media \(max-width: 900px\)\s*\{[\s\S]*?\.metrics-layout--ticket, \.metrics-layout--maintenance\s*\{\s*grid-template-columns:\s*minmax\(0,1fr\);/);
  assert.match(css, /@media \(max-width: 680px\)\s*\{[\s\S]*?\.metrics-kpi-grid\s*\{\s*grid-template-columns:\s*repeat\(2,minmax\(0,1fr\)\);/);
  assert.match(css, /@media \(max-width: 350px\)\s*\{[\s\S]*?\.metrics-kpi-grid\s*\{\s*grid-template-columns:\s*1fr;/);
  assert.match(css, /\.metrics-table-wrap\s*\{[\s\S]*?overflow-x:\s*auto;/);
  assert.match(desktopFixes, /\.metrics-ticket-card dd\s*\{[^}]*white-space:\s*normal;/s);
});

test('métricas: filtros y actualización siguen ligados a sus rutas originales', () => {
  const ticket = source('src/components/metrics/TicketMetricsDashboard.jsx');
  const maintenance = source('src/components/metrics/MaintenanceMetricsDashboard.jsx');
  for (const page of [ticket, maintenance]) {
    assert.match(page, /useLatestResource/);
    assert.match(page, /onClick=\{load\}/);
    assert.match(page, /className="metrics-filters"/);
    assert.match(page, /<FilterChip /);
    assert.match(page, /<MetricsStatus loading=/);
  }
  assert.match(ticket, /metrics\.tickets\.get/);
  assert.match(maintenance, /metrics\.maintenance\.get/);
});

test('métricas: pantalla consulta todos los equipos y PDF ofrece filtro independiente con responsable', () => {
  const dashboard = source('src/components/metrics/MaintenanceMetricsDashboard.jsx');
  const print = source('src/components/metrics/MaintenanceMetricsPrint.jsx');
  const backend = source('backend/src/modules/metrics.module.js');
  const route = source('src/styles/routes/metrics.js');
  const css = source('src/styles/metrics.css');

  assert.match(dashboard, /<AdminEntityModal[\s\S]*?title="Configurar informe PDF"/);
  assert.match(dashboard, /onClick=\{openPdfOptions\}/);
  assert.match(dashboard, /detalleReporte: pdfDeviceFilter/);
  assert.match(dashboard, /\['fallas', 'Solo dispositivos en mal estado'/);
  assert.match(dashboard, /\['todos', 'Todos los dispositivos'/);
  assert.match(dashboard, /\['funcionales', 'Solo dispositivos funcionales'/);
  assert.match(dashboard, /<th>Responsable<\/th>/);
  assert.match(print, /<th>Responsable<\/th>/);
  assert.match(print, /row\.creador \|\| 'Sin responsable'/);
  assert.match(print, /const rows = data\?\.detailRows \|\| \[\]/);
  assert.match(backend, /detailRows: reportIncidents \? reportRows : details\.slice\(0, 500\)/);
  assert.match(backend, /reportMode === 'funcionales'/);
  assert.match(backend, /reportMode === 'todos'/);
  assert.match(backend, /!\['todos', 'fallas', 'no_operativos', 'funcionales'\]\.includes\(reportMode\)/);
  assert.match(route, /admin-card-modals\.css/);
  assert.match(css, /\.admin-entity-modal-layer--metrics-report/);
});

test('métricas: PDF A4 apaisado compacta informes cortos y utiliza el logotipo corporativo', () => {
  const print = source('src/components/metrics/MaintenanceMetricsPrint.jsx');
  assert.match(print, /import reportLogo from '\.\.\/\.\.\/assets\/dms-report-logo\.png\?inline'/);
  assert.match(print, /className="report-logo" src=\{reportLogo\}/);
  assert.match(print, /className="report-header"/);
  assert.match(print, /rows\.length <= 7 \? ' report-page--short'/);
  assert.match(print, /@page \{ size: A4 landscape; margin: 0; \}/);
  assert.match(print, /\.report-page--short \{ padding: 6mm 8mm; \}/);
  assert.match(print, /\.report-table tr \{ break-inside: avoid; page-break-inside: avoid; \}/);
  assert.match(print, /\.report-table thead \{ display: table-header-group; \}/);
  assert.match(print, /overflow-wrap: anywhere; white-space: pre-wrap;/);
  // No introduce un alto fijo ni oculta el contenido: los informes largos siguen paginando.
  assert.doesNotMatch(print, /\.report-incidents \{[^}]*overflow: hidden/);
  assert.doesNotMatch(print, /\.report-table \{[^}]*height: [0-9]+(px|mm)/);
});

test('métricas: modal PDF móvil mantiene botones compactos y sin estiramiento', () => {
  const styles = source('src/styles/metrics.css');
  assert.match(styles, /admin-entity-modal-layer--metrics-report \.admin-entity-modal__footer \{[\s\S]*?display: grid;/);
  assert.match(styles, /grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/);
  assert.match(styles, /admin-entity-modal-layer--metrics-report \.admin-entity-modal__footer > \.button \{[\s\S]*?flex: none;[\s\S]*?height: 46px;[\s\S]*?max-height: 46px;/);
  assert.doesNotMatch(styles, /admin-entity-modal-layer--metrics-report \.admin-entity-modal__footer > \.button \{\s*flex: 1 1 130px;/);
});

test('métricas: PDF no limita la tabla a cinco y conserva paginación de informes extensos', () => {
  const printer = source('src/components/metrics/MaintenanceMetricsPrint.jsx');
  const handler = source('backend/src/modules/metrics.module.js');
  assert.match(handler, /reportDetailCount: reportIncidents \? reportRows\.length : null/);
  assert.match(handler, /detailRows: reportIncidents \? reportRows : details\.slice\(0, 500\)/);
  assert.match(printer, /report-page\$\{rows\.length <= 7 \? ' report-page--short' : ''\}/);
  assert.match(printer, /assertCompleteMaintenanceReport\(data\)/);
  assert.match(printer, /data\.reportDetailCount !== data\.detailRows\.length/);
  assert.match(printer, /querySelectorAll\('\.report-table tbody tr'\)\.length/);
  assert.match(printer, /report-table tbody tr \{ break-inside: avoid; page-break-inside: avoid; \}/);
  assert.match(printer, /\.report-table \{ break-inside: auto !important; page-break-inside: auto !important; \}/);
  assert.match(printer, /overflow: visible !important;/);
  assert.match(printer, /popup\.document\.fonts\?\.ready/);
  assert.doesNotMatch(printer, /popup\.setTimeout\(\(\) => \{ if \(!popup\.closed\) popup\.print\(\); \}, 300\)/);
});

test('métricas: el PDF diferencia fallas reales y sin dato, y permite guardar todas las páginas juntas', () => {
  const dashboard = source('src/components/metrics/MaintenanceMetricsDashboard.jsx');
  const print = source('src/components/metrics/MaintenanceMetricsPrint.jsx');
  const backend = source('backend/src/modules/metrics.module.js');
  assert.match(dashboard, /\['no_operativos', 'Con falla o sin dato'/);
  assert.match(dashboard, /\['fallas', 'Solo averías confirmadas'/);
  assert.match(dashboard, /setPdfDeviceFilter\('no_operativos'\)/);
  assert.match(backend, /reportMode === 'no_operativos' \? details\.filter\(\(row\) => !row\.operativo\)/);
  assert.match(backend, /confirmedFailures: filteredDevices\.filter\(\(row\) => hasDeviceFailure\(row\.Funcionamiento\)\)\.length/);
  assert.match(print, /no_operativos: 'Detalle de dispositivos con falla \/ sin dato'/);
  assert.match(print, /Un único PDF con todas las páginas/);
  assert.match(print, /Páginas: Todas/);
  assert.match(print, /popup\.print\(\)/);
  assert.match(print, /id="print-report" type="button" disabled/);
  assert.match(print, /textContent = 'Guardar PDF completo'/);
  assert.doesNotMatch(print, /if \(!popup\.closed && autoPrintPending\) popup\.print\(\)/);
  assert.doesNotMatch(print, /new jsPDF|document\.createElement\('canvas'\)/);
});
