import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('la carga de evidencias usa Apps Script sin compartir archivos automáticamente', () => {
  const service = source('backend/src/services/customer-case-apps-script-drive.service.js');
  const patch = source('backend/src/services/customer-case-test-mode.patch.js');

  assert.match(service, /customer\.case\.evidence\.upload/);
  assert.match(service, /customer\.case\.evidence\.get/);
  assert.doesNotMatch(service, /env\.googleClientEmail/);
  assert.doesNotMatch(service, /viewerEmails/);
  assert.doesNotMatch(service, /serviceAccountEmail/);
  assert.doesNotMatch(service, /getNotificationEmailSettings/);
  assert.match(patch, /uploadCustomerCaseEvidenceWithAppsScript/);
  assert.match(patch, /Almacenamiento:\s*'APPS_SCRIPT'/);
  assert.match(patch, /PropietarioDrive/);
  assert.match(patch, /getCustomerCaseEvidenceFromAppsScript/);
});

test('el modo de prueba usa un token separado y no altera las numeraciones reales', () => {
  const patch = source('backend/src/services/customer-case-test-mode.patch.js');

  assert.match(patch, /PortalCasosPruebaToken/);
  assert.match(patch, /crypto\.randomBytes\(32\)\.toString\('base64url'\)/);
  assert.match(patch, /strictNextCaseNumber/);
  assert.match(patch, /\^CAS-\(\\d\+\)\$/);
  assert.match(patch, /PRUEBA-CAS-/);
  assert.match(patch, /PRUEBA-/);
  assert.match(patch, /BoletaID:\s*existing\?\.BoletaID \|\| testTicketNumber/);
  assert.match(patch, /EsPrueba:\s*true/);
  assert.match(patch, /ModoPrueba:\s*true/);
  assert.doesNotMatch(patch, /nextTicketNumber\(/);
});

test('el correo de prueba se resuelve desde Configuracion y los técnicos siguen como destinatarios', () => {
  const email = source('backend/src/services/customer-case-email.service.js');
  const settings = source('backend/src/services/notification-email-settings.service.js');
  const ticketDelivery = source('backend/src/services/apps-script-ticket-group.service.js');

  assert.match(email, /getNotificationEmailSettings/);
  assert.match(email, /settings\.testRecipients/);
  assert.match(email, /settings\.testCc/);
  assert.match(email, /technicianPayload\(technicians\)/);
  assert.match(email, /technicianRecipients/);
  assert.match(email, /recipientPlan\(technicianRecipients, copies\)/);
  assert.match(email, /testMode:\s*item\.ModoPrueba/);
  assert.match(settings, /CORREOS_PRUEBAS/);
  assert.match(settings, /CORREOS_PRUEBAS_CC/);
  assert.match(ticketDelivery, /settings\.testRecipients/);
  assert.match(ticketDelivery, /settings\.ticketDefaultCc/);
  assert.doesNotMatch(email, /andrick\.almengor@solutionsdms\.com/);
});

test('las boletas de prueba finalizan sin correo al cliente ni Google Chat', () => {
  const patch = source('backend/src/services/customer-case-test-mode.patch.js');

  assert.match(patch, /ticketDeliveryHandlers\.finalize/);
  assert.match(patch, /FINALIZAR_BOLETA_PRUEBA_SIN_NOTIFICAR/);
  assert.match(patch, /EstadoNotificacion:\s*'PRUEBA'/);
  assert.match(patch, /Boleta de prueba finalizada sin correo al cliente ni Google Chat/);
  assert.match(patch, /Las boletas de prueba no se envían a Google Chat/);
});

test('el orden de parches reemplaza el flujo antiguo antes de enlazar y finalizar boletas', () => {
  const app = source('backend/src/app.js');
  const recovery = app.indexOf("customer-case-evidence-recovery.patch.js");
  const testMode = app.indexOf("customer-case-test-mode.patch.js");
  const initialRetry = app.indexOf("customer-case-initial-email-retry.patch.js");
  const finalization = app.indexOf("customer-case-ticket-finalization.patch.js");

  assert.ok(recovery >= 0);
  assert.ok(testMode > recovery);
  assert.ok(initialRetry > testMode);
  assert.ok(finalization > initialRetry);
});

test('la interfaz muestra pantallas de carga, enlace de prueba y dashboard separado', () => {
  const publicPage = source('src/pages/cases/PublicCustomerCasePage.jsx');
  const detail = source('src/pages/cases/CustomerCaseDetailPage.jsx');
  const dashboard = source('src/pages/cases/CustomerCasesPage.jsx');
  const portal = source('src/components/clients/ClientCasePortalCard.jsx');
  const overlay = source('src/components/cases/CustomerCaseProcessingOverlay.jsx');
  const settingsPanel = source('src/components/cases/NotificationEmailSettingsPanel.jsx');
  const settingsService = source('src/services/notificationEmailSettings.js');
  const styles = source('src/styles/customer-cases-workflow.css');

  assert.match(publicPage, /CustomerCaseProcessingOverlay/);
  assert.match(publicPage, /Abriendo formulario de soporte/);
  assert.match(publicPage, /Guardando evidencias en Drive/);
  assert.match(detail, /Pasando el caso a proceso/);
  assert.match(detail, /Creando boleta de prueba/);
  assert.match(detail, /no consumirá el consecutivo real/i);
  assert.match(detail, /Reenviar correo inicial/);
  assert.match(dashboard, /Casos reales/);
  assert.match(dashboard, /Mostrando casos de prueba/);
  assert.match(dashboard, /Correos y copias/);
  assert.match(dashboard, /NotificationEmailSettingsPanel/);
  assert.match(settingsPanel, /Destinatarios principales del caso nuevo/);
  assert.match(settingsPanel, /Copias predeterminadas de boletas/);
  assert.match(settingsPanel, /Destinatarios principales de prueba/);
  assert.match(settingsService, /section:\s*SECTION/);
  assert.match(settingsService, /operation:\s*'UPDATE'/);
  assert.match(portal, /Enlace exclusivo de prueba/);
  assert.match(portal, /no consume el consecutivo real/);
  assert.match(overlay, /aria-busy="true"/);
  assert.match(styles, /customer-case-processing/);
  assert.match(styles, /case-mode-switch/);
});

test('la configuración de correos exige administrador y se audita', () => {
  const configModule = source('backend/src/modules/config.module.js');
  const settings = source('backend/src/services/notification-email-settings.service.js');

  assert.match(configModule, /NOTIFICATION_EMAILS/);
  assert.match(configModule, /USUARIOS_GESTIONAR/);
  assert.match(configModule, /updateNotificationEmailSettings/);
  assert.match(configModule, /ACTUALIZAR_DESTINATARIOS_CORREO/);
  assert.match(settings, /appendRows\('Configuracion'/);
  assert.match(settings, /updateRows\('Configuracion'/);
  assert.match(settings, /Debe configurar al menos un destinatario principal/);
  assert.match(settings, /Debe configurar al menos un correo para las pruebas/);
});
