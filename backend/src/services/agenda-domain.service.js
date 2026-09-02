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
  tickets = [],
  ticketAssignments = [],
  ticketExceptions = DEFAULT_AGENDA_TICKET_EXCEPTIONS,
} = {}) {
  const agendaUsers = new Map();
  for (const row of agendaAssignments.filter(activeAgendaAssignment)) {
    const id = clean(row.AgendaID);
    const userId = clean(row.UsuarioID);
    if (!id || !userId) continue;
    if (!agendaUsers.has(id)) agendaUsers.set(id, new Set());
    agendaUsers.get(id).add(userId);
  }

  const ticketUsers = new Map();
  for (const row of ticketAssignments.filter(activeTicketAssignment)) {
    const id = clean(row.BoletaUID);
    const userId = clean(row.UsuarioID);
    if (!id || !userId) continue;
    if (!ticketUsers.has(id)) ticketUsers.set(id, new Set());
    ticketUsers.get(id).add(userId);
  }

  const validTickets = tickets.filter((ticket) => {
    const annulled = normalizeAgendaText(ticket.Anulada);
    return !['true', '1', 'si'].includes(annulled);
  });
  const ticketById = new Map(validTickets.map((ticket) => [clean(ticket.BoletaUID), ticket]));
  const ticketsByDate = new Map();
  for (const ticket of validTickets) {
    const date = agendaDate(ticket.Fecha);
    if (!date) continue;
    if (!ticketsByDate.has(date)) ticketsByDate.set(date, []);
    ticketsByDate.get(date).push(ticket);
  }

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

    const assigned = agendaUsers.get(agendaId) || new Set();
    if (!assigned.size) continue;
    const candidates = (ticketsByDate.get(agendaDate(agenda.Fecha)) || [])
      .filter((ticket) => !reserved.has(clean(ticket.BoletaUID)))
      .filter((ticket) => {
        const users = ticketUsers.get(clean(ticket.BoletaUID)) || new Set();
        return [...assigned].some((userId) => users.has(userId))
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
  if (ticket) return 'COMPLETA';
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
} = {}) {
  const userById = new Map(users.map((user) => [clean(user.UsuarioID), user]));
  const assignmentMap = new Map();
  for (const row of agendaAssignments.filter(activeAgendaAssignment)) {
    const agendaId = clean(row.AgendaID);
    if (!assignmentMap.has(agendaId)) assignmentMap.set(agendaId, []);
    const user = userById.get(clean(row.UsuarioID));
    if (user) {
      assignmentMap.get(agendaId).push({
        UsuarioID: clean(user.UsuarioID),
        NombreCompleto: clean(user.NombreCompleto || user.Nombre || user.NombreUsuario || user.Correo),
        Nombre: clean(user.Nombre || user.NombreCompleto || user.NombreUsuario || user.Correo),
        NombreUsuario: clean(user.NombreUsuario),
        Correo: clean(user.Correo),
      });
    }
  }

  const matches = resolveAgendaTicketMatches({ agendas, agendaAssignments, tickets, ticketAssignments, ticketExceptions });
  return agendas.map((agenda) => {
    const ticket = matches.get(clean(agenda.AgendaID)) || null;
    return {
      AgendaID: clean(agenda.AgendaID),
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
      asignados: assignmentMap.get(clean(agenda.AgendaID)) || [],
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
