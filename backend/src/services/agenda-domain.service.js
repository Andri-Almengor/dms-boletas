function clean(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

export const DEFAULT_AGENDA_TICKET_EXCEPTIONS = Object.freeze([
  'Oficina',
  'Oficinas',
  'Office',
  'RN',
  'Zona Franca La Lima',
]);

export function normalizeAgendaText(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeAgendaTicketExceptions(exceptions = DEFAULT_AGENDA_TICKET_EXCEPTIONS) {
  const source = Array.isArray(exceptions) ? exceptions : [exceptions];
  const used = new Set();
  return source
    .map((item) => normalizeAgendaText(item))
    .filter((item) => {
      if (!item || used.has(item)) return false;
      used.add(item);
      return true;
    });
}

export function agendaMatchesTicketException(detail, exceptions = DEFAULT_AGENDA_TICKET_EXCEPTIONS) {
  const text = normalizeAgendaText(detail);
  if (!text) return false;
  return normalizeAgendaTicketExceptions(exceptions).some((exception) => (
    text === exception
    || text.startsWith(`${exception} `)
    || text.endsWith(` ${exception}`)
    || text.includes(` ${exception} `)
  ));
}

function enabled(value, fallback = true) {
  const text = normalizeAgendaText(value);
  if (!text) return fallback;
  return !['false', '0', 'no', 'inactivo', 'cancelada', 'cancelado'].includes(text);
}

export function agendaRequiresTicket(detail, exceptions = DEFAULT_AGENDA_TICKET_EXCEPTIONS) {
  if (!normalizeAgendaText(detail)) return true;
  return !agendaMatchesTicketException(detail, exceptions);
}

export function agendaDate(value) {
  const text = clean(value);
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

export function costaRicaDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Costa_Rica',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

export function activeAgendaAssignment(row = {}) {
  return enabled(row.Activo, true) && !clean(row.FechaDesasignacion);
}

export function activeTicketAssignment(row = {}) {
  return enabled(row.Activo, true) && !clean(row.FechaDesasignacion);
}

function activeTicket(ticket = {}) {
  const annulled = normalizeAgendaText(ticket.Anulada);
  return !['true', '1', 'si'].includes(annulled)
    && normalizeAgendaText(ticket.Estado) !== 'anulada';
}

function appendMapArray(map, key, value) {
  if (!key) return;
  const current = map.get(key);
  if (current) current.push(value);
  else map.set(key, [value]);
}

/**
 * Índices efímeros y exclusivos de una petición de Agenda.
 * No conservan estado entre requests ni alteran el orden de las filas.
 */
export function buildAgendaRequestIndex({
  agendas = [],
  agendaAssignments = [],
  users = [],
  tickets = [],
  ticketAssignments = [],
} = {}) {
  const userById = new Map();
  for (const user of users) {
    userById.set(clean(user.UsuarioID), user);
  }

  const agendaAssignmentsByAgendaId = new Map();
  const agendaIdsByUser = new Map();
  for (const row of agendaAssignments) {
    if (!activeAgendaAssignment(row)) continue;
    const agendaId = clean(row.AgendaID);
    const userId = clean(row.UsuarioID);
    if (!agendaId || !userId) continue;
    appendMapArray(agendaAssignmentsByAgendaId, agendaId, row);
    if (!agendaIdsByUser.has(userId)) agendaIdsByUser.set(userId, new Set());
    agendaIdsByUser.get(userId).add(agendaId);
  }

  const ticketById = new Map();
  const ticketsByDate = new Map();
  for (const ticket of tickets) {
    if (!activeTicket(ticket)) continue;
    const ticketId = clean(ticket.BoletaUID);
    ticketById.set(ticketId, ticket);
    const date = agendaDate(ticket.Fecha);
    if (date) appendMapArray(ticketsByDate, date, ticket);
  }

  const ticketAssignmentsByTicketId = new Map();
  for (const row of ticketAssignments) {
    if (!activeTicketAssignment(row)) continue;
    const ticketId = clean(row.BoletaUID);
    const userId = clean(row.UsuarioID);
    if (!ticketId || !userId) continue;
    if (!ticketAssignmentsByTicketId.has(ticketId)) ticketAssignmentsByTicketId.set(ticketId, new Set());
    ticketAssignmentsByTicketId.get(ticketId).add(userId);
  }

  return {
    agendas,
    userById,
    agendaAssignmentsByAgendaId,
    agendaIdsByUser,
    ticketById,
    ticketsByDate,
    ticketAssignmentsByTicketId,
  };
}

function tokenSet(value) {
  return new Set(normalizeAgendaText(value).split(' ').filter((token) => token.length >= 4));
}

function overlapScore(agenda, ticket) {
  const source = tokenSet(agenda.Detalle);
  if (!source.size) return 0;
  const target = tokenSet([
    ticket.Titulo,
    ticket.Cliente,
    ticket.RazonVisita,
    ticket.TrabajoRealizado,
    ticket.Pendientes,
  ].filter(Boolean).join(' '));
  let score = 0;
  source.forEach((token) => { if (target.has(token)) score += 1; });
  return score;
}

function ticketClientId(ticket = {}) {
  return clean(ticket.ClienteID || ticket.ClienteId || ticket.clienteId);
}

function ticketClientName(ticket = {}) {
  return clean(ticket.Cliente || ticket.ClienteNombre || ticket.NombreCliente);
}

/**
 * Determina si una boleta pertenece a una agenda sin alterar el flujo de boletas.
 * Cuando la agenda tiene cliente, el cliente es la identidad principal del vínculo.
 * Para agendas antiguas sin cliente se conserva una compatibilidad por texto, pero
 * nunca se considera suficiente compartir solamente fecha y técnico.
 */
export function agendaTicketMatchScore(agenda = {}, ticket = {}) {
  const agendaClientId = clean(agenda.ClienteID);
  const agendaClientName = normalizeAgendaText(agenda.ClienteNombre);
  const boletaClientId = ticketClientId(ticket);
  const boletaClientName = normalizeAgendaText(ticketClientName(ticket));
  const textScore = overlapScore(agenda, ticket);

  if (agendaClientId) {
    if (boletaClientId) return agendaClientId === boletaClientId ? 1000 + textScore : 0;
    if (agendaClientName && boletaClientName) return agendaClientName === boletaClientName ? 700 + textScore : 0;
    return 0;
  }

  if (agendaClientName) {
    return agendaClientName === boletaClientName ? 700 + textScore : 0;
  }

  return textScore;
}

export function resolveAgendaTicketMatches({
  agendas = [],
  agendaAssignments = [],
  users = [],
  tickets = [],
  ticketAssignments = [],
  ticketExceptions = DEFAULT_AGENDA_TICKET_EXCEPTIONS,
  requestIndex = null,
} = {}) {
  const index = requestIndex || buildAgendaRequestIndex({
    agendas,
    agendaAssignments,
    users,
    tickets,
    ticketAssignments,
  });
  const { ticketById, ticketsByDate, ticketAssignmentsByTicketId } = index;

  const matches = new Map();
  const reserved = new Set();
  const ordered = [...agendas].sort((left, right) => (
    agendaDate(left.Fecha).localeCompare(agendaDate(right.Fecha))
    || clean(left.FechaCreacion).localeCompare(clean(right.FechaCreacion))
    || clean(left.AgendaID).localeCompare(clean(right.AgendaID))
  ));

  for (const agenda of ordered) {
    const agendaId = clean(agenda.AgendaID);
    if (!agendaId) continue;
    const existingId = clean(agenda.BoletaUID);
    const existing = existingId ? ticketById.get(existingId) : null;
    if (existing && !reserved.has(existingId)) {
      matches.set(agendaId, existing);
      reserved.add(existingId);
    }
  }

  for (const agenda of ordered) {
    const agendaId = clean(agenda.AgendaID);
    if (!agendaId || matches.has(agendaId)) continue;
    if (!agendaRequiresTicket(agenda.Detalle, ticketExceptions)) continue;
    if (normalizeAgendaText(agenda.Estado) === 'cancelada') continue;

    const assigned = new Set((index.agendaAssignmentsByAgendaId.get(agendaId) || [])
      .map((row) => clean(row.UsuarioID))
      .filter(Boolean));
    if (!assigned.size) continue;
    const candidates = (ticketsByDate.get(agendaDate(agenda.Fecha)) || [])
      .filter((ticket) => !reserved.has(clean(ticket.BoletaUID)))
      .filter((ticket) => {
        const ticketId = clean(ticket.BoletaUID);
        const ticketUsers = ticketAssignmentsByTicketId.get(ticketId) || new Set();
        return [...assigned].some((userId) => ticketUsers.has(userId))
          || assigned.has(clean(ticket.CreadoPor));
      })
      .map((ticket) => ({ ticket, score: agendaTicketMatchScore(agenda, ticket) }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => (
        right.score - left.score
        || clean(left.ticket.FechaCreacion).localeCompare(clean(right.ticket.FechaCreacion))
        || clean(left.ticket.BoletaUID).localeCompare(clean(right.ticket.BoletaUID))
      ));

    if (candidates[0]) {
      const selected = candidates[0].ticket;
      const ticketId = clean(selected.BoletaUID);
      matches.set(agendaId, selected);
      reserved.add(ticketId);
    }
  }
  return matches;
}

export function agendaStatus(agenda, ticket, today = costaRicaDate(), ticketExceptions = DEFAULT_AGENDA_TICKET_EXCEPTIONS) {
  const state = normalizeAgendaText(agenda.Estado);
  if (state === 'cancelada') return 'CANCELADA';
  if (!agendaRequiresTicket(agenda.Detalle, ticketExceptions)) return 'NO_REQUIERE';
  if (ticket) {
    return normalizeAgendaText(ticket.Estado) === 'finalizada'
      ? 'COMPLETA'
      : 'BOLETA_PENDIENTE';
  }
  return agendaDate(agenda.Fecha) > today ? 'FUTURA' : 'PENDIENTE';
}

export function buildAgendaViews({
  agendas = [],
  agendaAssignments = [],
  users = [],
  tickets = [],
  ticketAssignments = [],
  today = costaRicaDate(),
  ticketExceptions = DEFAULT_AGENDA_TICKET_EXCEPTIONS,
  requestIndex = null,
  ticketMatches = null,
} = {}) {
  const index = requestIndex || buildAgendaRequestIndex({
    agendas,
    agendaAssignments,
    users,
    tickets,
    ticketAssignments,
  });
  const matches = ticketMatches || resolveAgendaTicketMatches({
    agendas,
    agendaAssignments,
    users,
    tickets,
    ticketAssignments,
    ticketExceptions,
    requestIndex: index,
  });

  return agendas.map((agenda) => {
    const agendaId = clean(agenda.AgendaID);
    const assignedUsers = (index.agendaAssignmentsByAgendaId.get(agendaId) || [])
      .map((row) => index.userById.get(clean(row.UsuarioID)))
      .filter(Boolean)
      .map((user) => ({
        UsuarioID: clean(user.UsuarioID),
        NombreCompleto: clean(user.NombreCompleto || user.Nombre || user.NombreUsuario || user.Correo),
        Nombre: clean(user.Nombre || user.NombreCompleto || user.NombreUsuario || user.Correo),
        NombreUsuario: clean(user.NombreUsuario),
        Correo: clean(user.Correo),
      }));
    const ticket = matches.get(agendaId) || null;
    return {
      AgendaID: agendaId,
      Fecha: agendaDate(agenda.Fecha),
      HoraInicio: clean(agenda.HoraInicio, '07:00'),
      HoraFin: clean(agenda.HoraFin, '17:00'),
      Detalle: clean(agenda.Detalle),
      ClienteID: clean(agenda.ClienteID),
      ClienteNombre: clean(agenda.ClienteNombre),
      Estado: clean(agenda.Estado, 'ACTIVA').toUpperCase(),
      RequiereBoleta: agendaRequiresTicket(agenda.Detalle, ticketExceptions),
      RecordatorioEnviado: enabled(agenda.RecordatorioEnviado, false),
      RecordatorioEnviadoEn: clean(agenda.RecordatorioEnviadoEn),
      CreadoPor: clean(agenda.CreadoPor),
      FechaCreacion: clean(agenda.FechaCreacion),
      FechaActualizacion: clean(agenda.FechaActualizacion),
      asignados: assignedUsers,
      status: agendaStatus(agenda, ticket, today, ticketExceptions),
      boleta: ticket ? {
        BoletaUID: clean(ticket.BoletaUID),
        BoletaNumero: clean(ticket.BoletaNumero || ticket.BoletaID),
        Titulo: clean(ticket.Titulo),
        ClienteID: ticketClientId(ticket),
        Cliente: ticketClientName(ticket),
        Estado: clean(ticket.Estado),
        Fecha: agendaDate(ticket.Fecha),
      } : null,
    };
  });
}