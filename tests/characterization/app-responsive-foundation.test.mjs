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
