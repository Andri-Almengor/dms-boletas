import { badRequest, forbidden, notFound } from '../core/errors.js';
import { findRows, queryAgendaTickets, readTable } from '../infra/sheets.repository.js';
import { agendaHandlers } from '../modules/agenda.module.js';
import {
  agendaDate,
  agendaRequiresTicket,
  buildAgendaRequestIndex,
  buildAgendaViews,
  normalizeAgendaText,
  resolveAgendaTicketMatches,
} from './agenda-domain.service.js';
import { ensureAgendaSchema } from './agenda-schema.service.js';
import { getAgendaTicketExceptions } from './agenda-ticket-exceptions.service.js';

function clean(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function isAdmin(ctx = {}) {
  return Array.isArray(ctx.permissions) && ctx.permissions.includes('USUARIOS_GESTIONAR');
}

function normalizeDate(value) {
  const date = agendaDate(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest('La fecha de la agenda no es válida.');
  return date;
}

// Debe conservar exactamente la semántica histórica de agenda.module.js para
// visibilidad/permisos. No se reutiliza activeAgendaAssignment porque esa
// normalización considera estados adicionales inactivos.
function activeAssignment(row = {}) {
  const enabled = normalizeAgendaText(row.Activo ?? 'true');
  return !['false', '0', 'no', 'inactivo'].includes(enabled) && !clean(row.FechaDesasignacion);
}

function assignmentIds(rows, agendaId) {
  return rows
    .filter((row) => activeAssignment(row) && clean(row.AgendaID) === clean(agendaId))
    .map((row) => clean(row.UsuarioID))
    .filter(Boolean);
}

function visibleAgendaIdsForUser(assignments, userId) {
  return new Set(assignments
    .filter((row) => activeAssignment(row) && clean(row.UsuarioID) === clean(userId))
    .map((row) => clean(row.AgendaID))
    .filter(Boolean));
}

function filterViews(views, payload = {}, ctx = {}) {
  let result = [...views];
  const from = clean(payload.from || payload.desde || payload.fechaInicio);
  const to = clean(payload.to || payload.hasta || payload.fechaFin);
  const search = normalizeAgendaText(payload.search || payload.q);
  const requestedUserId = clean(payload.usuarioId || payload.userId || payload.UsuarioID);

  if (from) result = result.filter((item) => item.Fecha >= normalizeDate(from));
  if (to) result = result.filter((item) => item.Fecha <= normalizeDate(to));
  if (requestedUserId && isAdmin(ctx)) {
    result = result.filter((item) => item.asignados.some((user) => clean(user.UsuarioID) === requestedUserId));
  }
  if (search) {
    result = result.filter((item) => normalizeAgendaText([
      item.Detalle,
      item.ClienteNombre,
      item.Fecha,
      ...item.asignados.map((user) => `${user.NombreCompleto} ${user.NombreUsuario} ${user.Correo}`),
    ].join(' ')).includes(search));
  }

  result.sort((left, right) => (
    left.Fecha.localeCompare(right.Fecha)
    || left.HoraInicio.localeCompare(right.HoraInicio)
    || left.Detalle.localeCompare(right.Detalle, 'es')
  ));
  return result;
}

function searchableAgendaUsers(requestIndex, agendaId) {
  return (requestIndex.agendaAssignmentsByAgendaId.get(clean(agendaId)) || [])
    .map((row) => requestIndex.userById.get(clean(row.UsuarioID)))
    .filter(Boolean);
}

function filterAgendaCandidates(agendas, payload = {}, ctx = {}, requestIndex) {
  let result = [...agendas];
  const from = clean(payload.from || payload.desde || payload.fechaInicio);
  const to = clean(payload.to || payload.hasta || payload.fechaFin);
  const search = normalizeAgendaText(payload.search || payload.q);
  const requestedUserId = clean(payload.usuarioId || payload.userId || payload.UsuarioID);

  // La normalización se difiere hasta saber que existen filas por filtrar para
  // preservar el comportamiento histórico de filterViews ante conjuntos vacíos.
  if (from && result.length) {
    const normalizedFrom = normalizeDate(from);
    result = result.filter((agenda) => agendaDate(agenda.Fecha) >= normalizedFrom);
  }
  if (to && result.length) {
    const normalizedTo = normalizeDate(to);
    result = result.filter((agenda) => agendaDate(agenda.Fecha) <= normalizedTo);
  }
  if (requestedUserId && isAdmin(ctx)) {
    result = result.filter((agenda) => searchableAgendaUsers(requestIndex, agenda.AgendaID)
      .some((user) => clean(user.UsuarioID) === requestedUserId));
  }
  if (search) {
    result = result.filter((agenda) => {
      const users = searchableAgendaUsers(requestIndex, agenda.AgendaID);
      return normalizeAgendaText([
        clean(agenda.Detalle),
        clean(agenda.ClienteNombre),
        agendaDate(agenda.Fecha),
        ...users.map((user) => `${clean(user.NombreCompleto || user.Nombre || user.NombreUsuario || user.Correo)} ${clean(user.NombreUsuario)} ${clean(user.Correo)}`),
      ].join(' ')).includes(search);
    });
  }

  result.sort((left, right) => (
    agendaDate(left.Fecha).localeCompare(agendaDate(right.Fecha))
    || clean(left.HoraInicio, '07:00').localeCompare(clean(right.HoraInicio, '07:00'))
    || clean(left.Detalle).localeCompare(clean(right.Detalle), 'es')
  ));
  return result;
}

async function agendaSupportRows(agendas = []) {
  const agendaIds = agendas.map((row) => clean(row.AgendaID)).filter(Boolean);
  const agendaAssignments = agendaIds.length
    ? await findRows('AgendaAsignados', { AgendaID: agendaIds }, { limit: 50_000 })
    : [];
  const userIds = [...new Set(agendaAssignments.map((row) => clean(row.UsuarioID)).filter(Boolean))];
  const users = userIds.length
    ? await findRows('Usuarios', { UsuarioID: userIds }, { limit: 50_000 })
    : [];

  const dates = [...new Set(agendas.map((agenda) => agendaDate(agenda.Fecha)).filter(Boolean))];
  const explicitTicketIds = [...new Set(agendas.map((agenda) => clean(agenda.BoletaUID)).filter(Boolean))];
  const tickets = await queryAgendaTickets({ dates, ticketIds: explicitTicketIds });
  const ticketIds = tickets.map((row) => clean(row.BoletaUID)).filter(Boolean);
  const ticketAssignments = ticketIds.length
    ? await findRows('BoletaAsignados', { BoletaUID: ticketIds }, { limit: 50_000 })
    : [];

  return { Agendas: agendas, AgendaAsignados: agendaAssignments, Usuarios: users, Boletas: tickets, BoletaAsignados: ticketAssignments };
}

async function visibleAgendas(ctx) {
  if (isAdmin(ctx)) return readTable('Agendas');
  const assignments = await findRows('AgendaAsignados', { UsuarioID: clean(ctx.user?.UsuarioID) }, { limit: 50_000 });
  const visibleIds = visibleAgendaIdsForUser(assignments, ctx.user?.UsuarioID);
  if (!visibleIds.size) return [];
  return findRows('Agendas', { AgendaID: [...visibleIds] }, { limit: 50_000 });
}

async function list(ctx) {
  await ensureAgendaSchema();
  const [agendas, ticketExceptions] = await Promise.all([
    visibleAgendas(ctx),
    getAgendaTicketExceptions(),
  ]);
  const tables = await agendaSupportRows(agendas);

  const requestIndex = buildAgendaRequestIndex({
    agendas,
    agendaAssignments: tables.AgendaAsignados,
    users: tables.Usuarios,
    tickets: tables.Boletas,
    ticketAssignments: tables.BoletaAsignados,
  });
  const ticketMatches = resolveAgendaTicketMatches({
    agendas,
    agendaAssignments: tables.AgendaAsignados,
    users: tables.Usuarios,
    tickets: tables.Boletas,
    ticketAssignments: tables.BoletaAsignados,
    ticketExceptions,
    requestIndex,
  });
  const candidates = filterAgendaCandidates(agendas, ctx.payload || {}, ctx, requestIndex);
  const views = buildAgendaViews({
    agendas: candidates,
    agendaAssignments: tables.AgendaAsignados,
    users: tables.Usuarios,
    tickets: tables.Boletas,
    ticketAssignments: tables.BoletaAsignados,
    ticketExceptions,
    requestIndex,
    ticketMatches,
  });
  const items = filterViews(views, ctx.payload || {}, ctx);
  return { items, total: items.length };
}

async function get(ctx) {
  const agendaId = clean(ctx.payload?.agendaId || ctx.payload?.AgendaID || ctx.payload?.id);
  if (!agendaId) throw badRequest('Debe indicar la agenda.');
  await ensureAgendaSchema();

  const [agenda, ticketExceptions] = await Promise.all([
    findRows('Agendas', { AgendaID: agendaId }, { limit: 2 }).then((rows) => rows[0] || null),
    getAgendaTicketExceptions(),
  ]);
  if (!agenda) throw notFound('No se encontró la agenda solicitada.');

  const assignments = await findRows('AgendaAsignados', { AgendaID: agendaId }, { limit: 50_000 });
  if (!isAdmin(ctx)) {
    const assigned = assignmentIds(assignments, agendaId);
    if (!assigned.includes(clean(ctx.user?.UsuarioID))) throw forbidden();
  }
  const userIds = [...new Set(assignments.map((row) => clean(row.UsuarioID)).filter(Boolean))];
  const users = userIds.length ? await findRows('Usuarios', { UsuarioID: userIds }, { limit: 50_000 }) : [];

  const hasExplicitTicket = Boolean(clean(agenda.BoletaUID));
  const canAutoMatchTicket = normalizeAgendaText(agenda.Estado) !== 'cancelada'
    && agendaRequiresTicket(agenda.Detalle, ticketExceptions);
  let tickets = [];
  let ticketAssignments = [];
  if (hasExplicitTicket || canAutoMatchTicket) {
    tickets = await queryAgendaTickets({
      dates: canAutoMatchTicket ? [agendaDate(agenda.Fecha)] : [],
      ticketIds: hasExplicitTicket ? [clean(agenda.BoletaUID)] : [],
    });
    const ticketIds = tickets.map((row) => clean(row.BoletaUID)).filter(Boolean);
    if (ticketIds.length) ticketAssignments = await findRows('BoletaAsignados', { BoletaUID: ticketIds }, { limit: 50_000 });
  }

  const requestIndex = buildAgendaRequestIndex({
    agendas: [agenda],
    agendaAssignments: assignments,
    users,
    tickets,
    ticketAssignments,
  });
  const item = buildAgendaViews({
    agendas: [agenda],
    agendaAssignments: assignments,
    users,
    tickets,
    ticketAssignments,
    ticketExceptions,
    requestIndex,
  })[0];
  return { item };
}

agendaHandlers.list = list;
agendaHandlers.get = get;
