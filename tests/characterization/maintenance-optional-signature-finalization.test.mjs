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

test('un guardián previo evita que la función antigua de firma sea alcanzada', () => {
  const guard = source('backend/src/services/maintenance-unsigned-finalization-guard.patch.js');
  const resume = source('backend/src/services/maintenance-finalization-resume.patch.js');

  assert.match(guard, /if \(!maintenanceHasSignature\(maintenance\)\)/);
  assert.match(guard, /return finalizeUnsigned\(ctx, id\)/);
  assert.match(guard, /generateMaintenanceTickets\(ctx, id\)/);
  assert.match(guard, /maintenanceReportAccessHandlers\.finalize\(ctx\)/);
  assert.match(guard, /FirmaEstadoFinalizacion:\s*'OMITIDA'/);
  assert.match(guard, /UltimoErrorFinalizacion:\s*''/);
  assert.match(resume, /^import '\.\/maintenance-unsigned-finalization-guard\.patch\.js';\nimport '\.\/maintenance-optional-signature\.patch\.js';/m);
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

  assert.match(resume, /maintenance-unsigned-finalization-guard\.patch\.js/);
  assert.match(resume, /maintenance-optional-signature\.patch\.js/);
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
  assert.match(center, /Si no existe firma, las boletas y PDF se generarán sin firma/);
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

test('un error anterior de firma se convierte en reintento aunque el estado haya quedado inconsistente', () => {
  const center = source('src/components/offline/MaintenanceFinalizationCenter.jsx');
  const domain = source('src/services/maintenanceFinalizationDomain.js');

  assert.match(domain, /legacySignatureError/);
  assert.match(domain, /debe firmar el mantenimiento general/);
  assert.match(domain, /legacySignatureFailure[\s\S]*state = 'ERROR'/);
  assert.match(domain, /Ahora puede reintentarse y finalizarse sin firma/);
  assert.match(domain, /canRetry:[\s\S]*legacySignatureFailure/);
  assert.match(center, /\(!view\.active \|\| view\.canRetry\)/);
  assert.match(center, /onClick=\{\(\) => finalize\(\{ retry: retryFromError \}\)\}/);
  assert.match(center, /retryFromError \? 'Reintentar finalización'/);
  assert.match(center, /catch \(error\) \{[\s\S]*setMessage\([\s\S]*await refresh\(\);/);
});

test('la pantalla de carga bloquea la interfaz desde el primer toque', () => {
  const center = source('src/components/offline/MaintenanceFinalizationCenter.jsx');
  const styles = source('src/components/offline/MaintenanceFinalizationCenter.css');

  assert.match(center, /maintenance-finalization-blocking/);
  assert.match(center, /aria-busy="true"/);
  assert.match(center, /Finalizando mantenimiento/);
  assert.match(center, /No cierre la aplicación mientras se generan y envían las boletas/);
  assert.match(styles, /\.maintenance-finalization-blocking\s*\{[\s\S]*position:\s*fixed[\s\S]*inset:\s*0[\s\S]*z-index:\s*5000/);
  assert.match(styles, /maintenance-finalization-spin/);
});

test('la omisión de firma queda registrada y no se presenta como firma incluida', () => {
  const policy = source('backend/src/services/maintenance-optional-signature.patch.js');
  const guard = source('backend/src/services/maintenance-unsigned-finalization-guard.patch.js');

  assert.match(policy, /FirmaOmitidaAlFinalizar:\s*!included/);
  assert.match(policy, /Los PDF fueron creados sin firma del cliente/);
  assert.match(policy, /ticketGeneration:[\s\S]*signatureIncluded:\s*false/);
  assert.match(policy, /refreshedSignedReports:\s*\[\]/);
  assert.match(guard, /FirmaOmitidaAlFinalizar:\s*true/);
  assert.match(guard, /signatureStatus:\s*'OMITIDA'/);
});
