import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('Knowledge conserva paginación y rutas existentes mientras amplía su superficie responsive', () => {
  const page = source('src/pages/knowledge/KnowledgeListPage.jsx');
  const styles = source('src/styles/knowledge.css');
  const stability = source('src/styles/knowledge-mobile-stability.css');

  assert.match(page, /const PAGE_SIZE = 30/);
  assert.match(page, /usePaginatedResource/);
  assert.match(page, /MODULE_ROUTES\.knowledge\.list/);
  assert.match(page, /className="page page--wide knowledge-page"/);
  assert.match(page, /role="search"/);
  assert.match(page, /type="search"/);
  assert.match(page, /enterKeyHint="search"/);

  assert.match(styles, /\.knowledge-page\s*\{\s*width:min\(100%,var\(--page-wide-max-width\)\)/);
  assert.match(stability, /\.knowledge-page\s*\{[^}]*var\(--page-wide-max-width\)/s);
  assert.match(styles, /@media \(min-width: 1180px\)[\s\S]*\.knowledge-grid\s*\{[^}]*repeat\(3, minmax\(0, 1fr\)\)/s);
});

test('editor Knowledge mantiene Gemini y cargas existentes con acciones móviles compactas', () => {
  const page = source('src/pages/knowledge/KnowledgeEditorPage.jsx');
  const styles = source('src/styles/knowledge.css');

  assert.match(page, /KNOWLEDGE_AI_ROUTES/);
  assert.match(page, /improveWithGemini\('FULL'\)/);
  assert.match(page, /uploadLargeKnowledgeAttachment/);
  assert.match(page, /MODULE_ROUTES\.knowledge\.attachmentPrimary/);
  assert.match(page, /MODULE_ROUTES\.knowledge\.attachmentReindex/);
  assert.match(page, /MODULE_ROUTES\.knowledge\.attachmentDelete/);

  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.knowledge-editor-actions\s*\{[^}]*display:\s*flex[^}]*flex-wrap:\s*nowrap[^}]*overflow-x:\s*auto/s);
  assert.match(styles, /\.knowledge-editor-actions \.button\s*\{[^}]*min-width:\s*150px/s);
  assert.match(styles, /\.knowledge-search input\s*\{[^}]*font-size:\s*16px/s);
});

test('visor documental Knowledge usa viewport dinámico y conserva accesos privados existentes', () => {
  const component = source('src/components/knowledge/KnowledgeDocumentViewer.jsx');
  const styles = source('src/styles/knowledge-document-viewer.css');

  assert.match(component, /MODULE_ROUTES\.knowledge\.mediaGet/);
  assert.match(component, /requestAvailable/);
  assert.match(component, /access\?\.inlineUrl/);
  assert.match(component, /access\?\.downloadUrl/);

  assert.match(styles, /\.knowledge-doc-viewer:fullscreen\s*\{[^}]*height:\s*100dvh/s);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.knowledge-doc-viewer__actions\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(styles, /\.knowledge-doc-viewer__pdf\s*\{[^}]*68dvh/s);
  assert.match(styles, /\.knowledge-doc-viewer__manage\s*\{[^}]*overflow-x:\s*auto/s);
});

test('Asistente mantiene backend seguro y hace compacto el composer con muchos adjuntos', () => {
  const page = source('src/pages/assistant/AssistantPageSecure.jsx');
  const experience = source('src/styles/assistant-experience.css');
  const sensitive = source('src/styles/assistant-sensitive.css');

  assert.match(page, /apiRequest\('assistant\.chat'/);
  assert.match(page, /assistantAction:\s*'attachment\.init'/);
  assert.match(page, /assistantAction:\s*'attachment\.chunk'/);
  assert.match(page, /assistantAction:\s*'operation\.decide'/);
  assert.match(page, /messages\.filter\(\(item\) => !item\.sensitive\)/);
  assert.match(page, /data-label=\{column\.label\}/);
  assert.match(page, /assistant-attachment-card--\$\{item\.type/);

  assert.match(experience, /@media \(max-width: 760px\)[\s\S]*\.assistant-composer textarea\s*\{[^}]*font-size:\s*16px/s);
  assert.match(experience, /\.assistant-pending-files\s*\{[^}]*overflow-x:\s*auto[^}]*scroll-snap-type:\s*x proximity/s);
  assert.match(sensitive, /@media \(max-width: 720px\)[\s\S]*\.assistant-attachment-grid\s*\{[^}]*repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.match(sensitive, /\.assistant-attachment-card--pdf,[\s\S]*\.assistant-attachment-card--file,[\s\S]*\.assistant-attachment-card--video\s*\{[^}]*grid-column:\s*1 \/ -1/s);
});

test('Password Vault reutiliza overlay compartido sin cambiar protección de secretos', () => {
  const page = source('src/pages/security/PasswordVaultPage.jsx');
  const styles = source('src/styles/password-vault.css');

  assert.match(page, /useOverlaySurface\(\{ open, onClose, busy \}\)/);
  assert.doesNotMatch(page, /document\.body\.style\.overflow/);
  assert.match(page, /document\.visibilityState === 'hidden'/);
  assert.match(page, /expiresInSeconds \|\| 30/);
  assert.match(page, /revealPasswordVaultCredential/);
  assert.match(page, /className="page page--wide password-vault-page"/);
  assert.match(page, /aria-label="Buscar credenciales"/);
  assert.match(page, /enterKeyHint="search"/);

  assert.match(styles, /@media \(min-width: 1180px\)[\s\S]*\.password-vault-credential-grid\s*\{[^}]*repeat\(3, minmax\(0, 1fr\)\)/s);
  assert.match(styles, /\.password-vault-modal\s*\{[^}]*100dvh[^}]*safe-area-top/s);
});

test('Casos reutiliza overlay compartido y mantiene correo y procesamiento existentes', () => {
  const dashboard = source('src/pages/cases/CustomerCasesPage.jsx');
  const emailPanel = source('src/components/cases/NotificationEmailSettingsPanel.jsx');
  const processing = source('src/components/cases/CustomerCaseProcessingOverlay.jsx');
  const styles = source('src/styles/customer-cases-dashboard-responsive.css');

  assert.match(dashboard, /className="page page--wide customer-cases-page"/);
  assert.match(dashboard, /requestCustomerCase\(CUSTOMER_CASE_ROUTES\.list/);
  assert.match(dashboard, /subscribeCustomerCaseList/);
  assert.match(dashboard, /role="search"/);
  assert.match(dashboard, /enterKeyHint="search"/);

  assert.match(emailPanel, /useOverlaySurface\(\{ open, onClose, busy: saving \}\)/);
  assert.doesNotMatch(emailPanel, /document\.body\.style\.overflow/);
  assert.match(emailPanel, /saveNotificationEmailSettings/);

  assert.match(processing, /useOverlaySurface\(\{ open, closeOnEscape: false, restoreFocus: false \}\)/);
  assert.match(styles, /@media \(min-width: 1180px\)[\s\S]*\.customer-case-card-grid\s*\{[^}]*repeat\(3, minmax\(0, 1fr\)\)/s);
});

test('Encuestas reutiliza AdminEntityModal y search-bar compartido sin cambiar sus rutas', () => {
  const page = source('src/pages/surveys/SurveysAdminPage.jsx');
  const styles = source('src/styles/surveys.css');

  assert.match(page, /className="page page--wide survey-admin-page"/);
  assert.match(page, /MODULE_ROUTES\.surveys\.responsesList/);
  assert.match(page, /MODULE_ROUTES\.surveys\.questionsList/);
  assert.match(page, /<AdminEntityModal/);
  assert.match(page, /className="search-bar survey-response-search"/);
  assert.doesNotMatch(page, /className="knowledge-search"/);
  assert.match(page, /aria-label="Buscar encuestas"/);

  assert.match(styles, /\.survey-admin-page\s*\{[^}]*var\(--page-wide-max-width\)/s);
  assert.match(styles, /@media \(min-width: 1180px\)[\s\S]*\.survey-response-grid\s*\{[^}]*repeat\(3, minmax\(0, 1fr\)\)/s);
  assert.match(styles, /\.survey-response-search input\s*\{[^}]*font-size:\s*16px/s);
});

test('Más y Offline mantienen eventos y almacenamiento existentes con superficie wide', () => {
  const more = source('src/pages/MorePage.jsx');
  const offline = source('src/pages/offline/OfflineContentPage.jsx');
  const moreStyles = source('src/styles/more-page-layout.css');
  const offlineStyles = source('src/styles/offline-content.css');

  assert.match(more, /className="page page--wide more-page"/);
  assert.match(more, /getOfflineStorageStats/);
  assert.match(more, /dms-offline-sync-request/);
  assert.match(more, /dms-offline-sync-complete/);
  assert.match(more, /setOfflineEnabled/);

  assert.match(offline, /className="page page--wide offline-content-page"/);
  assert.match(offline, /role="status"/);
  assert.match(offline, /role="alert"/);
  assert.match(moreStyles, /\.more-page\.page\s*\{[^}]*var\(--page-wide-max-width\)/s);
  assert.match(offlineStyles, /\.offline-content-page\s*\{[^}]*var\(--page-wide-max-width\)/s);
});

test('Etapa 8 no crea servicios ni rutas Gemini paralelas en frontend', () => {
  const assistant = source('src/pages/assistant/AssistantPageSecure.jsx');
  const editor = source('src/pages/knowledge/KnowledgeEditorPage.jsx');

  assert.doesNotMatch(assistant, /assistant\.chat\.v2|assistantV2|geminiV2/i);
  assert.doesNotMatch(editor, /knowledge\.ai\.v2|geminiV2/i);
  assert.match(assistant, /apiRequest\('assistant\.chat'/);
  assert.match(editor, /requestAvailable\(KNOWLEDGE_AI_ROUTES/);
});
