import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('la notificación de firma resuelve destinatarios desde asignaciones reales', () => {
  const notification = source('backend/src/services/signature-completion-notification.service.js');

  assert.match(notification, /readTables\(\['BoletaAsignados', 'Usuarios'\]\)/);
  assert.match(notification, /assignment\.BoletaUID/);
  assert.match(notification, /assignment\.UsuarioID/);
  assert.match(notification, /ResponsableIDsJSON/);
  assert.match(notification, /user\.Correo/);
  assert.match(notification, /new Set/);
});

test('una firma nueva de boleta notifica asignados una sola vez y el correo no invalida la firma', () => {
  const module = source('backend/src/modules/ticket-group-signature.module.js');
  const alreadySignedIndex = module.indexOf('if (signed.alreadySigned)');
  const notifyIndex = module.indexOf('await notifyTicketSignatureCompleted');

  assert.ok(alreadySignedIndex >= 0, 'Debe conservar el retorno para firmas ya existentes.');
  assert.ok(notifyIndex > alreadySignedIndex, 'La notificación debe ocurrir solo después de descartar alreadySigned.');
  assert.match(module, /try \{[\s\S]*await notifyTicketSignatureCompleted\([\s\S]*\} catch \(error\) \{/);
  assert.match(module, /assigneesNotified: Boolean\(assigneeNotification\.sent\)/);
});

test('el mantenimiento notifica responsables solo para una firma real y nueva', () => {
  const module = source('backend/src/modules/maintenance-signature.module.js');

  assert.match(module, /if \(!signed\.testMode && !signed\.alreadySigned\) \{/);
  assert.match(module, /await notifyMaintenanceSignatureCompleted\(/);
  assert.match(module, /try \{[\s\S]*await notifyMaintenanceSignatureCompleted\([\s\S]*\} catch \(error\) \{/);
  assert.match(module, /Las firmas de prueba no notifican responsables/);
});

test('el correo de firma usa Apps Script con idempotencia y conserva SMTP solo como compatibilidad', () => {
  const notification = source('backend/src/services/signature-completion-notification.service.js');

  assert.match(notification, /import \{ sendAppsScriptAction \} from '\.\/apps-script-action\.service\.js'/);
  assert.match(notification, /sendAppsScriptAction\(\s*'signature\.completed\.send'/);
  assert.match(notification, /idempotencyKey: signatureIdempotencyKey/);
  assert.match(notification, /attempts: 2/);
  assert.match(notification, /allowSmtpCompatibilityFallback/);
  assert.match(notification, /transport\.sendMail\(/);
  assert.match(notification, /SMTP no está configurado/);
});

test('el aviso lleva directamente a la boleta o mantenimiento firmado', () => {
  const notification = source('backend/src/services/signature-completion-notification.service.js');

  assert.match(notification, /subjectType === 'maintenance' \? 'mantenimientos' : 'boletas'/);
  assert.match(notification, /encodeURIComponent\(id\)/);
  assert.match(notification, /Ver boleta firmada/);
  assert.match(notification, /Ver mantenimiento firmado/);
  assert.match(notification, /subjectId: rootId/);
  assert.match(notification, /subjectId: maintenance\?\.MantenimientoID/);
});

test('el correo de firma sigue siendo liviano y no adjunta evidencias ni PDFs', () => {
  const notification = source('backend/src/services/signature-completion-notification.service.js');
  const sendStart = notification.indexOf('async function sendThroughSmtp');
  const publicStart = notification.indexOf('export async function notifyTicketSignatureCompleted');
  const sendSource = notification.slice(sendStart, publicStart);

  assert.match(sendSource, /transport\.sendMail\(/);
  assert.doesNotMatch(sendSource, /attachments\s*:/);
  assert.match(sendSource, /El cliente completó y guardó correctamente la firma/);
});
