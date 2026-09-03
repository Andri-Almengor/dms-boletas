import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  agendaRequiresTicket as backendRequiresTicket,
  agendaTicketMatchScore,
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

// Cuando la Agenda tiene cliente, el ClienteID debe gobernar el vínculo heredado.
// El flujo nuevo guarda además Agenda.BoletaUID de forma explícita al crear la
// boleta desde el detalle, por lo que esta heurística queda como compatibilidad.
const clientAgendas = [
  { AgendaID: 'AC1', Fecha: '2026-09-02', Detalle: 'Mantenimiento preventivo', ClienteID: 'C1', ClienteNombre: 'Cliente Uno', Estado: 'ACTIVA' },
  { AgendaID: 'AC2', Fecha: '2026-09-02', Detalle: 'Mantenimiento preventivo', ClienteID: 'C2', ClienteNombre: 'Cliente Dos', Estado: 'ACTIVA' },
];
const clientAgendaAssignments = [
  { AgendaID: 'AC1', UsuarioID: 'U1', Activo: true },
  { AgendaID: 'AC2', UsuarioID: 'U1', Activo: true },
];
const clientTickets = [
  { BoletaUID: 'BC2', Fecha: '2026-09-02', ClienteID: 'C2', Cliente: 'Cliente Dos', Titulo: 'Mantenimiento preventivo', CreadoPor: 'U1' },
];
const clientMatches = resolveAgendaTicketMatches({
  agendas: clientAgendas,
  agendaAssignments: clientAgendaAssignments,
  tickets: clientTickets,
  ticketAssignments: [{ BoletaUID: 'BC2', UsuarioID: 'U1', Activo: true }],
});
assert.equal(clientMatches.has('AC1'), false, 'Una boleta de otro cliente no debe completar la agenda aunque comparta fecha, técnico y texto.');
assert.equal(clientMatches.get('AC2')?.BoletaUID, 'BC2', 'La boleta debe completar la agenda que comparte el mismo ClienteID.');
assert.ok(agendaTicketMatchScore(clientAgendas[1], clientTickets[0]) >= 1000);
assert.equal(agendaTicketMatchScore(clientAgendas[0], clientTickets[0]), 0);

const legacyMatches = resolveAgendaTicketMatches({
  agendas: [{ AgendaID: 'LEG1', Fecha: '2026-09-02', Detalle: 'Visita a Cirtec', Estado: 'ACTIVA' }],
  agendaAssignments: [{ AgendaID: 'LEG1', UsuarioID: 'U1', Activo: true }],
  tickets: [{ BoletaUID: 'LEG-B', Fecha: '2026-09-02', ClienteID: 'OTHER', Cliente: 'Otro cliente', Titulo: 'Revisión completamente distinta', CreadoPor: 'U1' }],
  ticketAssignments: [{ BoletaUID: 'LEG-B', UsuarioID: 'U1', Activo: true }],
});
assert.equal(legacyMatches.size, 0, 'Una agenda histórica sin cliente no debe enlazarse solo por fecha y técnico.');

const routerSource = fs.readFileSync(path.join(root, 'backend/src/core/action-router.js'), 'utf8');
const agendaModuleSource = fs.readFileSync(path.join(root, 'backend/src/modules/agenda.module.js'), 'utf8');
const agendaTicketServiceSource = fs.readFileSync(path.join(root, 'backend/src/services/agenda-ticket.service.js'), 'utf8');
const ticketMultiSource = fs.readFileSync(path.join(root, 'backend/src/modules/ticket-multi.module.js'), 'utf8');
const agendaSchemaSource = fs.readFileSync(path.join(root, 'backend/src/services/agenda-schema.service.js'), 'utf8');
const assistantSource = fs.readFileSync(path.join(root, 'backend/src/modules/assistant-agenda.module.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'src/app/App.jsx'), 'utf8');
const agendaPageSource = fs.readFileSync(path.join(root, 'src/pages/agenda/AgendaPage.jsx'), 'utf8');
const clientAssignmentSource = fs.readFileSync(path.join(root, 'src/pages/agenda/AgendaClientAssignment.jsx'), 'utf8');
const ticketFormSource = fs.readFileSync(path.join(root, 'src/pages/tickets/TicketFormPage.jsx'), 'utf8');
const agendaTicketContextSource = fs.readFileSync(path.join(root, 'src/features/agenda/useAgendaTicketContext.js'), 'utf8');
const ticketPersistenceSource = fs.readFileSync(path.join(root, 'src/features/tickets/ticketPersistenceService.js'), 'utf8');
const resendSource = fs.readFileSync(path.join(root, 'src/pages/agenda/AgendaResendActions.jsx'), 'utf8');
const resendCssSource = fs.readFileSync(path.join(root, 'src/styles/agenda-resend.css'), 'utf8');
const splitDialogSource = fs.readFileSync(path.join(root, 'src/pages/agenda/AgendaSplitDialog.jsx'), 'utf8');
const appsScriptPatchSource = fs.readFileSync(path.join(root, 'apps-script/patches/agenda-ticket-finalization-reminders-v7.9.patch'), 'utf8');

assert.match(routerSource, /agenda\.list/);
assert.match(routerSource, /agenda\.create/);
assert.match(routerSource, /agenda\.update/);
assert.match(agendaModuleSource, /agenda\.notification\.send/);
assert.match(agendaModuleSource, /USUARIOS_GESTIONAR/);
assert.match(agendaModuleSource, /reminderAlreadyConsumedForThisDay/);
assert.match(agendaModuleSource, /RecordatorioDia/);
assert.match(agendaSchemaSource, /RecordatorioDia/);
assert.match(agendaSchemaSource, /'ClienteID'/);
assert.match(agendaSchemaSource, /'ClienteNombre'/);
assert.match(assistantSource, /assistantDynamicMaintenanceQuestionHandlers/);
assert.match(assistantSource, /agendaResults/);
assert.match(appSource, /path="agenda"/);
assert.match(agendaPageSource, /Separar por persona/);
assert.match(agendaPageSource, /Puede agregar varias agendas con la misma fecha/);
assert.match(agendaPageSource, /AgendaClientAssignment/);
assert.doesNotMatch(agendaPageSource, /clients\.list/);
assert.doesNotMatch(agendaPageSource, /sortedClients/);
assert.doesNotMatch(agendaPageSource, /updateClient/);

// Invariante nueva: el detalle no administra el cliente. Abre el formulario
// real de boletas y mantiene la identidad de la agenda en el query string.
assert.match(clientAssignmentSource, /Crear boleta/);
assert.match(clientAssignmentSource, /\/boletas\/nueva\?agendaId=/);
assert.match(clientAssignmentSource, /Técnicos que quedarán asignados/);
assert.doesNotMatch(clientAssignmentSource, /DependentSelect/);
assert.doesNotMatch(clientAssignmentSource, /clients\.list/);
assert.doesNotMatch(clientAssignmentSource, /soloCliente/);

// El mismo TicketFormPage se reutiliza: no existe un segundo formulario de
// agenda. El borrador recibe una clave aislada y los técnicos quedan bloqueados
// a la asignación de AgendaAsignados.
assert.match(ticketFormSource, /useAgendaTicketContext/);
assert.match(ticketFormSource, /agenda-\$\{agendaId\}/);
assert.match(ticketFormSource, /disabled=\{saving \|\| Boolean\(agenda\?\.AgendaID\)\}/);
assert.match(agendaTicketContextSource, /apiRequest\('agenda\.get'/);
assert.match(agendaTicketContextSource, /AgendaID/);
assert.match(agendaTicketContextSource, /asignados/);
assert.match(ticketPersistenceSource, /workflowAction/);

// El endpoint histórico boletas.create se conserva. Solo cuando llega AgendaID
// se prepara el contexto y luego se vincula la boleta recién creada.
assert.match(ticketMultiSource, /prepareAgendaTicketCreation/);
assert.match(ticketMultiSource, /completeAgendaTicketCreation/);
assert.match(agendaTicketServiceSource, /USUARIOS_GESTIONAR/);
assert.match(agendaTicketServiceSource, /AgendaAsignados/);
assert.match(agendaTicketServiceSource, /BoletaUID/);
assert.match(agendaTicketServiceSource, /TICKET_CREATED_PENDING/);
assert.match(agendaTicketServiceSource, /agenda:ticket-created:/);

// El Apps Script suministrado por operación se mantiene como fuente del correo
// de agenda. El parche V7.9 conserva el trigger de las 17:00 y cambia la regla
// de cumplimiento para exigir Estado FINALIZADA.
assert.match(appsScriptPatchSource, /TICKET_CREATED_PENDING/);
assert.match(appsScriptPatchSource, /Boleta no finalizada/);
assert.match(appsScriptPatchSource, /no fue finalizada antes de las 5:00 p\. m\./);
assert.match(appsScriptPatchSource, /normalizeAgendaText_\(matched\.Estado\) === 'finalizada'/);
assert.match(appsScriptPatchSource, /ticketsById = indexBy_\(allValidTickets/);

assert.match(resendSource, /Notificaciones y pruebas/);
assert.match(resendCssSource, /agenda-client-panel/);
assert.match(resendCssSource, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
assert.match(resendCssSource, /@media\(max-width:560px\)/);
assert.match(splitDialogSource, /agenda\.create/);
assert.match(splitDialogSource, /agenda\.update/);
assert.match(splitDialogSource, /agendaOrigenId/);
assert.match(splitDialogSource, /clienteId/);
assert.match(splitDialogSource, /ClienteNombre/);

console.log('✓ agenda operativa: creación de boleta desde detalle, técnicos heredados, vínculo explícito y recordatorio de finalización a las 17:00');
