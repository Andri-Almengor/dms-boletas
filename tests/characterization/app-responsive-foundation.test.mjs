import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('la app conserva viewport-fit y centraliza safe areas en los tokens compartidos', () => {
  const html = source('index.html');
  const tokens = source('src/styles/tokens.css');

  assert.match(html, /viewport-fit=cover/);
  for (const token of ['--safe-area-top', '--safe-area-right', '--safe-area-bottom', '--safe-area-left']) {
    assert.ok(tokens.includes(token), `Falta ${token}`);
  }
  assert.match(tokens, /--top-bar-height:\s*calc\(var\(--top-bar-content-height\) \+ var\(--safe-area-top\)\)/);
});

test('shell, navegación y formularios respetan viewport móvil sin crear ancho lateral artificial', () => {
  const pages = source('src/styles/pages.css');
  const navigation = source('src/styles/navigation-responsive-fix.css');
  const workflow = source('src/styles/workflow.css');
  const compact = source('src/styles/mobile-compact.css');

  assert.match(pages, /padding:\s*var\(--safe-area-top\).*var\(--safe-area-right\).*var\(--safe-area-left\)/);
  assert.match(pages, /side-drawer[^}]*var\(--safe-area-top\)[^}]*var\(--safe-area-bottom\)/s);
  assert.doesNotMatch(navigation, /100d?vw/);
  assert.match(navigation, /\.bottom-nav\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%/s);
  assert.match(workflow, /\.app-shell--form \.app-content \{ padding-top: var\(--safe-area-top\)/);
  assert.match(compact, /\.app-shell :is\(input, select, textarea\) \{\s*font-size: 16px;/);
});

test('superficies compartidas de detalle, filtros y media quedan limitadas por 100dvh', () => {
  const admin = source('src/styles/admin-card-modals.css');
  const workflow = source('src/styles/workflow.css');

  assert.match(admin, /max-height:\s*calc\(100dvh - 32px\)/);
  assert.match(workflow, /\.inline-modal[^}]*100dvh[^}]*safe-area-top/s);
  assert.match(workflow, /\.filter-drawer[^}]*height:100dvh[^}]*minmax\(0,1fr\)/s);
  assert.match(workflow, /\.image-viewer[^}]*safe-area-top[^}]*safe-area-bottom/s);

  const deviceDetail = source('src/styles/maintenance-project.css');
  assert.match(deviceDetail, /\.maintenance-device-detail-modal \.admin-entity-modal[^}]*width:\s*min\(100%, 1180px\)/s);
  assert.match(deviceDetail, /\.maintenance-device-detail-modal \.admin-entity-modal[^}]*100dvh/s);
});

test('asistente y superficies públicas también respetan safe areas', () => {
  const assistant = source('src/styles/assistant-experience.css');
  const signature = source('src/styles/public-signature.css');
  const surveys = source('src/styles/surveys.css');
  const cases = source('src/styles/customer-cases.css');

  assert.match(assistant, /height:\s*calc\(66px \+ var\(--safe-area-top\)\)/);
  assert.match(signature, /public-signature-page[\s\S]*var\(--safe-area-top\)[\s\S]*var\(--safe-area-bottom\)/);
  assert.match(surveys, /public-survey-page[\s\S]*var\(--safe-area-top\)[\s\S]*var\(--safe-area-bottom\)/);
  assert.match(cases, /customer-case-public-brand[^}]*var\(--safe-area-top\)[^}]*var\(--safe-area-right\)/s);
});


test('overlays compartidos centralizan Escape bloqueo de scroll y devolución de foco', () => {
  const hook = source('src/hooks/useOverlaySurface.js');
  const modal = source('src/components/forms/AdminEntityModal.jsx');
  const filters = source('src/components/forms/FilterDrawer.jsx');
  const shell = source('src/components/layout/AppShell.jsx');

  assert.match(hook, /scrollLockDepth/);
  assert.match(hook, /document\.body\.style\.overflow = 'hidden'/);
  assert.match(hook, /event\.key !== 'Escape'/);
  assert.match(hook, /previous\.focus\(\{ preventScroll: true \}\)/);

  assert.match(modal, /useOverlaySurface\(\{ open, onClose, busy \}\)/);
  assert.match(filters, /useOverlaySurface\(\{ open, onClose \}\)/);
  assert.match(shell, /useOverlaySurface\(\{ open: drawerOpen/);
});

test('drawer principal y filtros siguen utilizables en pantallas bajas y teléfonos estrechos', () => {
  const pages = source('src/styles/pages.css');
  const workflow = source('src/styles/workflow.css');
  const tokens = source('src/styles/tokens.css');

  assert.match(tokens, /--page-wide-max-width:\s*1280px/);
  assert.match(tokens, /--touch-target-min:\s*44px/);
  assert.match(pages, /\.page--wide\s*\{[^}]*--page-wide-max-width/s);
  assert.match(pages, /\.side-drawer__nav\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(pages, /\.side-drawer__nav\s*\{[^}]*overscroll-behavior:\s*contain/s);

  assert.match(workflow, /@media \(max-width: 760px\)[\s\S]*\.filter-drawer\s*\{[\s\S]*inset:\s*auto 0 0/);
  assert.match(tokens, /--sheet-max-height:\s*min\(88dvh,/);
  assert.match(workflow, /height:\s*var\(--sheet-max-height\)/);
  assert.match(workflow, /border-radius:\s*var\(--overlay-radius\) var\(--overlay-radius\) 0 0/);
  assert.match(workflow, /@media \(max-width: 390px\)[\s\S]*\.filter-drawer footer[\s\S]*grid-template-columns:\s*1fr/);
});


test('design system responsive centraliza spacing controles overlays y movimiento', () => {
  const tokens = source('src/styles/tokens.css');
  const components = source('src/styles/components.css');
  const pages = source('src/styles/pages.css');
  const workflow = source('src/styles/workflow.css');
  const admin = source('src/styles/admin-card-modals.css');
  const compact = source('src/styles/mobile-compact.css');

  for (const token of [
    '--space-xs',
    '--space-sm',
    '--space-md',
    '--space-lg',
    '--space-xl',
    '--page-inline-mobile',
    '--page-inline-tablet',
    '--touch-target-min',
    '--control-height',
    '--control-height-compact',
    '--button-height',
    '--overlay-mobile-max-height',
    '--sheet-max-height',
    '--overlay-backdrop',
    '--motion-fast',
  ]) {
    assert.ok(tokens.includes(token), `Falta el token compartido ${token}`);
  }

  assert.match(components, /\.icon-button \{[^}]*var\(--touch-target-min\)/s);
  assert.match(components, /\.button \{[^}]*var\(--button-height\)/s);
  assert.match(components, /\.button--compact \{[^}]*var\(--control-height-compact\)/s);
  assert.match(components, /\.form-control \{[^}]*var\(--control-height\)/s);
  assert.match(components, /@media \(hover: hover\) and \(pointer: fine\)/);
  assert.match(components, /@media \(prefers-reduced-motion: reduce\)/);

  assert.match(pages, /max\(var\(--page-inline-mobile\), var\(--safe-area-right\)\)/);
  assert.match(pages, /max\(var\(--page-inline-tablet\), var\(--safe-area-right\)\)/);
  assert.match(workflow, /height:\s*var\(--sheet-max-height\)/);
  assert.match(workflow, /max-height:\s*var\(--overlay-mobile-max-height\)/);
  assert.match(admin, /background:\s*var\(--overlay-backdrop\)/);
  assert.match(admin, /max-height:\s*var\(--overlay-mobile-max-height\)/);
  assert.doesNotMatch(admin, /var\(--text-muted\)/);
  assert.match(compact, /min-height:\s*var\(--control-height-compact\)/);
});
