import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildAgendaRequestIndex,
  buildAgendaViews,
  resolveAgendaTicketMatches,
} from '../../backend/src/services/agenda-domain.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const agendaSource = fs.readFileSync(path.join(root, 'backend/src/modules/agenda.module.js'), 'utf8');
const optimizationSource = fs.readFileSync(path.join(root, 'backend/src/services/agenda-query-optimization.patch.js'), 'utf8');
const agendaPageSource = fs.readFileSync(path.join(root, 'src/pages/agenda/AgendaPage.jsx'), 'utf8');
const routerSource = fs.readFileSync(path.join(root, 'backend/src/core/action-router.js'), 'utf8');

function countMatches(source, expression) {
  return [...source.matchAll(expression)].length;
}

test('Etapa 4: Agenda conserva el alcance técnico y la vista administrativa del handler protegido', () => {
  assert.match(agendaSource, /function isAdmin\(ctx = \{\}\)/);
  assert.match(agendaSource, /visibleAgendaIdsForUser\(tables\.AgendaAsignados \|\| \[\], ctx\.user\?\.UsuarioID\)/);
  assert.match(agendaSource, /requestedUserId && isAdmin\(ctx\)/);
  assert.match(optimizationSource, /if \(!isAdmin\(ctx\)\) \{\s*const visibleIds = visibleAgendaIdsForUser/);
  assert.match(optimizationSource, /if \(requestedUserId && isAdmin\(ctx\)\)/);
});

test('Etapa 4: el matching conserva reservas globales de boleta antes de descartar por rango', () => {
  const agendas = [
    { AgendaID: 'A0', Fecha: '2026-09-13', FechaCreacion: '2026-09-13T08:00:00Z', Detalle: 'Preventivo', ClienteID: 'C1', ClienteNombre: 'Cliente Uno', Estado: 'ACTIVA' },
    { AgendaID: 'A1', Fecha: '2026-09-14', FechaCreacion: '2026-09-14T08:00:00Z', Detalle: 'Preventivo', ClienteID: 'C1', ClienteNombre: 'Cliente Uno', Estado: 'ACTIVA' },
  ];
  const agendaAssignments = [
    { AgendaID: 'A0', UsuarioID: 'U1', Activo: true },
    { AgendaID: 'A1', UsuarioID: 'U1', Activo: true },
  ];
  const users = [{ UsuarioID: 'U1', NombreCompleto: 'Técnico Uno' }];
  const tickets = [{ BoletaUID: 'B1', Fecha: '2026-09-13', ClienteID: 'C1', Cliente: 'Cliente Uno', Titulo: 'Preventivo', Estado: 'FINALIZADA', CreadoPor: 'U1' }];
  const ticketAssignments = [{ BoletaUID: 'B1', UsuarioID: 'U1', Activo: true }];
  const requestIndex = buildAgendaRequestIndex({ agendas, agendaAssignments, users, tickets, ticketAssignments });
  const matches = resolveAgendaTicketMatches({ agendas, agendaAssignments, users, tickets, ticketAssignments, requestIndex });

  assert.equal(matches.get('A0')?.BoletaUID, 'B1');
  assert.equal(matches.has('A1'), false);
  assert.match(optimizationSource, /resolveAgendaTicketMatches\(\{\s*agendas,/);
  assert.match(optimizationSource, /const candidates = filterAgendaCandidates\(agendas,/);
});

test('Etapa 4: fecha, usuario, búsqueda y orden mantienen el contrato histórico de Agenda', () => {
  assert.match(optimizationSource, /payload\.from \|\| payload\.desde \|\| payload\.fechaInicio/);
  assert.match(optimizationSource, /payload\.to \|\| payload\.hasta \|\| payload\.fechaFin/);
  assert.match(optimizationSource, /payload\.usuarioId \|\| payload\.userId \|\| payload\.UsuarioID/);
  assert.match(optimizationSource, /payload\.search \|\| payload\.q/);
  assert.match(optimizationSource, /left\.Fecha\.localeCompare\(right\.Fecha\)/);
  assert.match(optimizationSource, /left\.HoraInicio\.localeCompare\(right\.HoraInicio\)/);
  assert.match(optimizationSource, /left\.Detalle\.localeCompare\(right\.Detalle, 'es'\)/);
});

test('Etapa 4: el detalle conserva asignados, estado y boleta relacionada con una sola agenda', () => {
  const agenda = {
    AgendaID: 'A1',
    Fecha: '2026-09-14',
    HoraInicio: '07:00',
    HoraFin: '17:00',
    Detalle: 'Preventivo',
    ClienteID: 'C1',
    ClienteNombre: 'Cliente Uno',
    Estado: 'ACTIVA',
    BoletaUID: 'B1',
  };
  const views = buildAgendaViews({
    agendas: [agenda],
    agendaAssignments: [{ AgendaID: 'A1', UsuarioID: 'U1', Activo: true }],
    users: [{ UsuarioID: 'U1', NombreCompleto: 'Técnico Uno', NombreUsuario: 'tecnico1', Correo: 'tecnico@example.com' }],
    tickets: [{ BoletaUID: 'B1', Fecha: '2026-09-14', ClienteID: 'C1', Cliente: 'Cliente Uno', Titulo: 'Preventivo', Estado: 'FINALIZADA' }],
    ticketAssignments: [],
    today: '2026-09-14',
  });

  assert.equal(views.length, 1);
  assert.equal(views[0].AgendaID, 'A1');
  assert.equal(views[0].asignados[0].UsuarioID, 'U1');
  assert.equal(views[0].status, 'COMPLETA');
  assert.equal(views[0].boleta?.BoletaUID, 'B1');
});

test('Etapa 4: el frontend sigue consultando el rango mensual y conserva búsqueda local por detalle, cliente y persona', () => {
  assert.match(agendaPageSource, /const agendaPayload = useMemo\(\(\) => \(\{ from: range\.from, to: range\.to \}\), \[range\.from, range\.to\]\)/);
  assert.match(agendaPageSource, /requestSynchronizedCollection\(\s*AGENDA_LIST_ROUTE,\s*agendaPayload,\s*sessionToken,\s*\{ resource: 'agenda', userId, permissions \}/);
  assert.match(agendaPageSource, /normalizeAgendaText\(`\$\{item\.Detalle\} \$\{item\.ClienteNombre \|\| ''\} \$\{\(item\.asignados \|\| \[\]\)\.map\(personName\)\.join\(' '\)\}`\)/);
  assert.match(agendaPageSource, /requestSynchronizedDetail\(\s*AGENDA_DETAIL_ROUTE,\s*\{ agendaId: requestedAgendaId \},\s*sessionToken,\s*\{ resource: 'agenda', entityId: requestedAgendaId, userId, permissions \}/);
});

test('Etapa 4: los cuatro índices relacionados se construyen en una sola pasada por colección', () => {
  const counter = { agendaAssignments: 0, users: 0, tickets: 0, ticketAssignments: 0 };
  const agendaAssignments = [
    { AgendaID: 'A1', UsuarioID: 'U1', Activo: true },
    { AgendaID: 'A2', UsuarioID: 'U2', Activo: false },
    { AgendaID: 'A1', UsuarioID: 'U2', Activo: true },
  ];
  const users = [
    { UsuarioID: 'U1', NombreCompleto: 'Uno' },
    { UsuarioID: 'U2', NombreCompleto: 'Dos' },
  ];
  const tickets = [
    { BoletaUID: 'B1', Fecha: '2026-09-14', Estado: 'FINALIZADA' },
    { BoletaUID: 'B2', Fecha: '2026-09-14', Estado: 'ANULADA' },
  ];
  const ticketAssignments = [
    { BoletaUID: 'B1', UsuarioID: 'U1', Activo: true },
    { BoletaUID: 'B1', UsuarioID: 'U2', Activo: false },
  ];

  const index = buildAgendaRequestIndex({
    agendaAssignments: agendaAssignments.map((row) => { counter.agendaAssignments += 1; return row; }),
    users: users.map((row) => { counter.users += 1; return row; }),
    tickets: tickets.map((row) => { counter.tickets += 1; return row; }),
    ticketAssignments: ticketAssignments.map((row) => { counter.ticketAssignments += 1; return row; }),
  });

  assert.equal(counter.agendaAssignments, agendaAssignments.length);
  assert.equal(counter.users, users.length);
  assert.equal(counter.tickets, tickets.length);
  assert.equal(counter.ticketAssignments, ticketAssignments.length);
  assert.equal(index.agendaAssignmentsByAgendaId.get('A1')?.length, 2);
  assert.equal(index.ticketById.has('B1'), true);
  assert.equal(index.ticketById.has('B2'), false);
});

test('Etapa 4: list preserva autorización y matching de alcance completo antes de enriquecer candidatos', () => {
  const authorizationIndex = optimizationSource.indexOf('if (!isAdmin(ctx))');
  const indexBuild = optimizationSource.indexOf('const requestIndex = buildAgendaRequestIndex');
  const resolveMatches = optimizationSource.indexOf('const ticketMatches = resolveAgendaTicketMatches');
  const filterCandidates = optimizationSource.indexOf('const candidates = filterAgendaCandidates');
  const buildViews = optimizationSource.indexOf('const views = buildAgendaViews');
  assert.ok(authorizationIndex >= 0 && authorizationIndex < indexBuild);
  assert.ok(indexBuild < resolveMatches);
  assert.ok(resolveMatches < filterCandidates);
  assert.ok(filterCandidates < buildViews);
});

test('Etapa 4: agenda.get usa un bundle específico y evita tablas de boletas cuando no son necesarias', () => {
  assert.match(optimizationSource, /readTables\(\['Agendas', 'AgendaAsignados', 'Usuarios'\]\)/);
  assert.match(optimizationSource, /const hasExplicitTicket = Boolean\(clean\(agenda\.BoletaUID\)\)/);
  assert.match(optimizationSource, /if \(hasExplicitTicket \|\| canAutoMatchTicket\)/);
  assert.match(optimizationSource, /const names = canAutoMatchTicket \? \['Boletas', 'BoletaAsignados'\] : \['Boletas'\]/);
});

test('Etapa 4: boletas válidas heredadas sin UID siguen participando en el matching automático', () => {
  const source = fs.readFileSync(path.join(root, 'backend/src/services/agenda-domain.service.js'), 'utf8');
  assert.doesNotMatch(source, /if \(!ticketId\) continue;/);
  assert.match(source, /ticketById\.set\(ticketId, ticket\);/);
  assert.match(source, /if \(date\) appendMapArray\(ticketsByDate, date, ticket\);/);
});

test('Etapa 4: el parche se instala antes de que action-router capture agendaHandlers', () => {
  assert.match(routerSource, /import '\.\.\/services\/agenda-query-optimization\.patch\.js';/);
  assert.ok(
    routerSource.indexOf("import '../services/agenda-query-optimization.patch.js';")
      < routerSource.indexOf("import { agendaHandlers } from '../modules/agenda.module.js';"),
  );
});
