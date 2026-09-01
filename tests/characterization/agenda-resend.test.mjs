import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

const routerSource = fs.readFileSync(path.join(root, 'backend/src/core/action-router.js'), 'utf8');
const resendSource = fs.readFileSync(path.join(root, 'backend/src/modules/agenda-resend.module.js'), 'utf8');
const chatSource = fs.readFileSync(path.join(root, 'backend/src/services/agenda-chat.service.js'), 'utf8');
const pageSource = fs.readFileSync(path.join(root, 'src/pages/agenda/AgendaPage.jsx'), 'utf8');
const actionsSource = fs.readFileSync(path.join(root, 'src/pages/agenda/AgendaResendActions.jsx'), 'utf8');
const styleSource = fs.readFileSync(path.join(root, 'src/styles/agenda-resend.css'), 'utf8');

assert.match(routerSource, /agenda\.resend\.email/);
assert.match(routerSource, /agenda\.resend\.chat/);
assert.match(routerSource, /agendaResendHandlers\.email,'USUARIOS_GESTIONAR'/);
assert.match(routerSource, /agendaResendHandlers\.chat,'USUARIOS_GESTIONAR'/);

assert.match(resendSource, /agendaHandlers\.get/);
assert.match(resendSource, /agenda\.notification\.send/);
assert.match(resendSource, /reason: 'MANUAL_RESEND'/);
assert.match(resendSource, /sendAgendaChatNotification/);
assert.match(resendSource, /mode: 'RESENT'/);
assert.match(resendSource, /REENVIAR_AGENDA_CORREO/);
assert.match(resendSource, /REENVIAR_AGENDA_CHAT/);
assert.match(resendSource, /PENDING_TICKET_TEST/);
assert.match(resendSource, /mode: 'PENDING_TEST'/);
assert.match(resendSource, /reason: 'MANUAL_PENDING_TICKET_TEST'/);
assert.match(resendSource, /PROBAR_RECORDATORIO_BOLETA_PENDIENTE/);
assert.match(resendSource, /stateChanged: false/);
assert.match(resendSource, /Publique la V7\.6/);
assert.doesNotMatch(resendSource, /updateRow\(/, 'Reenviar o probar una agenda no debe modificar el registro de Agenda.');
assert.doesNotMatch(resendSource, /RecordatorioEnviado\s*=/, 'La prueba manual no debe alterar el recordatorio diario.');

assert.match(chatSource, /AGENDA DMS · REENVIADA/);
assert.match(pageSource, /AgendaResendActions/);
assert.match(actionsSource, /Reenviar correo/);
assert.match(actionsSource, /Reenviar Chat/);
assert.match(actionsSource, /Probar boleta pendiente/);
assert.match(actionsSource, /notificationType: 'PENDING_TICKET_TEST'/);
assert.match(actionsSource, /Diagnóstico de la prueba/);
assert.match(actionsSource, /No cambia RecordatorioEnviado/);
assert.match(styleSource, /agenda-resend-diagnostics/);
assert.match(styleSource, /@media\(max-width:430px\)/);

console.log('✓ agenda resend: correo/chat + prueba de boleta pendiente, diagnóstico admin y sin alterar la agenda');
