import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('la carga de evidencias usa Apps Script y conserva el propietario de Drive', () => {
  const service = source('backend/src/services/customer-case-apps-script-drive.service.js');
  const patch = source('backend/src/services/customer-case-test-mode.patch.js');

  assert.match(service, /customer\.case\.evidence\.upload/);
  assert.match(service, /customer\.case\.evidence\.get/);
  assert.match(service, /env\.googleClientEmail/);
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

test('el correo inicial de prueba va solo a Andrick y los técnicos siguen recibiendo la asignación', () => {
  const email = source('backend/src/services/customer-case-email.service.js');

  assert.match(email, /andrick\.almengor@solutionsdms\.com/);
  assert.match(email, /adminRecipients\(item\)/);
  assert.match(email, /technicianPayload\(technicians\)/);
  assert.match(email, /recipients = validEmails\(assigned\.map/);
  assert.match(email, /testMode:\s*item\.ModoPrueba/);
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
  const finalization = app.indexOf("customer-case-ticket-finalization.patch.js");

  assert.ok(recovery >= 0);
  assert.ok(testMode > recovery);
  assert.ok(finalization > testMode);
});

test('la interfaz muestra pantallas de carga, enlace de prueba y dashboard separado', () => {
  const publicPage = source('src/pages/cases/PublicCustomerCasePage.jsx');
  const detail = source('src/pages/cases/CustomerCaseDetailPage.jsx');
  const dashboard = source('src/pages/cases/CustomerCasesPage.jsx');
  const portal = source('src/components/clients/ClientCasePortalCard.jsx');
  const overlay = source('src/components/cases/CustomerCaseProcessingOverlay.jsx');
  const styles = source('src/styles/customer-cases-workflow.css');

  assert.match(publicPage, /CustomerCaseProcessingOverlay/);
  assert.match(publicPage, /Abriendo formulario de soporte/);
  assert.match(publicPage, /Guardando evidencias en Drive/);
  assert.match(detail, /Pasando el caso a proceso/);
  assert.match(detail, /Creando boleta de prueba/);
  assert.match(detail, /no consumirá el consecutivo real/i);
  assert.match(dashboard, /Casos reales/);
  assert.match(dashboard, /Mostrando casos de prueba/);
  assert.match(portal, /Enlace exclusivo de prueba/);
  assert.match(portal, /no consume el consecutivo real/);
  assert.match(overlay, /aria-busy="true"/);
  assert.match(styles, /customer-case-processing/);
  assert.match(styles, /case-mode-switch/);
});
