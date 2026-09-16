function clean(value) {
  return String(value ?? '').trim();
}

function active(row = {}) {
  return row.Activo !== false && String(row.Activo ?? 'true').toLowerCase() !== 'false';
}

function normalizeStatus(value) {
  const text = clean(value).toUpperCase();
  if (text.includes('FINAL')) return 'FINALIZADA';
  if (text.includes('PEND')) return 'PENDIENTE';
  if (text.includes('ANUL')) return 'ANULADA';
  return text;
}

function publicTicketRow(row = {}) {
  const { __rowNumber, ...ticket } = row;
  return ticket;
}

export function isTicketSyncAdministrator(ctx = {}) {
  const permissions = ctx.permissions || [];
  return permissions.includes('USUARIOS_GESTIONAR')
    || permissions.includes('BOLETAS_ELIMINAR')
    || permissions.includes('BOLETAS_GESTIONAR');
}

export function ticketSyncAllowedIds(ctx = {}, assignments = []) {
  if (isTicketSyncAdministrator(ctx)) return null;
  const selectedUserId = clean(ctx.user?.UsuarioID);
  const ids = new Set();
  if (!selectedUserId) return ids;
  for (const assignment of assignments) {
    if (!active(assignment) || clean(assignment.UsuarioID) !== selectedUserId) continue;
    const ticketId = clean(assignment.BoletaUID);
    if (ticketId) ids.add(ticketId);
  }
  return ids;
}

export function materializeTicketDeltaFromRows({
  ctx = {},
  events = [],
  tickets = [],
  assignments = [],
} = {}) {
  const admin = isTicketSyncAdministrator(ctx);
  const ownUserId = clean(ctx.user?.UsuarioID);
  const entityIds = new Set(events.map((event) => clean(event.EntityID)).filter(Boolean));
  const allowedIds = admin ? null : new Set();
  const assignmentsByTicket = new Map();

  // Authorization and changed-ticket assignment metadata are derived together.
  // This keeps current server-side visibility authoritative without two complete
  // passes over BoletaAsignados for every delta.
  for (const assignment of assignments) {
    if (!active(assignment)) continue;
    const ticketId = clean(assignment.BoletaUID);
    const assignedUserId = clean(assignment.UsuarioID);
    if (!ticketId || !assignedUserId) continue;

    const visibleAssignment = admin || assignedUserId === ownUserId;
    if (!admin && assignedUserId === ownUserId) allowedIds.add(ticketId);
    if (!visibleAssignment || !entityIds.has(ticketId)) continue;

    if (!assignmentsByTicket.has(ticketId)) assignmentsByTicket.set(ticketId, []);
    assignmentsByTicket.get(ticketId).push(assignedUserId);
  }
  for (const [ticketId, ids] of assignmentsByTicket.entries()) {
    assignmentsByTicket.set(ticketId, [...new Set(ids)].sort());
  }

  const counts = { pending: 0, finished: 0 };
  const changedVisibleTickets = new Map();

  // One ticket pass now performs both authoritative Home counts and changed-ID
  // selection. Previously counts and the by-id materialization each traversed
  // the complete collection independently.
  for (const ticket of tickets) {
    if (!active(ticket)) continue;
    const ticketId = clean(ticket.BoletaUID);
    const status = normalizeStatus(ticket.Estado);
    if (!ticketId || status === 'ANULADA') continue;
    if (allowedIds && !allowedIds.has(ticketId)) continue;

    if (status === 'PENDIENTE') counts.pending += 1;
    else if (status === 'FINALIZADA') counts.finished += 1;

    if (entityIds.has(ticketId)) changedVisibleTickets.set(ticketId, publicTicketRow(ticket));
  }

  const upserts = [];
  const removed = [];
  for (const event of events) {
    const entityId = clean(event.EntityID);
    if (!entityId) continue;
    if (String(event.Operation || '').toUpperCase() === 'DELETE') {
      removed.push(entityId);
      continue;
    }

    const ticket = changedVisibleTickets.get(entityId);
    if (!ticket) {
      removed.push(entityId);
      continue;
    }

    upserts.push({
      ...ticket,
      __sync: {
        assignedUserIds: assignmentsByTicket.get(entityId) || [],
      },
    });
  }

  return {
    upserts,
    removed: [...new Set(removed)],
    invalidated: [],
    counts,
  };
}
