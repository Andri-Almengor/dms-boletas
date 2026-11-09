import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function section(text, startToken, endToken) {
  const start = text.indexOf(startToken);
  const end = text.indexOf(endToken, start);
  assert.ok(start >= 0 && end > start, `No se encontró la sección ${startToken}`);
  return text.slice(start, end);
}

const backend = source('backend/src/modules/agenda.module.js');
const resend = source('backend/src/modules/agenda-resend.module.js');
const script = source('apps-script/report-service/Code.gs');

const buildDeliveries = vm.runInNewContext([
  section(backend, 'function clean(', '\nfunction isAdmin('),
  section(backend, 'function userDisplay(', '\nfunction clientId('),
  section(backend, 'export function buildDeliveries(', '\nasync function notifyAgenda(').replace(/^export /, ''),
  'buildDeliveries;',
].join('\n'));

const sent = [];
const htmlEscape = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const sendAgendaDeliveryEmail = vm.runInNewContext([
  section(script, 'function agendaAssignedNames_(', '\n/**\n * Correo de creación/modificación'),
  section(script, 'function sendAgendaDeliveryEmail_(', '\n\n/**\n * Informa a un técnico'),
  'sendAgendaDeliveryEmail_;',
].join('\n'), {
  MailApp: { getRemainingDailyQuota: () => 50 },
  clean_: (value, fallback = '') => String(value ?? '').trim() || fallback,
  formatAgendaDate_: (value) => String(value),
  escapeHtml_: htmlEscape,
  nl2br_: (value) => htmlEscape(value).replace(/\n/g, '<br>'),
  buttonHtml_: () => '<a>Agenda</a>',
  sendDmsEmail_: (data) => sent.push(JSON.parse(JSON.stringify(data))),
  sendAgendaTicketCreatedPendingEmail_: () => { throw new Error('Flujo ajeno a la prueba'); },
  BRAND_BACKGROUND: '#ffffff',
  BRAND_BORDER: '#cccccc',
  BRAND_RED: '#bf0017',
  BRAND_TEXT: '#111827',
  BRAND_MUTED: '#6b7280',
});

const andrick = { UsuarioID: 'U1', NombreCompleto: 'Andrick Almengor', Correo: 'andrick@example.com' };
const dixon = { UsuarioID: 'U2', NombreCompleto: 'Dixon Mora', Correo: 'dixon@example.com' };
const yasdani = { UsuarioID: 'U3', NombreCompleto: 'Yasdani Valdivia', Correo: 'yasdani@example.com' };

function visit(id, users) {
  return {
    AgendaID: id,
    Fecha: '2026-11-09',
    HoraInicio: '07:00',
    HoraFin: '17:00',
    Detalle: 'RN-Oficina',
    asignados: users,
  };
}

function deliver(delivery, mode = 'CREATED') {
  sent.length = 0;
  sendAgendaDeliveryEmail(delivery.correo, delivery.nombre, delivery.agendas, mode, 'https://example.com');
  assert.equal(sent.length, 1);
  return sent[0];
}

test('una visita de dos personas saluda con ambos nombres y mantiene correo individual y diseño', () => {
  const deliveries = JSON.parse(JSON.stringify(buildDeliveries([visit('A1', [andrick, dixon])], [andrick, dixon])));
  assert.equal(deliveries.length, 2);
  assert.deepEqual(deliveries.map((d) => d.correo), ['andrick@example.com', 'dixon@example.com']);
  assert.deepEqual(deliveries[0].agendas[0].assignedNames, ['Andrick Almengor', 'Dixon Mora']);

  const first = deliver(deliveries[0]);
  assert.equal(first.to, 'andrick@example.com');
  assert.match(first.body, /^Hola Andrick, Dixon\./);
  assert.match(first.htmlBody, /Hola <strong>Andrick, Dixon<\/strong>\./);
  assert.match(first.body, /Personal asignado: Andrick Almengor, Dixon Mora/);
  assert.match(first.htmlBody, /Personal asignado: Andrick Almengor, Dixon Mora/);
  assert.match(first.htmlBody, /Abrir agenda en DMS Boletas/);

  const second = deliver(deliveries[1]);
  assert.match(second.body, /^Hola Dixon, Andrick\./);
});

test('una persona asignada conserva el saludo histórico', () => {
  const [delivery] = JSON.parse(JSON.stringify(buildDeliveries([visit('A1', [andrick])], [andrick])));
  const email = deliver(delivery);
  assert.match(email.body, /^Hola Andrick Almengor,/);
  assert.doesNotMatch(email.body, /Personal asignado:/);
});

test('un lote con compañeros distintos muestra cada equipo por visita sin mezclar saludos', () => {
  const deliveries = JSON.parse(JSON.stringify(buildDeliveries([
    visit('A1', [andrick, dixon]),
    visit('A2', [andrick, yasdani]),
  ], [andrick, dixon, yasdani])));
  const email = deliver(deliveries.find((entry) => entry.correo === 'andrick@example.com'));
  assert.match(email.body, /^Hola Andrick Almengor,/);
  assert.match(email.body, /Personal asignado: Andrick Almengor, Dixon Mora/);
  assert.match(email.body, /Personal asignado: Andrick Almengor, Yasdani Valdivia/);
});

test('actualización que retira un asignado no lo saluda como integrante del equipo', () => {
  const delivery = {
    correo: 'andrick@example.com',
    nombre: 'Andrick Almengor',
    agendas: [{ fecha: '2026-11-09', detalle: 'Visita', assigned: false, assignedNames: ['Dixon Mora', 'Yasdani Valdivia'] }],
  };
  const email = deliver(delivery, 'UPDATED');
  assert.match(email.body, /^Hola Andrick Almengor,/);
  assert.match(email.body, /Ya no está asignado/);
  assert.doesNotMatch(email.body, /Personal asignado:/);
});

test('payload anterior sin nombres de equipo mantiene compatibilidad y nombres homónimos son identificables', () => {
  const oldMail = deliver({
    correo: 'andrick@example.com',
    nombre: 'Andrick Almengor',
    agendas: [{ fecha: '2026-11-09', detalle: 'Visita', assigned: true }],
  });
  assert.match(oldMail.body, /^Hola Andrick Almengor,/);

  const namesake = deliver({
    correo: 'ana@example.com',
    nombre: 'Ana Pérez',
    agendas: [{ fecha: '2026-11-09', detalle: 'Visita', assigned: true, assignedNames: ['Ana Pérez', 'Ana Soto'] }],
  });
  assert.match(namesake.body, /^Hola Ana Pérez, Ana Soto\./);
});

test('el reenvío reutiliza el constructor de notificaciones sin enviar Google Chat', () => {
  assert.match(resend, /import \{ agendaHandlers, buildDeliveries \} from '\.\/agenda\.module\.js'/);
  assert.match(resend, /buildDeliveries\(\[item\], item\.asignados \|\| \[\], 'RESENT'\)/);
  assert.doesNotMatch(resend, /function emailDeliveries\(/);
  assert.match(script, /APPS_SCRIPT_VERSION = '2026-11-09-V7\.16-AGENDA-TEAM-EMAIL'/);
});
