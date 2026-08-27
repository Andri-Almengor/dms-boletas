import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  agendaRequiresTicket as backendRequiresTicket,
  buildAgendaViews,
  resolveAgendaTicketMatches,
} from '../../backend/src/services/agenda-domain.service.js';
import {
  agendaRequiresTicket as frontendRequiresTicket,
  calendarDays,
  calendarMonthRange,
} from '../../src/features/agenda/agendaDomain.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

assert.equal(backendRequiresTicket('Oficina'), false);
assert.equal(backendRequiresTicket('Trabajo en OFICINA CENTRAL'), false);
assert.equal(backendRequiresTicket('RN'), false);
assert.equal(backendRequiresTicket('Apoyo rn durante la mañana'), false);
assert.equal(backendRequiresTicket('Visita a Asamblea'), true);
assert.equal(backendRequiresTicket('Revisión RNX'), true);
assert.equal(frontendRequiresTicket('oficina'), false);
assert.equal(frontendRequiresTicket('RN'), false);
assert.equal(frontendRequiresTicket('Mantenimiento de cámaras'), true);

const range = calendarMonthRange('2026-08');
assert.deepEqual(range, { from: '2026-07-27', to: '2026-09-06' });
assert.equal(calendarDays('2026-08').length, 42);

const agendas = [
  {
    AgendaID: 'A1',
    Fecha: '2026-08-28',
    HoraInicio: '07:00',
    HoraFin: '12:00',
    Detalle: 'Asamblea mantenimiento preventivo',
    Estado: 'ACTIVA',
  },
  {
    AgendaID: 'A2',
    Fecha: '2026-08-28',
    HoraInicio: '13:00',
    HoraFin: '17:00',
    Detalle: 'Asamblea revisión adicional',
    Estado: 'ACTIVA',
  },
];
const agendaAssignments = [
  { AgendaAsignadoID: 'AA1', AgendaID: 'A1', UsuarioID: 'U1', Activo: true },
  { AgendaAsignadoID: 'AA2', AgendaID: 'A2', UsuarioID: 'U1', Activo: true },
];
const tickets = [
  {
    BoletaUID: 'B1',
    BoletaNumero: '1001',
    Fecha: '2026-08-28',
    Titulo: 'Mantenimiento Asamblea',
    RazonVisita: 'Mantenimiento preventivo',
    CreadoPor: 'U1',
    Estado: 'FINALIZADA',
  },
];
const ticketAssignments = [
  { BoletaAsignadoID: 'BA1', BoletaUID: 'B1', UsuarioID: 'U1', Activo: true },
];

const matches = resolveAgendaTicketMatches({ agendas, agendaAssignments, tickets, ticketAssignments });
assert.equal(matches.size, 1, 'Una sola boleta no debe completar dos agendas del mismo día.');
assert.equal(matches.get('A1')?.BoletaUID, 'B1');
assert.equal(matches.has('A2'), false);

const views = buildAgendaViews({
  agendas,
  agendaAssignments,
  users: [{ UsuarioID: 'U1', NombreCompleto: 'Técnico Uno', Correo: 'tecnico@example.com' }],
  tickets,
  ticketAssignments,
  today: '2026-08-28',
});
assert.equal(views.filter((item) => item.status === 'COMPLETA').length, 1);
assert.equal(views.filter((item) => item.status === 'PENDIENTE').length, 1);

const routerSource = fs.readFileSync(path.join(root, 'backend/src/core/action-router.js'), 'utf8');
const agendaModuleSource = fs.readFileSync(path.join(root, 'backend/src/modules/agenda.module.js'), 'utf8');
const agendaSchemaSource = fs.readFileSync(path.join(root, 'backend/src/services/agenda-schema.service.js'), 'utf8');
const assistantSource = fs.readFileSync(path.join(root, 'backend/src/modules/assistant-agenda.module.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'src/app/App.jsx'), 'utf8');
const agendaPageSource = fs.readFileSync(path.join(root, 'src/pages/agenda/AgendaPage.jsx'), 'utf8');
const splitDialogSource = fs.readFileSync(path.join(root, 'src/pages/agenda/AgendaSplitDialog.jsx'), 'utf8');

assert.match(routerSource, /agenda\.list/);
assert.match(routerSource, /agenda\.create/);
assert.match(routerSource, /agenda\.update/);
assert.match(agendaModuleSource, /agenda\.notification\.send/);
assert.match(agendaModuleSource, /USUARIOS_GESTIONAR/);
assert.match(agendaModuleSource, /reminderAlreadyConsumedForThisDay/);
assert.match(agendaModuleSource, /RecordatorioDia/);
assert.match(agendaSchemaSource, /RecordatorioDia/);
assert.match(assistantSource, /assistantDynamicMaintenanceQuestionHandlers/);
assert.match(assistantSource, /agendaResults/);
assert.match(appSource, /path="agenda"/);
assert.match(agendaPageSource, /Separar por persona/);
assert.match(agendaPageSource, /Puede agregar varias agendas con la misma fecha/);
assert.match(splitDialogSource, /agenda\.create/);
assert.match(splitDialogSource, /agenda\.update/);
assert.match(splitDialogSource, /agendaOrigenId/);

console.log('✓ agenda operativa: exclusiones, calendario, vínculo 1:1, separación rápida, recordatorio diario, rutas y asistente');
