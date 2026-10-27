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
