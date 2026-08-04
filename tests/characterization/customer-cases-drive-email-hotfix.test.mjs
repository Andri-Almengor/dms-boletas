import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('la carga de evidencias no comparte archivos ni carpetas desde el backend', () => {
  const drive = source('backend/src/services/customer-case-apps-script-drive.service.js');

  assert.match(drive, /customer\.case\.evidence\.upload/);
  assert.match(drive, /customer\.case\.evidence\.get/);
  assert.doesNotMatch(drive, /viewerEmails/);
  assert.doesNotMatch(drive, /serviceAccountEmail/);
  assert.doesNotMatch(drive, /getNotificationEmailSettings/);
  assert.doesNotMatch(drive, /googleClientEmail/);
});

test('el correo inicial puede reenviarse sin reutilizar una respuesta idempotente anterior', () => {
  const email = source('backend/src/services/customer-case-email.service.js');
  const retry = source('backend/src/services/customer-case-initial-email-retry.patch.js');
  const app = source('backend/src/app.js');

  assert.match(email, /forceResend = false/);
  assert.match(email, /customer-case-created-resend/);
  assert.match(email, /forceResend,/);
  assert.match(retry, /notificationType/);
  assert.match(retry, /sendNewCustomerCaseEmail/);
  assert.match(retry, /forceResend:\s*true/);
  assert.match(retry, /REENVIAR_CORREO_INICIAL_CASO/);
  assert.match(retry, /EstadoNotificacionInicial:\s*'ENVIADO'/);
  assert.match(app, /customer-case-test-mode\.patch\.js[\s\S]*customer-case-initial-email-retry\.patch\.js/);
});

test('el resultado parcial usa gramática correcta y texto de prueba configurable', () => {
  const retry = source('backend/src/services/customer-case-initial-email-retry.patch.js');
  const detail = source('src/pages/cases/CustomerCaseDetailPage.jsx');

  assert.match(retry, /evidencias no se pudieron cargar/);
  assert.doesNotMatch(retry, /pudoieron/);
  assert.match(detail, /No se pudieron almacenar/);
  assert.doesNotMatch(detail, /pudoieron/);
  assert.doesNotMatch(detail, /solo Andrick/i);
  assert.doesNotMatch(detail, /andrick\.almengor@solutionsdms\.com/);
  assert.match(detail, /Reenviar correo inicial/);
  assert.match(detail, /CUSTOMER_CASE_ROUTES\.resendInitial/);
});

test('dashboard y panel de correos tienen distribución responsiva compacta', () => {
  const dashboard = source('src/styles/customer-cases-dashboard-responsive.css');
  const settings = source('src/styles/notification-email-settings.css');
  const detailActions = source('src/styles/customer-case-detail-actions.css');
  const page = source('src/pages/cases/CustomerCasesPage.jsx');

  assert.match(page, /customer-cases-dashboard-responsive\.css/);
  assert.match(dashboard, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/);
  assert.match(dashboard, /\.case-status-tabs[\s\S]*grid-template-columns:\s*repeat\(2/);
  assert.match(dashboard, /\.case-search[\s\S]*width:\s*100%/);
  assert.match(settings, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(settings, /\.notification-email-settings-group\.is-cases[\s\S]*grid-column:\s*1 \/ -1/);
  assert.match(settings, /height:\s*100dvh/);
  assert.match(settings, /padding:\s*max\(14px,\s*env\(safe-area-inset-top\)\)/);
  assert.match(detailActions, /case-notification-resend/);
});
