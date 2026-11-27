import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');

test('bootstrap is visible without external fonts and keeps the retry link', () => {
  const html = source('index.html');
  assert.match(html, /class="dms-bootstrap"/);
  assert.match(html, /class="dms-bootstrap-card"/);
  assert.match(html, /<a href="">Reintentar/);
  assert.match(html, /id="dms-text-font"[^>]*rel="preload" as="style"/);
  assert.match(html, /id="dms-icon-font"[^>]*rel="preload" as="style"/);
  const main = source('src/main.jsx');
  assert.match(main, /initializeLoadingFonts\(\);/);
  assert.match(main, /document\.fonts\.load/);
  assert.match(main, /setTimeout\(finish, 4000\)/);
  assert.doesNotMatch(main, /await initializeLoadingFonts/);
});

test('shared accessible skeleton is used for routes and primary data-loading branches', () => {
  const loading = source('src/components/common/Loading.jsx');
  assert.match(loading, /role="status" aria-live="polite"/);
  assert.match(loading, /aria-hidden="true"/);
  assert.doesNotMatch(loading, /<Icon|setTimeout/);
  assert.match(source('src/components/layout/AppShell.jsx'), /<Suspense fallback=\{<Loading[^>]*>\}><Outlet \/><\/Suspense>/);
  for (const page of ['HomePage', 'tickets/TicketListPage', 'tickets/TicketDetailPage', 'tickets/TicketFormPage', 'maintenance/MaintenanceListPage', 'maintenance/MaintenanceDetailPage', 'maintenance/MaintenanceFormPage', 'agenda/AgendaPage']) {
    assert.match(source('src/pages/' + page + '.jsx'), /<Loading label=/, page);
  }
});

test('motion is staggered, limited, theme-aware and respects reduced motion', () => {
  const css = source('src/styles/loading-experience.css');
  assert.match(source('src/styles/index.css'), /loading-experience\.css/);
  assert.match(css, /var\(--surface-high\)/);
  assert.match(css, /animation-delay: 210ms/);
  assert.match(css, /dms-card-enter/);
  assert.match(css, /agenda-calendar/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /dms-low-resource-device/);
  assert.match(css, /dms-icon-font-pending/);
  assert.doesNotMatch(css, /animation-fill-mode:\s*forwards|position:\s*fixed/);
});
