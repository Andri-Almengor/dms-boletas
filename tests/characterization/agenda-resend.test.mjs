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
assert.doesNotMatch(resendSource, /updateRow\(/, 'Reenviar una agenda no debe modificar el registro de Agenda.');
assert.doesNotMatch(resendSource, /RecordatorioEnviado/, 'El reenvío manual no debe alterar el recordatorio diario.');

assert.match(chatSource, /AGENDA DMS · REENVIADA/);
assert.match(pageSource, /AgendaResendActions/);
assert.match(actionsSource, /Reenviar correo/);
assert.match(actionsSource, /Reenviar Chat/);
assert.match(actionsSource, /agenda\.resend\.email/);
assert.match(actionsSource, /agenda\.resend\.chat/);
assert.match(styleSource, /@media\(max-width:430px\)/);

console.log('✓ agenda resend: correo/chat separados, permisos admin, auditoría y sin alterar la agenda');
