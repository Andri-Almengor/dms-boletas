import { selectTicketPage } from '../services/ticket-list-query.service.js';

function clean(value) {
  return String(value ?? '').trim();
}

function active(row = {}) {
  return row.Activo !== false && String(row.Activo ?? 'true').toLowerCase() !== 'false';
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

function assignmentMap(assignments = [], entityIds = new Set(), ctx = {}) {
  const admin = isTicketSyncAdministrator(ctx);
  const ownUserId = clean(ctx.user?.UsuarioID);
  const result = new Map();
  for (const assignment of assignments) {
    if (!active(assignment)) continue;
    const ticketId = clean(assignment.BoletaUID);
    if (!entityIds.has(ticketId)) continue;
    const assignedUserId = clean(assignment.UsuarioID);
    if (!admin && assignedUserId !== ownUserId) continue;
    if (!result.has(ticketId)) result.set(ticketId, []);
    result.get(ticketId).push(assignedUserId);
  }
  for (const [ticketId, ids] of result.entries()) result.set(ticketId, [...new Set(ids)].sort());
  return result;
}

export function materializeTicketDeltaFromRows({
  ctx = {},
  events = [],
  tickets = [],
  assignments = [],
} = {}) {
  const allowedIds = ticketSyncAllowedIds(ctx, assignments);
  const counts = selectTicketPage(
    tickets,
    { page: 1, pageSize: 1, homeSummary: true },
    allowedIds,
  ).homeSummary;
  const byId = new Map(tickets.map((ticket) => [clean(ticket.BoletaUID), ticket]));
  const entityIds = new Set(events.map((event) => clean(event.EntityID)).filter(Boolean));
  const assignmentsByTicket = assignmentMap(assignments, entityIds, ctx);
  const upserts = [];
  const removed = [];

  for (const event of events) {
    const entityId = clean(event.EntityID);
    if (!entityId) continue;
    if (String(event.Operation || '').toUpperCase() === 'DELETE') {
      removed.push(entityId);
      continue;
    }

    const ticket = byId.get(entityId);
    if (!ticket) {
      removed.push(entityId);
      continue;
    }

    const visible = selectTicketPage(
      [ticket],
      { page: 1, pageSize: 1 },
      allowedIds,
    ).items[0];
    if (!visible) {
      removed.push(entityId);
      continue;
    }

    upserts.push({
      ...visible,
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
