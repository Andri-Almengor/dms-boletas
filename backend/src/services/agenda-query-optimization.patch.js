import { badRequest, forbidden, notFound } from '../core/errors.js';
import { readTables } from '../infra/sheets.repository.js';
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

async function list(ctx) {
  await ensureAgendaSchema();
  const [tables, ticketExceptions] = await Promise.all([
    readTables(['Agendas', 'AgendaAsignados', 'Usuarios', 'Boletas', 'BoletaAsignados']),
    getAgendaTicketExceptions(),
  ]);
  let agendas = tables.Agendas || [];

  // Autorización/alcance antes de cualquier índice de optimización, usando la
  // misma semántica exacta del handler protegido por Etapa 0.
  if (!isAdmin(ctx)) {
    const visibleIds = visibleAgendaIdsForUser(tables.AgendaAsignados || [], ctx.user?.UsuarioID);
    agendas = agendas.filter((agenda) => visibleIds.has(clean(agenda.AgendaID)));
  }

  const requestIndex = buildAgendaRequestIndex({
    agendas,
    agendaAssignments: tables.AgendaAsignados || [],
    users: tables.Usuarios || [],
    tickets: tables.Boletas || [],
    ticketAssignments: tables.BoletaAsignados || [],
  });

  // El matching conserva el alcance visible histórico completo antes de aplicar
  // filtros. Una agenda fuera del rango puede reservar una boleta explícita o
  // heurísticamente y no debe alterar qué boleta recibe otra agenda.
  const ticketMatches = resolveAgendaTicketMatches({
    agendas,
    agendaAssignments: tables.AgendaAsignados || [],
    users: tables.Usuarios || [],
    tickets: tables.Boletas || [],
    ticketAssignments: tables.BoletaAsignados || [],
    ticketExceptions,
    requestIndex,
  });
  const candidates = filterAgendaCandidates(agendas, ctx.payload || {}, ctx, requestIndex);
  const views = buildAgendaViews({
    agendas: candidates,
    agendaAssignments: tables.AgendaAsignados || [],
    users: tables.Usuarios || [],
    tickets: tables.Boletas || [],
    ticketAssignments: tables.BoletaAsignados || [],
    ticketExceptions,
    requestIndex,
    ticketMatches,
  });

  // Verificación final barata con el filtro histórico exacto. Evita que una
  // futura diferencia de normalización cambie los resultados visibles.
  const items = filterViews(views, ctx.payload || {}, ctx);
  return { items, total: items.length };
}

async function get(ctx) {
  const agendaId = clean(ctx.payload?.agendaId || ctx.payload?.AgendaID || ctx.payload?.id);
  if (!agendaId) throw badRequest('Debe indicar la agenda.');
  await ensureAgendaSchema();

  const [baseTables, ticketExceptions] = await Promise.all([
    readTables(['Agendas', 'AgendaAsignados', 'Usuarios']),
    getAgendaTicketExceptions(),
  ]);
  const agenda = (baseTables.Agendas || []).find((row) => clean(row.AgendaID) === agendaId);
  if (!agenda) throw notFound('No se encontró la agenda solicitada.');

  if (!isAdmin(ctx)) {
    const assigned = assignmentIds(baseTables.AgendaAsignados || [], agendaId);
    if (!assigned.includes(clean(ctx.user?.UsuarioID))) throw forbidden();
  }

  const hasExplicitTicket = Boolean(clean(agenda.BoletaUID));
  const canAutoMatchTicket = normalizeAgendaText(agenda.Estado) !== 'cancelada'
    && agendaRequiresTicket(agenda.Detalle, ticketExceptions);
  let ticketTables = { Boletas: [], BoletaAsignados: [] };
  if (hasExplicitTicket || canAutoMatchTicket) {
    const names = canAutoMatchTicket ? ['Boletas', 'BoletaAsignados'] : ['Boletas'];
    ticketTables = await readTables(names);
  }

  const requestIndex = buildAgendaRequestIndex({
    agendas: [agenda],
    agendaAssignments: baseTables.AgendaAsignados || [],
    users: baseTables.Usuarios || [],
    tickets: ticketTables.Boletas || [],
    ticketAssignments: ticketTables.BoletaAsignados || [],
  });
  const item = buildAgendaViews({
    agendas: [agenda],
    agendaAssignments: baseTables.AgendaAsignados || [],
    users: baseTables.Usuarios || [],
    tickets: ticketTables.Boletas || [],
    ticketAssignments: ticketTables.BoletaAsignados || [],
    ticketExceptions,
    requestIndex,
  })[0];
  return { item };
}

agendaHandlers.list = list;
agendaHandlers.get = get;
