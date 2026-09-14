import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildAgendaRequestIndex,
  buildAgendaViews,
  resolveAgendaTicketMatches,
} from '../../backend/src/services/agenda-domain.service.js';

const agendaModuleSource = readFileSync(new URL('../../backend/src/modules/agenda.module.js', import.meta.url), 'utf8');
const agendaPatchSource = readFileSync(new URL('../../backend/src/services/agenda-query-optimization.patch.js', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../../backend/src/app.js', import.meta.url), 'utf8');
const agendaPageSource = readFileSync(new URL('../../src/pages/agenda/AgendaPage.jsx', import.meta.url), 'utf8');

function functionSource(source, name, nextName, finalMarker = '\nexport const agendaHandlers') {
  const start = source.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `No se encontró ${name}`);
  const end = nextName
    ? source.indexOf(`\nasync function ${nextName}(`, start)
    : source.indexOf(finalMarker, start);
  assert.notEqual(end, -1, `No se encontró el final de ${name}`);
  return source.slice(start, end);
}

function counted(values, counter, key) {
  return {
    *[Symbol.iterator]() {
      for (const value of values) {
        counter[key] += 1;
        yield value;
      }
    },
  };
}

test('Etapa 4: Agenda conserva el alcance técnico y la vista administrativa del handler protegido', () => {
  const listSource = functionSource(agendaModuleSource, 'list', 'get');
  const getSource = functionSource(agendaModuleSource, 'get', 'create');

  assert.match(agendaModuleSource, /permissions\.includes\('USUARIOS_GESTIONAR'\)/);
  assert.match(listSource, /if \(!isAdmin\(ctx\)\)/);
  assert.match(listSource, /visibleAgendaIdsForUser/);
  assert.match(listSource, /ctx\.user\?\.UsuarioID/);
  assert.match(getSource, /if \(!isAdmin\(ctx\)\)/);
  assert.match(getSource, /assignmentIds/);
  assert.match(getSource, /throw forbidden\(\)/);
});

test('Etapa 4: el matching conserva reservas globales de boleta antes de descartar por rango', () => {
  const agendas = [
    {
      AgendaID: 'OUTSIDE',
      Fecha: '2026-08-01',
      Detalle: 'Visita histórica',
      BoletaUID: 'B1',
      Estado: 'ACTIVA',
      FechaCreacion: '2026-08-01T08:00:00.000Z',
    },
    {
      AgendaID: 'VISIBLE',
      Fecha: '2026-09-14',
      Detalle: 'Mantenimiento preventivo cámaras Cliente Uno',
      ClienteID: 'C1',
      ClienteNombre: 'Cliente Uno',
      Estado: 'ACTIVA',
      FechaCreacion: '2026-09-01T08:00:00.000Z',
    },
  ];
  const assignments = [
    { AgendaID: 'OUTSIDE', UsuarioID: 'U1', Activo: true },
    { AgendaID: 'VISIBLE', UsuarioID: 'U1', Activo: true },
  ];
  const tickets = [{
    BoletaUID: 'B1',
    Fecha: '2026-09-14',
    ClienteID: 'C1',
    Cliente: 'Cliente Uno',
    Titulo: 'Mantenimiento preventivo cámaras',
    CreadoPor: 'U1',
    Estado: 'FINALIZADA',
  }];
  const ticketAssignments = [{ BoletaUID: 'B1', UsuarioID: 'U1', Activo: true }];

  const matches = resolveAgendaTicketMatches({ agendas, agendaAssignments: assignments, tickets, ticketAssignments });
  assert.equal(matches.get('OUTSIDE')?.BoletaUID, 'B1');
  assert.equal(matches.has('VISIBLE'), false, 'Una agenda fuera del rango puede conservar una relación explícita y reservar esa boleta.');
});

test('Etapa 4: fecha, usuario, búsqueda y orden mantienen el contrato histórico de Agenda', () => {
  assert.match(agendaModuleSource, /const from = clean\(payload\.from \|\| payload\.desde \|\| payload\.fechaInicio\)/);
  assert.match(agendaModuleSource, /const to = clean\(payload\.to \|\| payload\.hasta \|\| payload\.fechaFin\)/);
  assert.match(agendaModuleSource, /payload\.usuarioId \|\| payload\.userId \|\| payload\.UsuarioID/);
  assert.match(agendaModuleSource, /item\.Detalle/);
  assert.match(agendaModuleSource, /item\.ClienteNombre/);
  assert.match(agendaModuleSource, /item\.Fecha/);
  assert.match(agendaModuleSource, /item\.asignados\.map/);
  assert.match(agendaModuleSource, /left\.Fecha\.localeCompare\(right\.Fecha\)/);
  assert.match(agendaModuleSource, /left\.HoraInicio\.localeCompare\(right\.HoraInicio\)/);
});

test('Etapa 4: el detalle conserva asignados, estado y boleta relacionada con una sola agenda', () => {
  const agenda = {
    AgendaID: 'A1',
    Fecha: '2026-09-14',
    HoraInicio: '07:00',
    HoraFin: '09:00',
    Detalle: 'Cliente Uno mantenimiento preventivo',
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
  assert.match(agendaPageSource, /apiRequest\('agenda\.list', \{ from: range\.from, to: range\.to \}/);
  assert.match(agendaPageSource, /normalizeAgendaText\(`\$\{item\.Detalle\} \$\{item\.ClienteNombre \|\| ''\} \$\{\(item\.asignados \|\| \[\]\)\.map\(personName\)\.join\(' '\)\}`\)/);
  assert.match(agendaPageSource, /apiRequest\('agenda\.get', \{ agendaId: requestedAgendaId \}/);
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
    agendaAssignments: counted(agendaAssignments, counter, 'agendaAssignments'),
    users: counted(users, counter, 'users'),
    tickets: counted(tickets, counter, 'tickets'),
    ticketAssignments: counted(ticketAssignments, counter, 'ticketAssignments'),
  });

  assert.deepEqual(counter, {
    agendaAssignments: agendaAssignments.length,
    users: users.length,
    tickets: tickets.length,
    ticketAssignments: ticketAssignments.length,
  });
  assert.equal(index.agendaAssignmentsByAgendaId.get('A1').length, 2);
  assert.equal(index.userById.get('U2').NombreCompleto, 'Dos');
  assert.equal(index.ticketById.get('B1').BoletaUID, 'B1');
  assert.equal(index.ticketById.has('B2'), false);
  assert.deepEqual([...index.ticketAssignmentsByTicketId.get('B1')], ['U1']);
});

test('Etapa 4: list preserva autorización y matching de alcance completo antes de enriquecer candidatos', () => {
  const source = functionSource(agendaPatchSource, 'list', 'get');
  const permissionAt = source.indexOf('if (!isAdmin(ctx))');
  const indexAt = source.indexOf('buildAgendaRequestIndex(');
  const matchAt = source.indexOf('resolveAgendaTicketMatches(');
  const candidateAt = source.indexOf('filterAgendaCandidates(');
  const viewAt = source.indexOf('buildAgendaViews(');

  assert.ok(permissionAt >= 0 && indexAt > permissionAt, 'El alcance autorizado debe resolverse antes de construir índices de optimización.');
  assert.ok(matchAt > indexAt, 'El índice de request debe existir antes del matching.');
  assert.ok(candidateAt > matchAt, 'El matching histórico debe conservarse antes de descartar agendas por filtros.');
  assert.ok(viewAt > candidateAt, 'Las vistas completas solo deben construirse para candidatos filtrados.');
  assert.match(source, /requestIndex,/);
  assert.match(source, /ticketMatches,/);
  assert.match(source, /const items = filterViews\(views, ctx\.payload \|\| \{\}, ctx\)/);
});

test('Etapa 4: agenda.get usa un bundle específico y evita tablas de boletas cuando no son necesarias', () => {
  const source = functionSource(agendaPatchSource, 'get', null, '\nagendaHandlers.list = list;');
  assert.doesNotMatch(source, /agendaTables\(\)/);
  assert.match(source, /readTables\(\['Agendas', 'AgendaAsignados', 'Usuarios'\]\)/);
  assert.match(source, /hasExplicitTicket/);
  assert.match(source, /canAutoMatchTicket/);
  assert.match(source, /if \(hasExplicitTicket \|\| canAutoMatchTicket\)/);
  assert.match(source, /const names = canAutoMatchTicket \? \['Boletas', 'BoletaAsignados'\] : \['Boletas'\]/);
});

test('Etapa 4: boletas válidas heredadas sin UID siguen participando en el matching automático', () => {
  const ticket = {
    BoletaUID: '',
    Fecha: '2026-09-14',
    Titulo: 'Cliente Uno mantenimiento preventivo',
    CreadoPor: 'U1',
    Estado: 'PENDIENTE',
  };
  const matches = resolveAgendaTicketMatches({
    agendas: [{ AgendaID: 'A1', Fecha: '2026-09-14', Detalle: 'Cliente Uno mantenimiento preventivo', Estado: 'ACTIVA' }],
    agendaAssignments: [{ AgendaID: 'A1', UsuarioID: 'U1', Activo: true }],
    tickets: [ticket],
    ticketAssignments: [],
  });
  assert.equal(matches.get('A1'), ticket);
});

test('Etapa 4: el parche se instala antes de que action-router capture agendaHandlers', () => {
  const patchImport = appSource.indexOf("import './services/agenda-query-optimization.patch.js';");
  const routerImport = appSource.indexOf("import { dispatchAction } from './core/action-router.js';");
  assert.ok(patchImport >= 0, 'app.js debe instalar el parche de Agenda.');
  assert.ok(routerImport > patchImport, 'El parche debe cargarse antes de importar action-router.');
  assert.match(agendaPatchSource, /agendaHandlers\.list = list;/);
  assert.match(agendaPatchSource, /agendaHandlers\.get = get;/);
});
