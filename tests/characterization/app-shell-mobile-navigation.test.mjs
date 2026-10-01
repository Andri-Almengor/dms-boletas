import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('AppShell conserva la ruta completa al entrar y salir del Asistente', () => {
  const shell = source('src/components/layout/AppShell.jsx');

  assert.match(shell, /const currentRoute = `\$\{location\.pathname\}\$\{location\.search \|\| ''\}\$\{location\.hash \|\| ''\}`/);
  assert.match(shell, /encodeURIComponent\(currentRoute\)/);
  assert.match(shell, /assistantFrom\.startsWith\('\/'\) && !assistantFrom\.startsWith\('\/\/'\)/);
});

test('drawer principal reutiliza overlay y tiene semántica de control móvil', () => {
  const shell = source('src/components/layout/AppShell.jsx');
  const pages = source('src/styles/pages.css');

  assert.match(shell, /aria-controls="dms-main-drawer"/);
  assert.match(shell, /<button type="button" className=\{\`drawer-backdrop/);
  assert.match(shell, /aria-label="Cerrar menú"/);
  assert.match(shell, /id="dms-main-drawer"/);
  assert.match(shell, /role="dialog"/);
  assert.match(shell, /aria-modal=\{drawerOpen \? 'true' : undefined\}/);
  assert.match(shell, /onClick=\{\(\) => setDrawerOpen\(false\)\}/);
  assert.match(shell, /useOverlaySurface\(\{ open: drawerOpen/);
  assert.match(pages, /\.drawer-backdrop\s*\{[^}]*border:\s*0[^}]*visibility:\s*hidden/s);
});

test('bottom navigation usa estado visual nativo sin duplicar rutas', () => {
  const shell = source('src/components/layout/AppShell.jsx');
  const pages = source('src/styles/pages.css');
  const navigation = source('src/styles/navigation-responsive-fix.css');

  assert.match(shell, /bottom-nav__icon/);
  assert.match(shell, /filled=\{isActive && !prominent\}/);
  assert.match(pages, /\.bottom-nav__icon\s*\{[^}]*min-width:\s*40px[^}]*height:\s*32px/s);
  assert.match(navigation, /\.bottom-nav__item:not\(\.bottom-nav__item--prominent\)\.is-active \.bottom-nav__icon\s*\{[^}]*background:\s*var\(--primary-soft\)/s);
  assert.match(navigation, /\.bottom-nav__item:active \.bottom-nav__icon\s*\{[^}]*scale\(\.94\)/s);
  assert.doesNotMatch(shell, /MobileNavigation|DesktopNavigation|NativeNavigation/);
});

test('navegación táctil adapta landscape y el FAB respeta la altura real de la barra', () => {
  const navigation = source('src/styles/navigation-responsive-fix.css');
  const fab = source('src/styles/assistant-fab.css');

  assert.match(navigation, /@media \(max-height: 520px\) and \(orientation: landscape\) and \(hover: none\) and \(pointer: coarse\)/);
  assert.match(navigation, /--bottom-nav-height:\s*60px/);
  assert.match(navigation, /--top-bar-content-height:\s*52px/);
  assert.match(navigation, /\.bottom-nav__item > span:last-child\s*\{[^}]*display:\s*none/s);
  assert.match(fab, /bottom:\s*calc\(var\(--bottom-nav-height\) \+ var\(--space-sm\) \+ var\(--safe-area-bottom\)\)/);
  assert.doesNotMatch(fab, /bottom:\s*calc\(84px \+ env\(safe-area-inset-bottom\)\)/);
});

test('hover del FAB se limita a puntero fino y navegación respeta reduced motion', () => {
  const navigation = source('src/styles/navigation-responsive-fix.css');
  const fab = source('src/styles/assistant-fab.css');

  assert.match(fab, /@media \(hover: hover\) and \(pointer: fine\)[\s\S]*\.assistant-fab:hover/s);
  assert.match(navigation, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.bottom-nav__icon/s);
});
