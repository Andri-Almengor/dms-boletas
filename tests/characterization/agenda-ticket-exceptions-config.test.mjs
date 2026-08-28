import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  agendaRequiresTicket as backendRequiresTicket,
  DEFAULT_AGENDA_TICKET_EXCEPTIONS as backendDefaults,
} from '../../backend/src/services/agenda-domain.service.js';
import {
  agendaRequiresTicket as frontendRequiresTicket,
  DEFAULT_AGENDA_TICKET_EXCEPTIONS as frontendDefaults,
} from '../../src/features/agenda/agendaDomain.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('Zona Franca La Lima queda excluida por defecto en backend y frontend', () => {
  assert.ok(backendDefaults.includes('Zona Franca La Lima'));
  assert.ok(frontendDefaults.includes('Zona Franca La Lima'));
  assert.equal(backendRequiresTicket('Zona Franca La Lima'), false);
  assert.equal(backendRequiresTicket('Visita Zona Franca La Lima para revisión'), false);
  assert.equal(frontendRequiresTicket('ZONA FRANCA LA LIMA'), false);
  assert.equal(frontendRequiresTicket('Trabajo en Zona Franca La Lima - edificio A'), false);
});

test('las excepciones configurables aceptan palabras y frases completas con límites de palabra', () => {
  const custom = ['Bodega Central', 'Inventario'];
  assert.equal(backendRequiresTicket('Revisión en Bodega Central', custom), false);
  assert.equal(backendRequiresTicket('Inventario de equipos', custom), false);
  assert.equal(backendRequiresTicket('Inventarios generales', custom), true);
  assert.equal(backendRequiresTicket('Oficina', custom), true, 'Una lista configurada sustituye la lista por defecto.');
});

test('la configuración se persiste en Configuracion y solo un administrador puede modificarla', () => {
  const service = source('backend/src/services/agenda-ticket-exceptions.service.js');
  const config = source('backend/src/modules/config.module.js');

  assert.match(service, /AGENDA_BOLETA_EXCEPCIONES/);
  assert.match(service, /JSON\.stringify/);
  assert.match(service, /Zona Franca La Lima/);
  assert.match(config, /AGENDA_TICKET_EXCEPTIONS/);
  assert.match(config, /USUARIOS_GESTIONAR/);
  assert.match(config, /ACTUALIZAR_EXCEPCIONES_BOLETA_AGENDA/);
});

test('Agenda usa las excepciones guardadas para RequiereBoleta, estado y asistente', () => {
  const agendaModule = source('backend/src/modules/agenda.module.js');
  const assistant = source('backend/src/modules/assistant-agenda.module.js');

  assert.match(agendaModule, /getAgendaTicketExceptions/);
  assert.match(agendaModule, /agendaRequiresTicket\(detail, ticketExceptions\)/);
  assert.match(agendaModule, /ticketExceptions,/);
  assert.match(assistant, /getAgendaTicketExceptions/);
  assert.match(assistant, /ticketExceptions,/);
});

test('la interfaz administrativa permite editar una excepción por línea y el editor usa la misma lista', () => {
  const settingsPage = source('src/pages/admin/NotificationSettingsPage.jsx');
  const settingsPanel = source('src/components/admin/AgendaTicketExceptionsSettings.jsx');
  const agendaPage = source('src/pages/agenda/AgendaPage.jsx');

  assert.match(settingsPage, /AgendaTicketExceptionsSettings/);
  assert.match(settingsPanel, /section: 'AGENDA_TICKET_EXCEPTIONS'/);
  assert.match(settingsPanel, /Palabras y frases de excepción/);
  assert.match(settingsPanel, /Zona Franca La Lima/);
  assert.match(settingsPanel, /no requerirán boleta ni recibirán el recordatorio de boleta faltante/);
  assert.match(agendaPage, /section: 'AGENDA_TICKET_EXCEPTIONS'/);
  assert.match(agendaPage, /agendaRequiresTicket\(draft\.detalle, ticketExceptions\)/);
});
