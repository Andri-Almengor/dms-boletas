import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('la firma es opcional para finalizar el mantenimiento', () => {
  const policy = source('backend/src/services/maintenance-optional-signature.patch.js');

  assert.match(policy, /signatureRequiredToFinalize:\s*false/);
  assert.match(policy, /unsignedReportsAllowed:\s*true/);
  assert.match(policy, /generateMaintenanceTickets\(ctx, id\)/);
  assert.match(policy, /maintenanceReportAccessHandlers\.finalize\(ctx\)/);
  assert.match(policy, /signatureIncluded:\s*false/);
  assert.match(policy, /signatureStatus:\s*'OMITIDA'/);
  assert.match(policy, /FirmaEstadoFinalizacion:\s*included \? 'INCLUIDA' : 'OMITIDA'/);
  assert.match(policy, /FINALIZAR_MANTENIMIENTO_SIN_FIRMA/);
  assert.doesNotMatch(policy, /ensureMaintenanceSignatureRequest/);
  assert.doesNotMatch(policy, /MAINTENANCE_SIGNATURE_REQUIRED/);
});

test('las boletas automáticas se finalizan y envían aunque el mantenimiento no tenga firma', () => {
  const delivery = source('backend/src/modules/ticket-delivery.module.js');
  const generation = source('backend/src/services/maintenance-ticket-generation.service.js');

  assert.match(delivery, /inheritMaintenanceSignatureIfAvailable/);
  assert.match(delivery, /if \(!maintenanceHasSignature\(maintenance\)\) \{[\s\S]*return ticket;/);
  assert.doesNotMatch(delivery, /mantenimiento general debe contar con la firma del cliente antes de finalizar sus boletas automáticas/i);
  assert.match(delivery, /deliverTicket\(ctx, \{ ticketId: currentGroup\.rootId, testMode: false \}\)/);
  assert.match(generation, /ticketDeliveryHandlers\.finalize\(systemContext\)/);
});

test('el flujo firmado existente se conserva cuando hay firma', () => {
  const policy = source('backend/src/services/maintenance-optional-signature.patch.js');
  const delivery = source('backend/src/modules/ticket-delivery.module.js');

  assert.match(policy, /maintenanceHasSignature\(maintenance\)/);
  assert.match(policy, /const result = await originalFinalize\(ctx\)/);
  assert.match(policy, /signatureIncluded:\s*true/);
  assert.match(policy, /signatureStatus:\s*'INCLUIDA'/);
  assert.match(policy, /FINALIZAR_MANTENIMIENTO_CON_FIRMA/);
  assert.match(policy, /signedReportsPreserved:\s*true/);
  assert.match(delivery, /synchronizeMaintenanceSignatureToTickets\(/);
});

test('la reanudación genera boletas con o sin firma y conserva los pasos idempotentes', () => {
  const resume = source('backend/src/services/maintenance-finalization-resume.patch.js');

  assert.match(resume, /^import '\.\/maintenance-optional-signature\.patch\.js';/m);
  assert.match(resume, /tracker\.mark\('VALIDANDO'\)/);
  assert.match(resume, /tracker\.mark\('GENERANDO_BOLETAS'\)/);
  assert.match(resume, /mark\('ENTREGANDO'/);
  assert.match(resume, /mark\('COMPLETANDO'/);
  assert.doesNotMatch(resume, /maintenanceHasSignature/);
});

test('la interfaz permite finalizar sin firma y usa una sola acción de cierre', () => {
  const center = source('src/components/offline/MaintenanceFinalizationCenter.jsx');
  const styles = source('src/components/offline/MaintenanceFinalizationCenter.css');
  const domain = source('src/services/maintenanceFinalizationDomain.js');

  assert.doesNotMatch(center, /signatureRegistered/);
  assert.match(center, /status === 'PENDIENTE'/);
  assert.match(center, /devices > 0/);
  assert.match(center, /Finalizar mantenimiento/);
  assert.match(center, /Finalizar al sincronizar/);
  assert.match(styles, /maintenance-detail-footer-actions > button\.button--primary:first-child/);
  assert.match(styles, /display:\s*none/);
  assert.match(domain, /label:\s*'Validando mantenimiento'/);
  assert.doesNotMatch(domain, /Validando mantenimiento y firma/);
});

test('la finalización sin firma está disponible aunque el modo offline esté desactivado', () => {
  const app = source('src/app/App.jsx');

  assert.match(app, /function MaintenanceFinalizationRuntime\(\)/);
  assert.match(app, /<MaintenanceFinalizationCenter\s*\/>/);
  assert.match(app, /<MaintenanceFinalizationRuntime\s*\/>/);
  assert.match(app, /function OptionalOfflineRuntime\(\)[\s\S]*<ClientCatalogSyncBridge\s*\/>/);

  const optionalOfflineBlock = app.match(/function OptionalOfflineRuntime\(\)[\s\S]*?\n}\n\nexport default function App/)?.[0] || '';
  assert.doesNotMatch(optionalOfflineBlock, /MaintenanceFinalizationCenter/);
});

test('un error anterior permite reintentar y muestra progreso desde el primer toque', () => {
  const center = source('src/components/offline/MaintenanceFinalizationCenter.jsx');

  assert.match(center, /\(!view\.active \|\| view\.canRetry\)/);
  assert.match(center, /onClick=\{\(\) => finalize\(\{ retry: retryFromError \}\)\}/);
  assert.match(center, /retryFromError \? 'Reintentar finalización'/);
  assert.match(center, /catch \(error\) \{[\s\S]*setMessage\([\s\S]*await refresh\(\);/);
  assert.match(center, /maintenanceId && \(working \|\| view\.active \|\| message\)/);
  assert.match(center, /working && !view\.active[\s\S]*'Iniciando finalización'/);
  assert.match(center, /\(working \|\| view\.active\) && !view\.completed/);
  assert.match(center, /displayProgress = view\.active \? view\.progress : working \? 5 : 0/);
});

test('la omisión de firma queda registrada y no se presenta como firma incluida', () => {
  const policy = source('backend/src/services/maintenance-optional-signature.patch.js');

  assert.match(policy, /FirmaOmitidaAlFinalizar:\s*!included/);
  assert.match(policy, /Los PDF fueron creados sin firma del cliente/);
  assert.match(policy, /ticketGeneration:[\s\S]*signatureIncluded:\s*false/);
  assert.match(policy, /refreshedSignedReports:\s*\[\]/);
});
