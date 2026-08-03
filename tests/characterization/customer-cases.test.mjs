import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { actionRateLimitPolicy } from '../../backend/src/core/request-security.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

const SECURITY_CONFIG = {
  securityLoginRateLimitMax: 30,
  securityLoginRateLimitWindowMs: 900000,
  securityPublicWriteRateLimitMax: 60,
  securityPublicWriteRateLimitWindowMs: 900000,
  securityPublicReadRateLimitMax: 300,
  securityPublicReadRateLimitWindowMs: 300000,
  securityActionRateLimitMax: 900,
  securityActionRateLimitWindowMs: 60000,
};

test('las rutas públicas del formulario usan políticas públicas limitadas', () => {
  assert.equal(actionRateLimitPolicy('customerCases.public.get', SECURITY_CONFIG).name, 'public-read');
  assert.equal(actionRateLimitPolicy('customerCases.public.submit', SECURITY_CONFIG).name, 'public-write');
  assert.equal(actionRateLimitPolicy('casos.cliente.public.get', SECURITY_CONFIG).name, 'public-read');
  assert.equal(actionRateLimitPolicy('casos.cliente.public.submit', SECURITY_CONFIG).name, 'public-write');
});

test('el esquema crea hojas dedicadas y un token reutilizable por cliente', () => {
  const schema = source('backend/src/services/customer-case-schema.service.js');
  const tables = source('backend/src/config/tables.js');
  assert.match(schema, /CasosClientes/);
  assert.match(schema, /CasoEvidencias/);
  assert.match(schema, /PortalCasosToken/);
  assert.match(schema, /PortalCasosActivo/);
  assert.match(schema, /OrigenCasoID/);
  assert.match(schema, /GeminiModeloInicial/);
  assert.match(schema, /CarpetaDriveURL/);
  assert.match(tables, /CasosClientes:\s*\{ id: 'CasoID' \}/);
  assert.match(tables, /CasoEvidencias:\s*\{ id: 'CasoEvidenciaID' \}/);
});

test('el formulario público es reutilizable, idempotente y limita imágenes', () => {
  const module = source('backend/src/modules/customer-cases.module.js');
  const payloadLimit = source('backend/src/services/customer-case-payload-limit.patch.js');
  assert.match(module, /crypto\.randomBytes\(32\)\.toString\('base64url'\)/);
  assert.match(module, /reusable:\s*true/);
  assert.match(module, /SolicitudClienteID/);
  assert.match(module, /alreadyCreated:\s*true/);
  assert.match(module, /MAX_EVIDENCES = 8/);
  assert.match(module, /MAX_FILE_BYTES = 6 \* 1024 \* 1024/);
  assert.match(payloadLimit, /MAX_TOTAL_BYTES = 16 \* 1024 \* 1024/);
  assert.match(payloadLimit, /customerCaseHandlers\.publicGet/);
  assert.match(payloadLimit, /customerCaseHandlers\.publicSubmit/);
  assert.match(payloadLimit, /maxTotalMb/);
  assert.match(module, /website/);
  assert.match(module, /Estado:\s*'EN_ESPERA'/);
});

test('los correos usan Gemini y Apps Script con idempotencia', () => {
  const gemini = source('backend/src/services/customer-case-gemini.service.js');
  const email = source('backend/src/services/customer-case-email.service.js');
  assert.match(gemini, /El caso ya fue creado en el APP de boletas/);
  assert.match(gemini, /generateInitialCaseEmail/);
  assert.match(gemini, /generateAssignedCaseEmail/);
  assert.match(gemini, /generatedByGemini:\s*false/);
  assert.match(email, /yehuda\.karmona@solutionsdms\.com/);
  assert.match(email, /raul\.mayorga@solutionsdms\.com/);
  assert.match(email, /alejandra\.umana@solutionsdms\.com/);
  assert.match(email, /APPS_SCRIPT_REPORT_URL/);
  assert.match(email, /APPS_SCRIPT_REPORT_SECRET/);
  assert.match(email, /customer\.case\.created\.send/);
  assert.match(email, /customer\.case\.assigned\.send/);
  assert.match(email, /customer-case-created:/);
  assert.match(email, /assignmentIdempotencyKey/);
  assert.match(email, /EstadoNotificacionTecnicos/);
  assert.match(email, /sendNewCustomerCaseEmail/);
  assert.match(email, /sendAssignedCustomerCaseEmail/);
  assert.doesNotMatch(email, /nodemailer/);
});

test('pasar a proceso crea una sola boleta determinista y notifica técnicos', () => {
  const module = source('backend/src/modules/customer-cases.module.js');
  const ticketLink = source('backend/src/services/customer-case-ticket-link.patch.js');
  assert.match(module, /`caso-\$\{before\.CasoID\}`/);
  assert.match(module, /ticketMultiHandlers\.create/);
  assert.match(module, /TecnicoIDsJSON/);
  assert.match(module, /FechaVisita/);
  assert.match(module, /MensajeAdministrador/);
  assert.match(module, /Estado:\s*'EN_PROCESO'/);
  assert.match(module, /sendAssignedCustomerCaseEmail/);
  assert.match(ticketLink, /OrigenCasoID/);
  assert.match(ticketLink, /updateRow\('Boletas'/);
});

test('finalizar la boleta finaliza el caso y conserva reconciliación posterior', () => {
  const sync = source('backend/src/services/customer-case-sync.service.js');
  const patch = source('backend/src/services/customer-case-ticket-finalization.patch.js');
  const app = source('backend/src/app.js');
  assert.match(sync, /finalizeCustomerCaseForTicket/);
  assert.match(sync, /reconcileCustomerCases/);
  assert.match(sync, /Estado:\s*'FINALIZADO'/);
  assert.match(sync, /OrigenCasoID/);
  assert.match(patch, /ticketDeliveryHandlers\.finalize/);
  assert.match(patch, /customerCaseSyncError/);
  assert.match(patch, /customer-case-payload-limit\.patch/);
  assert.match(app, /customer-case-ticket-finalization\.patch/);
});

test('el enrutador separa correctamente rutas públicas y administrativas', () => {
  const router = source('backend/src/core/action-router.js');
  assert.match(router, /customerCases\.public\.get[\s\S]*customerCaseHandlers\.publicGet, null, true/);
  assert.match(router, /customerCases\.public\.submit[\s\S]*customerCaseHandlers\.publicSubmit, null, true/);
  assert.match(router, /customerCases\.list[\s\S]*USUARIOS_GESTIONAR/);
  assert.match(router, /customerCases\.process[\s\S]*USUARIOS_GESTIONAR/);
  assert.match(router, /customerCases\.clientLink\.create/);
  assert.match(router, /customerCases\.media\.get/);
});

test('la interfaz incluye formulario, dashboard, detalle y enlace en clientes', () => {
  const app = source('src/app/App.jsx');
  const publicPage = source('src/pages/cases/PublicCustomerCasePage.jsx');
  const dashboard = source('src/pages/cases/CustomerCasesPage.jsx');
  const detail = source('src/pages/cases/CustomerCaseDetailPage.jsx');
  const clients = source('src/pages/admin/ClientsPage.jsx');
  const more = source('src/pages/MorePage.jsx');
  assert.match(app, /path="\/caso\/:token"/);
  assert.match(app, /path="casos"/);
  assert.match(app, /path="casos\/:caseId"/);
  assert.match(publicPage, /Enviar otro caso/);
  assert.match(publicPage, /requestId/);
  assert.match(publicPage, /prepareCustomerCaseEvidence/);
  assert.match(dashboard, /En espera/);
  assert.match(dashboard, /En proceso/);
  assert.match(dashboard, /Finalizados/);
  assert.match(detail, /Pasar a en proceso/);
  assert.match(detail, /Reenviar correo a técnicos/);
  assert.match(clients, /ClientCasePortalCard/);
  assert.match(more, /Casos de clientes/);
});
