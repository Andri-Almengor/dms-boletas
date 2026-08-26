import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('las boletas de mantenimiento continúan sin correo', () => {
  const archive = source('backend/src/services/maintenance-ticket-archive-only.patch.js');
  assert.match(archive, /deliveryType:\s*'MAINTENANCE_ARCHIVE'/);
  assert.match(archive, /sendEmail:\s*false/);
  assert.match(archive, /CorreoEnviado:\s*false/);
  assert.match(archive, /EstadoNotificacion:\s*'OMITIDO'/);
});

test('la recuperación de correo actúa únicamente sobre boletas normales', () => {
  const recovery = source('backend/src/services/normal-ticket-email-recovery.patch.js');
  assert.match(recovery, /function isMaintenanceTicket/);
  assert.match(recovery, /if \(isMaintenanceTicket\(requestedTicket\)\) return originalFinalize\(ctx\)/);
  assert.match(recovery, /sendEmail:\s*true/);
  assert.match(recovery, /deliveryType:\s*'NORMAL_EMAIL_RECOVERY'/);
  assert.match(recovery, /RECUPERAR_CORREO_BOLETA_NORMAL/);
  assert.match(recovery, /ChatReenviado:\s*false/);
});

test('una boleta normal finalizada con correo omitido o pendiente puede recuperar solo el correo', () => {
  const recovery = source('backend/src/services/normal-ticket-email-recovery.patch.js');
  assert.match(recovery, /\['OMITIDO', 'PENDIENTE'\]\.includes\(state\)/);
  assert.match(recovery, /historicalEmailPending/);
  assert.match(recovery, /FINALIZADA_SIN_CORREO_CONFIRMADO/);
  assert.match(recovery, /EstadoNotificacion:\s*'ENVIADO'/);
  assert.match(recovery, /UltimoErrorNotificacion:\s*''/);
});

test('una finalización nueva de boleta normal exige confirmación real del correo', () => {
  const recovery = source('backend/src/services/normal-ticket-email-recovery.patch.js');
  assert.match(recovery, /notification\.result\?\.sent === true/);
  assert.match(recovery, /if \(result\?\.delivery && !emailConfirmed\(result\.delivery\)\)/);
  assert.match(recovery, /FINALIZACION_SIN_CONFIRMACION_DE_CORREO/);
  assert.match(recovery, /NORMAL_TICKET_EMAIL_NOT_SENT/);
});

test('la recuperación se instala después del handler que excluye correo de mantenimiento', () => {
  const resume = source('backend/src/services/maintenance-finalization-resume.patch.js');
  const archiveIndex = resume.indexOf("await import('./maintenance-ticket-archive-only.patch.js')");
  const normalIndex = resume.indexOf("await import('./normal-ticket-email-recovery.patch.js')");
  assert.ok(archiveIndex >= 0);
  assert.ok(normalIndex > archiveIndex);
});
