import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAgendaChatMessage } from '../../backend/src/services/agenda-chat.service.js';
import { isValidWebhook } from '../../backend/src/services/chat.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

const validWebhook = 'https://chat.googleapis.com/v1/spaces/AAA/messages?key=test-key&token=test-token';
assert.equal(isValidWebhook(validWebhook), true);
assert.equal(isValidWebhook('https://example.com/v1/spaces/AAA/messages?key=x&token=y'), false);
assert.equal(isValidWebhook('https://chat.googleapis.com/v1/spaces/AAA/messages?key=x'), false);

const message = buildAgendaChatMessage({
  mode: 'CREATED',
  appUrl: 'https://dms.example.com/',
  views: [{
    AgendaID: 'AGENDA-123',
    Fecha: '2026-08-30',
    HoraInicio: '08:00',
    HoraFin: '11:30',
    Detalle: 'Asamblea · mantenimiento preventivo',
    asignados: [
      { UsuarioID: 'U1', NombreCompleto: 'Técnico Uno' },
      { UsuarioID: 'U2', NombreCompleto: 'Técnico Dos' },
    ],
  }],
});

assert.match(message, /AGENDA DMS · NUEVA/);
assert.match(message, /2026-08-30 · 08:00–11:30/);
assert.match(message, /Asamblea · mantenimiento preventivo/);
assert.match(message, /Técnico Uno, Técnico Dos/);
assert.match(message, /https:\/\/dms\.example\.com\/agenda\?agendaId=AGENDA-123&month=2026-08/);

const updatedMessage = buildAgendaChatMessage({
  mode: 'UPDATED',
  appUrl: 'https://dms.example.com',
  views: [{ AgendaID: 'A2', Fecha: '2026-09-01', HoraInicio: '09:00', HoraFin: '10:00', Detalle: 'Visita', asignados: [] }],
});
assert.match(updatedMessage, /AGENDA DMS · ACTUALIZADA/);

const agendaModuleSource = fs.readFileSync(path.join(root, 'backend/src/modules/agenda.module.js'), 'utf8');
const configSource = fs.readFileSync(path.join(root, 'backend/src/modules/config.module.js'), 'utf8');
const settingsPageSource = fs.readFileSync(path.join(root, 'src/pages/admin/NotificationSettingsPage.jsx'), 'utf8');
const splitDialogSource = fs.readFileSync(path.join(root, 'src/pages/agenda/AgendaSplitDialog.jsx'), 'utf8');

assert.match(agendaModuleSource, /sendAgendaChatNotification/);
assert.match(agendaModuleSource, /Promise\.all\(\[emailPromise, chatPromise\]\)/);
assert.match(configSource, /AGENDA_CHAT_SECTION/);
assert.match(configSource, /USUARIOS_GESTIONAR/);
assert.match(settingsPageSource, /section: 'AGENDA_CHAT'/);
assert.match(settingsPageSource, /redactedWebhook/);
assert.match(splitDialogSource, /agenda\.create/);
assert.match(splitDialogSource, /agenda\.update/);

console.log('✓ agenda chat: webhook seguro, mensaje con enlace directo, flujo central y configuración administrativa');
