import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('QA final: el Asistente permanece debajo de drawers, visores y modales', () => {
  const tokens = source('src/styles/tokens.css');
  const fab = source('src/styles/assistant-fab.css');
  const assistant = source('src/styles/assistant.css');
  const workflow = source('src/styles/workflow.css');
  const tickets = source('src/styles/ticket-evidence-viewer.css');
  const maintenance = source('src/styles/maintenance-evidence-gallery.css');
  const admin = source('src/styles/admin-card-modals.css');
  const offline = source('src/styles/offline.css');
  const recovery = source('src/styles/form-recovery-mobile-compact.css');

  assert.match(tokens, /--z-assistant-fab:\s*55/);
  assert.match(tokens, /--z-status-indicator:\s*58/);
  assert.match(fab, /z-index:\s*var\(--z-assistant-fab\)/);
  assert.match(assistant, /z-index:\s*var\(--z-assistant-fab\)/);
  assert.doesNotMatch(fab, /z-index:\s*1220/);
  assert.doesNotMatch(assistant, /z-index:\s*1220/);

  assert.match(workflow, /\.filter-drawer-layer\s*\{[^}]*z-index:100/s);
  assert.match(tickets, /\.image-viewer--gallery\s*\{[^}]*z-index:\s*1200/s);
  assert.match(maintenance, /\.maintenance-lightbox__nav\s*\{[^}]*z-index:\s*1202/s);
  assert.match(admin, /\.admin-entity-modal-layer\s*\{[^}]*z-index:\s*1500/s);
  assert.match(offline, /\.offline-status\s*\{[^}]*z-index:\s*var\(--z-status-indicator\)/s);
  assert.match(recovery, /z-index:\s*var\(--z-status-indicator\) !important/);
  assert.doesNotMatch(recovery, /z-index:\s*1240/);
});

test('QA final: overlays interactivos reutilizan el bloqueo de scroll compartido', () => {
  const files = [
    'src/components/feedback/ProcessingOverlay.jsx',
    'src/components/forms/AdminEntityModal.jsx',
    'src/components/forms/FilterDrawer.jsx',
    'src/components/forms/InlineCreateModal.jsx',
    'src/components/forms/MobileTimePickerBridge.jsx',
    'src/components/maintenance/MaintenanceLocationPickerModal.jsx',
    'src/components/tickets/ImageViewer.jsx',
    'src/components/tickets/SignaturePad.jsx',
    'src/pages/agenda/AgendaDayDialog.jsx',
    'src/pages/agenda/AgendaSplitDialog.jsx',
  ];

  for (const file of files) {
    const code = source(file);
    assert.match(code, /useOverlaySurface/, `${file} debe reutilizar useOverlaySurface`);
    assert.doesNotMatch(code, /document\.body\.style\.overflow/, `${file} no debe implementar un scroll lock paralelo`);
  }
});

test('QA final: selector de hora sigue siendo móvil en landscape y tablet táctil', () => {
  const picker = source('src/components/forms/MobileTimePickerBridge.jsx');
  const compact = source('src/styles/mobile-compact.css');

  assert.match(picker, /useOverlaySurface\(\{/);
  assert.match(picker, /\(max-width: 760px\), \(hover: none\) and \(pointer: coarse\)/);
  assert.doesNotMatch(picker, /document\.body\.style\.overflow/);

  assert.match(compact, /@media \(min-width: 761px\) and \(hover: hover\) and \(pointer: fine\)/);
  assert.match(compact, /@media \(hover: none\) and \(pointer: coarse\)[\s\S]*font-size:\s*16px/s);
  assert.match(compact, /\.mobile-time-picker\s*\{[^}]*max-height:\s*calc\(100dvh - var\(--safe-area-top\)\)[^}]*overflow-y:\s*auto[^}]*overscroll-behavior:\s*contain/s);
});

test('QA final: drawer cerrado queda fuera de interacción y conserva safe areas', () => {
  const shell = source('src/components/layout/AppShell.jsx');
  const pages = source('src/styles/pages.css');

  assert.match(shell, /aria-hidden=\{!drawerOpen\}/);
  assert.match(shell, /useOverlaySurface\(\{ open: drawerOpen/);
  assert.match(pages, /\.side-drawer\s*\{[^}]*visibility:\s*hidden[^}]*pointer-events:\s*none/s);
  assert.match(pages, /\.side-drawer\.is-open\s*\{[^}]*visibility:\s*visible[^}]*pointer-events:\s*auto/s);
  assert.match(pages, /\.side-drawer\s*\{[^}]*var\(--safe-area-top\)[^}]*var\(--safe-area-bottom\)/s);
});

test('QA final: ruta de Proyecto conserva regreso, anterior y siguiente al editar', () => {
  const page = source('src/pages/maintenance/MaintenanceProjectDeviceDetailPage.jsx');
  const form = source('src/pages/maintenance/MaintenanceFormPage.jsx');
  const hook = source('src/features/maintenance/useMaintenanceDirectDevice.js');
  const inventory = source('src/components/maintenance/MaintenanceLocationInventory.jsx');

  assert.match(inventory, /returnTo:\s*`\$\{routeLocation\.pathname\}\$\{routeLocation\.search \|\| ''\}`/);
  assert.match(inventory, /deviceIds/);

  assert.match(page, /const returnUrl =/);
  assert.match(page, /navigate\(returnUrl, \{ replace: true, state: maintenanceDetailState\(\) \}\)/);
  assert.doesNotMatch(page, /navigate\(-1\)/);
  assert.match(page, /replace:\s*true/);
  assert.match(page, /returnTo:\s*`\/mantenimientos\/\$\{encodeURIComponent\(maintenanceId\)\}\/dispositivos\/\$\{encodeURIComponent\(id\)\}`/);

  assert.match(form, /useLocation/);
  assert.match(form, /returnTo:\s*location\.state\?\.returnTo/);
  assert.match(form, /returnState:\s*location\.state/);
  assert.match(hook, /requestedReturnUrl\.startsWith\(`\$\{detailUrl\}\/`\)/);
  assert.match(hook, /navigate\(returnUrl, \{ replace: true, state: returnState \}\)/);
});

test('QA final: no se reintroducen anchos de viewport que provoquen scroll horizontal', () => {
  const files = [
    'src/styles/pages.css',
    'src/styles/workflow.css',
    'src/styles/mobile-compact.css',
    'src/styles/navigation-responsive-fix.css',
    'src/styles/maintenance-project.css',
    'src/styles/ticket-evidence-viewer.css',
    'src/styles/maintenance-evidence-gallery.css',
    'src/styles/assistant-fab.css',
    'src/styles/offline.css',
  ];

  for (const file of files) {
    assert.doesNotMatch(source(file), /width:\s*100d?vw/, `${file} no debe forzar 100vw`);
  }
});


test('QA final: Proyecto reutiliza los tokens gráficos existentes', () => {
  const styles = source('src/styles/maintenance-project.css');
  assert.doesNotMatch(styles, /var\(--text-muted\)/);
  assert.doesNotMatch(styles, /var\(--text-main\)/);
  assert.match(styles, /var\(--muted\)/);
  assert.match(styles, /var\(--text\)/);
});


test('Etapa 10: selector móvil compartido reutiliza tokens de safe area overlay y touch target', () => {
  const compact = source('src/styles/mobile-compact.css');
  const picker = source('src/components/forms/MobileTimePickerBridge.jsx');

  assert.match(picker, /useOverlaySurface\(\{/);
  assert.match(compact, /\.searchable-select__clear\s*\{[^}]*width:\s*var\(--touch-target-min\)[^}]*height:\s*var\(--touch-target-min\)/s);
  assert.match(compact, /\.mobile-time-layer\s*\{[^}]*padding-top:\s*var\(--safe-area-top\)/s);
  assert.match(compact, /\.mobile-time-backdrop\s*\{[^}]*background:\s*var\(--overlay-backdrop\)/s);
  assert.match(compact, /\.mobile-time-picker\s*\{[^}]*var\(--safe-area-bottom\)[^}]*var\(--overlay-radius\)/s);
  assert.doesNotMatch(compact, /env\(safe-area-inset-(?:top|right|bottom|left)\)/);
});

test('Etapa 10: visores de evidencia de boletas y mantenimientos comparten safe areas y targets táctiles', () => {
  const ticket = source('src/styles/ticket-evidence-viewer.css');
  const maintenance = source('src/styles/maintenance-evidence-gallery.css');

  for (const styles of [ticket, maintenance]) {
    assert.doesNotMatch(styles, /env\(safe-area-inset-(?:top|right|bottom|left)\)/);
    assert.match(styles, /var\(--safe-area-top\)/);
    assert.match(styles, /var\(--safe-area-right\)/);
    assert.match(styles, /var\(--safe-area-bottom\)/);
    assert.match(styles, /var\(--safe-area-left\)/);
    assert.match(styles, /__zoom-controls button\s*\{[^}]*width:\s*var\(--touch-target-min\)[^}]*height:\s*var\(--touch-target-min\)/s);
    assert.match(styles, /@media \(max-width: 430px\)[\s\S]*__nav\s*\{[^}]*width:\s*var\(--touch-target-min\)/s);
  }

  assert.match(ticket, /\.image-viewer__error button\s*\{[^}]*min-height:\s*var\(--touch-target-min\)/s);
  assert.match(maintenance, /\.maintenance-lightbox__error button\s*\{[^}]*min-height:\s*var\(--touch-target-min\)/s);
});

test('Etapa 10: controles heredados de mantenimiento respetan el design system compartido', () => {
  const maintenance = source('src/styles/maintenance.css');
  const enhancements = source('src/styles/maintenance-enhancements.css');
  const workflow = source('src/styles/workflow.css');
  const locations = source('src/styles/maintenance-location-workflow.css');

  assert.match(maintenance, /\.maintenance-status-tabs button\{min-height:var\(--touch-target-min\)/);
  assert.match(maintenance, /\.maintenance-image-grid select,\.maintenance-image-grid input\{min-height:var\(--touch-target-min\)/);
  assert.match(workflow, /\.evidence-edit-card__fields \.form-control \{ min-height:var\(--touch-target-min\)/);
  assert.match(enhancements, /max-height:var\(--overlay-mobile-max-height\)/);
  assert.match(enhancements, /background:var\(--overlay-backdrop\)/);
  assert.doesNotMatch(enhancements, /env\(safe-area-inset-(?:top|right|bottom|left)\)/);
  assert.doesNotMatch(locations, /var\(--text-main\)|var\(--text-muted\)/);
});
