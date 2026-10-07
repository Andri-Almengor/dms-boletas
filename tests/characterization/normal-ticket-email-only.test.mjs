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


test('EnviarCorreoCliente no desactiva el correo completo de una boleta normal', () => {
  const script = source('apps-script/report-service/Code.gs');
  const start = script.indexOf('function resolveReportSendEmail_');
  const end = script.indexOf('function reportBoolean_', start);
  const resolver = script.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(resolver, /isMaintenanceArchiveDelivery_/);
  assert.match(resolver, /request\.sendEmail/);
  assert.doesNotMatch(resolver, /EnviarCorreoCliente/);
  assert.match(script, /2026-10-07-V7\.14-TICKET-LARGE-VIDEO/);
});

test('la finalización usa la selección actual de copia al cliente y CC del formulario', () => {
  const module = source('backend/src/modules/ticket-delivery.module.js');

  assert.match(module, /applyFinalizationRecipientOverrides/);
  assert.match(module, /sendClientCopy/);
  assert.match(module, /patch\.EnviarCorreoCliente = asBool/);
  assert.match(module, /patch\.CorreosCC = pick/);

  const applyIndex = module.indexOf('currentGroup = await applyFinalizationRecipientOverrides');
  const deliverIndex = module.indexOf('const delivery = await deliverTicket', applyIndex);
  assert.ok(applyIndex >= 0 && deliverIndex > applyIndex);
});

test('Yehuda es siempre el destinatario principal y la copia al cliente usa CorreoSupervisor', () => {
  const group = source('backend/src/services/apps-script-ticket-group.service.js');
  const single = source('backend/src/services/apps-script-ticket.service.js');

  for (const service of [group, single]) {
    assert.match(service, /TICKET_PRIMARY_EMAIL = 'yehuda\.karmona@solutionsdms\.com'/);
    assert.match(service, /const to = splitEmails\(TICKET_PRIMARY_EMAIL\)/);
    assert.match(service, /CorreoSupervisor/);
    assert.match(service, /\.\.\.\(includeClient \? supervisorEmails : \[\]\)/);
    assert.doesNotMatch(service, /bundle\.client\?\.CorreoGeneral/);
  }

  assert.match(group, /email-recovery-group:/);
  assert.match(single, /email-recovery:/);
});


test('el alias corporativo es preferido pero no bloquea el envío de boletas', () => {
  const script = source('apps-script/report-service/Code.gs');
  const aliasStart = script.indexOf('function getDmsEmailFromAlias_');
  const aliasEnd = script.indexOf('function isDmsAliasSendError_', aliasStart);
  const aliasResolver = script.slice(aliasStart, aliasEnd);
  const senderStart = script.indexOf('function sendDmsEmail_');
  const senderEnd = script.indexOf('function dmsDiagnoseEmailAlias', senderStart);
  const sender = script.slice(senderStart, senderEnd);

  assert.ok(aliasStart >= 0 && aliasEnd > aliasStart);
  assert.doesNotMatch(aliasResolver, /DMS_EMAIL_ALIAS_NOT_CONFIGURED/);
  assert.doesNotMatch(aliasResolver, /throw error/);
  assert.match(aliasResolver, /cuenta efectiva del Web App/);
  assert.match(sender, /mailAppSend_/);
  assert.match(script, /function mailAppSend_[\s\S]*?MailApp\.sendEmail/);
  assert.match(sender, /aliasFallback/);
  assert.match(sender, /CORPORATE_ALIAS/);
});

test('técnicos y correos configurados permanecen en CC y nunca desplazan al destinatario principal', () => {
  const group = source('backend/src/services/apps-script-ticket-group.service.js');
  const single = source('backend/src/services/apps-script-ticket.service.js');

  for (const service of [group, single]) {
    assert.match(service, /const technicianEmails = splitEmails/);
    assert.match(service, /const ticketCcEmails = splitEmails/);
    assert.match(service, /\.\.\.technicianEmails/);
    assert.match(service, /\.\.\.configuredCc/);
    assert.match(service, /\.\.\.ticketCcEmails/);
    assert.match(service, /filter\(\(email\) => !to\.includes\(email\)\)/);
  }
});

test('el reporte firmado conserva a Yehuda en TO y copia al cliente mediante el supervisor', () => {
  const delivery = source('backend/src/services/ticket-group-delivery.service.js');
  const groupService = source('backend/src/services/apps-script-ticket-group.service.js');
  const signedBlock = delivery.match(/export async function deliverSignedTicket[\s\S]*?\n\}/)?.[0] || '';

  assert.doesNotMatch(signedBlock, /CorreoCliente/);
  assert.doesNotMatch(signedBlock, /recipientsOverride/);
  assert.match(signedBlock, /deliveryType: 'SIGNED'/);
  assert.match(groupService, /deliveryType === 'SIGNED'/);
  assert.match(groupService, /includeClient \? supervisorEmails/);
});

test('una boleta finalizada puede reenviar solamente el correo sin tocar Google Chat', () => {
  const delivery = source('backend/src/services/ticket-group-delivery.service.js');
  const module = source('backend/src/modules/ticket-delivery.module.js');
  const router = source('backend/src/core/action-router.js');
  const api = source('src/services/moduleApi.js');
  const detail = source('src/pages/tickets/TicketDetailPage.jsx');

  assert.match(delivery, /export async function resendTicketEmail/);
  assert.match(delivery, /deliveryType: 'MANUAL_EMAIL_RESEND'/);
  assert.match(delivery, /requestId: uuid\(\)/);
  assert.doesNotMatch(
    delivery.match(/export async function resendTicketEmail[\s\S]*?\n\}/)?.[0] || '',
    /sendChatMessage/,
  );
  assert.match(module, /REENVIAR_GRUPO_BOLETAS_CORREO/);
  assert.match(router, /boletas\.resendEmail/);
  assert.match(api, /resendEmail: \['boletas\.resendEmail'/);
  assert.match(detail, /Reenviar correo/);
});
