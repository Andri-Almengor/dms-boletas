import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('detalle de boleta usa ancho responsive sin crear otra vista ni cambiar sus acciones', () => {
  const detail = source('src/pages/tickets/TicketDetailPage.jsx');

  assert.match(detail, /className=\{\`page ticket-detail-page/);
  assert.doesNotMatch(detail, /page page--narrow ticket-detail-page/);
  assert.match(detail, /finalAction\('finalize'\)/);
  assert.match(detail, /finalAction\('email'\)/);
  assert.match(detail, /finalAction\('resend'\)/);
  assert.match(detail, /finalAction\('pending'\)/);
  assert.match(detail, /RESEND_CHAT_ROUTES/);
  assert.match(detail, /MODULE_ROUTES\.tickets\.resendEmail/);
});

test('galería de evidencias limita miniaturas en escritorio y conserva dos columnas táctiles', () => {
  const styles = source('src/styles/ticket-detail-enhancements.css');

  assert.match(styles, /\.ticket-detail-page \.evidence-gallery\s*\{[^}]*repeat\(auto-fill, minmax\(170px, 220px\)\)/s);
  assert.match(styles, /\.ticket-detail-page \.evidence-detail-card\s*\{[^}]*max-width:\s*220px/s);
  assert.match(styles, /aspect-ratio:\s*4 \/ 3/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.ticket-detail-page \.evidence-gallery[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/s);
});

test('acciones del detalle forman un rail táctil y no una barra de varias filas gigantes', () => {
  const styles = source('src/styles/modules.css');
  const detail = source('src/pages/tickets/TicketDetailPage.jsx');

  assert.match(detail, /className="ticket-detail-actions" aria-label="Acciones de la boleta"/);
  assert.match(styles, /\.ticket-detail-actions\s*\{[^}]*display:\s*flex/s);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.ticket-detail-actions\s*\{[^}]*flex-wrap:\s*nowrap[^}]*overflow-x:\s*auto/s);
  assert.match(styles, /scroll-snap-type:\s*x proximity/);
  assert.match(styles, /\.ticket-detail-actions \.button\s*\{[^}]*min-width:\s*138px/s);
});

test('formulario no reserva la navegación inferior porque AppShell la oculta durante workflows', () => {
  const shell = source('src/components/layout/AppShell.jsx');
  const styles = source('src/styles/modules.css');
  const compact = source('src/styles/mobile-compact.css');

  assert.match(shell, /!isWorkflowForm && !isAssistantPage && <nav className="bottom-nav"/);
  assert.match(styles, /\.ticket-form-actions\s*\{[^}]*bottom:\s*max\(8px, var\(--safe-area-bottom\)\)/s);
  assert.match(compact, /\.ticket-form-actions\s*\{[^}]*bottom:\s*max\(5px, var\(--safe-area-bottom\)\)/s);
  assert.doesNotMatch(compact, /\.ticket-form-actions\s*\{[^}]*bottom:\s*calc\(var\(--bottom-nav-height\)/s);
});

test('firma y visor reutilizan el overlay compartido sin modificar Pointer Events de firma', () => {
  const signature = source('src/components/tickets/SignaturePad.jsx');
  const viewer = source('src/components/tickets/ImageViewer.jsx');

  assert.match(signature, /useOverlaySurface\(\{ open: expanded, onClose:/);
  assert.doesNotMatch(signature, /document\.body\.style\.overflow/);
  assert.match(signature, /onPointerDown=\{startDrawing\}/);
  assert.match(signature, /onPointerMove=\{draw\}/);
  assert.match(signature, /onPointerUp=\{stopDrawing\}/);
  assert.match(signature, /onPointerCancel=\{stopDrawing\}/);

  assert.match(viewer, /useOverlaySurface\(\{ open: Boolean\(open && items\.length\), onClose \}\)/);
  assert.doesNotMatch(viewer, /document\.body\.style\.overflow/);
  assert.match(viewer, /event\.key === 'ArrowLeft'/);
  assert.match(viewer, /event\.key === 'ArrowRight'/);
});

test('modales y processing del formulario comparten bloqueo de scroll anidable', () => {
  const inlineModal = source('src/components/forms/InlineCreateModal.jsx');
  const processing = source('src/components/feedback/ProcessingOverlay.jsx');
  const hook = source('src/hooks/useOverlaySurface.js');

  assert.match(inlineModal, /useOverlaySurface\(\{ open, onClose, busy: saving \}\)/);
  assert.match(processing, /useOverlaySurface\(\{ open, closeOnEscape: false, restoreFocus: false \}\)/);
  assert.match(hook, /scrollLockDepth/);
  assert.match(hook, /const noOverlaysRemain = unlockBodyScroll\(\)/);
});

test('visor móvil aprovecha el ancho disponible y conserva safe areas', () => {
  const styles = source('src/styles/ticket-evidence-viewer.css');

  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.image-viewer--gallery[\s\S]*env\(safe-area-inset-left\)/s);
  assert.match(styles, /\.image-viewer__canvas img\s*\{[^}]*max-width:\s*100%[^}]*100dvh/s);
  assert.match(styles, /@media \(max-width: 430px\)[\s\S]*padding-left:\s*max\(6px, env\(safe-area-inset-left\)\)/s);
});

test('firma ampliada evita 100vw y conserva viewport dinámico completo', () => {
  const styles = source('src/styles/signature-pad-expanded.css');

  assert.match(styles, /\.signature-pad\.is-expanded[\s\S]*@media \(max-width: 760px\)[\s\S]*width:\s*100% !important/s);
  assert.match(styles, /height:\s*100dvh !important/);
  assert.doesNotMatch(styles, /width:\s*100vw !important/);
});


test('Etapa 5 mantiene targets táctiles compartidos en detalle y formularios', () => {
  const workflow = source('src/styles/workflow.css');
  const compact = source('src/styles/mobile-compact.css');
  const quick = source('src/styles/ticket-quick-edit.css');

  assert.match(workflow, /\.field-add-button \{[^}]*min-height:var\(--touch-target-min\)/s);
  assert.match(workflow, /\.evidence-remove \{[^}]*width:var\(--touch-target-min\)[^}]*height:var\(--touch-target-min\)/s);
  assert.match(workflow, /\.evidence-detail-card__actions button \{[^}]*width:var\(--touch-target-min\)[^}]*height:var\(--touch-target-min\)/s);
  assert.match(workflow, /\.technician-chip button \{[^}]*width:var\(--touch-target-min\)[^}]*height:var\(--touch-target-min\)/s);
  assert.match(compact, /\.ticket-form-header \.icon-button \{[^}]*width: var\(--touch-target-min\)[^}]*height: var\(--touch-target-min\)/s);
  assert.match(compact, /\.searchable-select__clear \{[^}]*width: var\(--touch-target-min\)[^}]*height: var\(--touch-target-min\)/s);
  assert.match(compact, /\.mobile-time-picker__header \.icon-button \{[^}]*width: var\(--touch-target-min\)[^}]*height: var\(--touch-target-min\)/s);
  assert.match(quick, /\.ticket-detail-section__quick-edit \{[^}]*min-height: var\(--touch-target-min\)/s);
});

test('Etapa 5 mantiene acciones rápidas utilizables con una mano y teclado', () => {
  const workflow = source('src/styles/workflow.css');
  const quick = source('src/styles/ticket-quick-edit.css');
  const modules = source('src/styles/modules.css');

  assert.match(workflow, /scroll-margin-top:\s*calc\(var\(--safe-area-top\) \+ 88px\)/);
  assert.match(workflow, /scroll-margin-bottom:\s*120px/);
  assert.match(quick, /@media \(max-width: 620px\)[\s\S]*\.ticket-quick-edit-form__actions\s*\{[^}]*position:\s*sticky[^}]*bottom:\s*max\(5px, var\(--safe-area-bottom\)\)/s);
  assert.match(quick, /@media \(hover: hover\) and \(pointer: fine\)[\s\S]*\.ticket-detail-section__quick-edit:hover/s);
  assert.match(modules, /\.ticket-detail-actions\s*\{[^}]*touch-action:\s*pan-x/s);
  assert.match(modules, /scroll-padding-inline:\s*8px/);
});

test('Etapa 5 compacta la jerarquía móvil del detalle sin ocultar secciones', () => {
  const detail = source('src/pages/tickets/TicketDetailPage.jsx');
  const styles = source('src/styles/ticket-detail-enhancements.css');

  for (const section of ['Información General', 'Cliente', 'Dispositivo / Equipo', 'Trabajo Realizado']) {
    assert.ok(detail.includes(`title="${section}"`), `Debe conservar la sección ${section}`);
  }

  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.ticket-detail-page \.ticket-detail-section summary\s*\{[^}]*min-height:\s*56px/s);
  assert.match(styles, /\.ticket-detail-page \.ticket-info-grid div\s*\{[^}]*padding:\s*10px/s);
  assert.match(styles, /\.ticket-detail-page \.document-links\s*\{[^}]*padding:\s*12px/s);
});
