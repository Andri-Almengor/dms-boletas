import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildAgendaViews,
  resolveAgendaTicketMatches,
} from '../../backend/src/services/agenda-domain.service.js';

const agendaModuleSource = readFileSync(new URL('../../backend/src/modules/agenda.module.js', import.meta.url), 'utf8');
const agendaPageSource = readFileSync(new URL('../../src/pages/agenda/AgendaPage.jsx', import.meta.url), 'utf8');

function functionSource(name, nextName) {
  const start = agendaModuleSource.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `No se encontró ${name} en agenda.module.js`);
  const end = nextName
    ? agendaModuleSource.indexOf(`\nasync function ${nextName}(`, start)
    : agendaModuleSource.indexOf('\nexport const agendaHandlers', start);
  assert.notEqual(end, -1, `No se encontró el final de ${name}`);
  return agendaModuleSource.slice(start, end);
}

test('Etapa 4: Agenda conserva el alcance técnico y la vista administrativa antes de devolver resultados', () => {
  const listSource = functionSource('list', 'get');
  const getSource = functionSource('get', 'create');

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
