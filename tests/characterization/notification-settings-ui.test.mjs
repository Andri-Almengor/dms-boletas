import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

const pageSource = fs.readFileSync(path.join(root, 'src/pages/admin/NotificationSettingsPage.jsx'), 'utf8');
const adminRouteStyles = fs.readFileSync(path.join(root, 'src/styles/routes/admin.js'), 'utf8');
const styleSource = fs.readFileSync(path.join(root, 'src/styles/notification-settings.css'), 'utf8');
const moreSource = fs.readFileSync(path.join(root, 'src/pages/MorePage.jsx'), 'utf8');
const configSource = fs.readFileSync(path.join(root, 'backend/src/modules/config.module.js'), 'utf8');

assert.match(pageSource, /section: 'NOTIFICATION_EMAILS'/);
assert.match(pageSource, /section: 'AGENDA_CHAT'/);
assert.match(pageSource, /Destinatarios principales/);
assert.match(pageSource, /Copias de casos nuevos/);
assert.match(pageSource, /Copias al asignar casos/);
assert.match(pageSource, /Copias de boletas/);
assert.match(pageSource, /Destinatarios de prueba/);
assert.match(pageSource, /Copias de prueba/);
assert.match(pageSource, /Guardar destinatarios y copias/);
assert.match(pageSource, /Google Chat/);
assert.match(pageSource, /Promise\.all/);
assert.match(pageSource, /notification-settings-shell/);

assert.match(adminRouteStyles, /notification-settings\.css/);
assert.match(styleSource, /width: min\(100%, 1360px\)/);
assert.match(styleSource, /grid-template-columns: minmax\(0, 1\.55fr\) minmax\(340px, \.78fr\)/);
assert.match(styleSource, /@media \(max-width: 760px\)/);
assert.match(styleSource, /notification-email-grid/);
assert.match(styleSource, /notification-chat-state/);

assert.match(moreSource, /Destinatarios, copias y Google Chat de Agenda/);
assert.match(configSource, /NOTIFICATION_EMAILS/);
assert.match(configSource, /AGENDA_CHAT/);
assert.match(configSource, /USUARIOS_GESTIONAR/);

console.log('✓ notificaciones fase 1: correos + chat unificados, layout amplio y responsive, permisos preservados');
