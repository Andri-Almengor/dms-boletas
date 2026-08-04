import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('destinatarios y enlaces de cliente son acordeones accesibles', () => {
  const settings = source('src/components/cases/NotificationEmailSettingsPanel.jsx');
  const portal = source('src/components/clients/ClientCasePortalCard.jsx');
  const settingsCss = source('src/styles/notification-email-settings-accordion.css');
  const portalCss = source('src/styles/customer-case-portal-accordion.css');

  assert.match(settings, /openGroup/);
  assert.match(settings, /aria-expanded=\{expanded\}/);
  assert.match(settings, /notification-email-settings-group__toggle/);
  assert.match(settings, /notification-email-settings-accordion\.css/);
  assert.match(portal, /openLink/);
  assert.match(portal, /aria-expanded=\{open\}/);
  assert.match(portal, /client-case-portal-card__link-toggle/);
  assert.match(portal, /customer-case-portal-accordion\.css/);
  assert.match(settingsCss, /flex-direction:\s*column/);
  assert.match(settingsCss, /overflow:\s*visible/);
  assert.match(portalCss, /client-case-portal-card__link-body/);
});

test('el formulario público usa fondo uniforme y secciones legibles', () => {
  const page = source('src/pages/cases/PublicCustomerCasePage.jsx');
  const css = source('src/styles/customer-case-public-redesign.css');

  assert.match(page, /FormSection/);
  assert.match(page, /Detalle del problema/);
  assert.match(page, /Datos de contacto/);
  assert.match(page, /destinatarios configurados para pruebas/);
  assert.doesNotMatch(page, /únicamente a Andrick/i);
  assert.match(page, /customer-case-public-redesign\.css/);
  assert.match(css, /\.customer-case-public-page\s*\{[\s\S]*background:\s*#fff/);
  assert.match(css, /\[data-theme='dark'\] \.customer-case-public-page\s*\{[\s\S]*background:\s*#0f0f10/);
  assert.doesNotMatch(css, /linear-gradient|radial-gradient/);
  assert.match(css, /grid-template-columns:\s*repeat\(2/);
  assert.match(css, /@media \(max-width:\s*720px\)/);
});

test('los enlaces de prueba no muestran un destinatario fijo', () => {
  const portal = source('src/components/clients/ClientCasePortalCard.jsx');

  assert.match(portal, /destinatarios configurados para pruebas/);
  assert.doesNotMatch(portal, /solo a Andrick/i);
  assert.doesNotMatch(portal, /andrick\.almengor@solutionsdms\.com/);
});

test('las boletas de casos reales conservan el consecutivo numérico global', () => {
  const patch = source('backend/src/services/customer-case-real-ticket-sequence.patch.js');
  const tickets = source('backend/src/modules/tickets.module.js');
  const testMode = source('backend/src/services/customer-case-test-mode.patch.js');
  const app = source('backend/src/app.js');

  assert.match(tickets, /BoletaID:\s*nextTicketNumber\(rows\)/);
  assert.match(patch, /validRealTicketNumber/);
  assert.match(patch, /nextRealTicketNumber/);
  assert.match(patch, /NORMALIZAR_CONSECUTIVO_BOLETA_CASO/);
  assert.match(patch, /ModoPrueba/);
  assert.match(patch, /return originalCreate\(ctx\)/);
  assert.match(testMode, /return `PRUEBA-/);
  assert.match(app, /customer-case-test-mode\.patch\.js[\s\S]*customer-case-real-ticket-sequence\.patch\.js/);
});
