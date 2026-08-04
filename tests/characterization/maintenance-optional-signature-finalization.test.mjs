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

test('el flujo firmado existente se conserva cuando hay firma', () => {
  const policy = source('backend/src/services/maintenance-optional-signature.patch.js');

  assert.match(policy, /maintenanceHasSignature\(maintenance\)/);
  assert.match(policy, /const result = await originalFinalize\(ctx\)/);
  assert.match(policy, /signatureIncluded:\s*true/);
  assert.match(policy, /signatureStatus:\s*'INCLUIDA'/);
  assert.match(policy, /FINALIZAR_MANTENIMIENTO_CON_FIRMA/);
  assert.match(policy, /signedReportsPreserved:\s*true/);
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
  assert.doesNotMatch(center, /La firma es opcional/);
  assert.doesNotMatch(center, /las boletas y PDF se generarán sin firma/);
  assert.doesNotMatch(center, /Si no existe firma/);
  assert.match(center, /statusMessage && <small>/);
  assert.match(center, /status === 'PENDIENTE'/);
  assert.match(center, /devices > 0/);
  assert.match(center, /Finalizar mantenimiento/);
  assert.match(center, /Finalizar al sincronizar/);
  assert.match(styles, /maintenance-detail-footer-actions > button\.button--primary:first-child/);
  assert.match(styles, /display:\s*none/);
  assert.match(domain, /label:\s*'Validando mantenimiento'/);
  assert.doesNotMatch(domain, /Validando mantenimiento y firma/);
});

test('la omisión de firma queda registrada y no se presenta como firma incluida', () => {
  const policy = source('backend/src/services/maintenance-optional-signature.patch.js');

  assert.match(policy, /FirmaOmitidaAlFinalizar:\s*!included/);
  assert.match(policy, /Los PDF fueron creados sin firma del cliente/);
  assert.match(policy, /ticketGeneration:[\s\S]*signatureIncluded:\s*false/);
  assert.match(policy, /refreshedSignedReports:\s*\[\]/);
});
