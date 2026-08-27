import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

const agendaChatSource = fs.readFileSync(path.join(root, 'backend/src/services/agenda-chat.service.js'), 'utf8');
const chatSource = fs.readFileSync(path.join(root, 'backend/src/services/chat.service.js'), 'utf8');
const agendaModuleSource = fs.readFileSync(path.join(root, 'backend/src/modules/agenda.module.js'), 'utf8');
const configSource = fs.readFileSync(path.join(root, 'backend/src/modules/config.module.js'), 'utf8');
const settingsPageSource = fs.readFileSync(path.join(root, 'src/pages/admin/NotificationSettingsPage.jsx'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'src/app/App.jsx'), 'utf8');
const moreSource = fs.readFileSync(path.join(root, 'src/pages/MorePage.jsx'), 'utf8');
const splitDialogSource = fs.readFileSync(path.join(root, 'src/pages/agenda/AgendaSplitDialog.jsx'), 'utf8');

assert.match(chatSource, /export function normalizeWebhook/);
assert.match(chatSource, /replace\(\/&amp;\/gi, '&'\)/);
assert.match(chatSource, /export function isValidWebhook/);
assert.match(chatSource, /url\.hostname === 'chat\.googleapis\.com'/);
assert.match(chatSource, /url\.searchParams\.has\('key'\)/);
assert.match(chatSource, /url\.searchParams\.has\('token'\)/);
assert.match(chatSource, /RETRYABLE_CHAT_STATUSES/);
assert.match(chatSource, /attempts = Math\.max/);
assert.match(chatSource, /CHAT_TIMEOUT/);

assert.match(agendaChatSource, /AGENDA_CHAT_WEBHOOK/);
assert.match(agendaChatSource, /buildAgendaChatMessage/);
assert.match(agendaChatSource, /AGENDA DMS · NUEVA/);
assert.match(agendaChatSource, /AGENDA DMS · ACTUALIZADA/);
assert.match(agendaChatSource, /\/agenda\?agendaId=/);
assert.match(agendaChatSource, /month=/);
assert.match(agendaChatSource, /Asignados:/);
assert.match(agendaChatSource, /sendChatMessage/);
assert.match(agendaChatSource, /testAgendaChatNotification/);
assert.match(agendaChatSource, /DMS BOLETAS · PRUEBA DE CHAT DE AGENDA/);
assert.match(agendaChatSource, /providerResponse/);
assert.match(agendaChatSource, /configured: false, sent: false, skipped: true/);
assert.match(agendaChatSource, /console\.warn\(`\[agenda-chat\]/);

assert.match(agendaModuleSource, /sendAgendaChatNotification/);
assert.match(agendaModuleSource, /Promise\.all\(\[emailPromise, chatPromise\]\)/);
assert.match(agendaModuleSource, /notification\.chat\?\.configured/);
assert.match(agendaModuleSource, /Google Chat no pudo recibir la notificación/);

assert.match(configSource, /AGENDA_CHAT_SECTION/);
assert.match(configSource, /handleAgendaChatSection/);
assert.match(configSource, /USUARIOS_GESTIONAR/);
assert.match(configSource, /ACTUALIZAR_CHAT_AGENDA/);
assert.match(configSource, /PROBAR_CHAT_AGENDA/);
assert.match(configSource, /\['TEST', 'PROBAR', 'PRUEBA'\]/);
assert.match(configSource, /testAgendaChatNotification/);
assert.match(configSource, /SENSITIVE_KEY = \/\(WEBHOOK\|SECRET\|PASSWORD\|TOKEN\|PRIVATE\|API_KEY\)\/i/);

assert.match(settingsPageSource, /section: 'AGENDA_CHAT'/);
assert.match(settingsPageSource, /operation: 'TEST'/);
assert.match(settingsPageSource, /Probar envío/);
assert.match(settingsPageSource, /Guardando y probando/);
assert.match(settingsPageSource, /HTTP/);
assert.match(settingsPageSource, /redactedWebhook/);
assert.match(settingsPageSource, /Por seguridad, el webhook guardado nunca se muestra completo/);
assert.match(settingsPageSource, /chat\.google\.com/);
assert.match(settingsPageSource, /settings: \{ webhook: '' \}/);
assert.match(appSource, /path="administracion\/notificaciones"/);
assert.match(appSource, /permission="USUARIOS_GESTIONAR"/);
assert.match(moreSource, /to="\/administracion\/notificaciones"/);
assert.match(splitDialogSource, /agenda\.create/);
assert.match(splitDialogSource, /agenda\.update/);

console.log('✓ agenda chat: webhook protegido, prueba real, diagnóstico HTTP, retry, enlaces directos y flujo central');