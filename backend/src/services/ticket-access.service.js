import { forbidden } from '../core/errors.js';
import { readTable } from '../infra/sheets.repository.js';

export function canViewAllTickets(ctx) {
  return ctx.permissions?.includes('USUARIOS_GESTIONAR')
    || ctx.permissions?.includes('BOLETAS_ELIMINAR');
}

export async function assignedTicketIdsForUser(userId) {
  const rows = await readTable('BoletaAsignados');
  return new Set(rows
    .filter((row) => row.Activo !== false && String(row.UsuarioID) === String(userId))
    .map((row) => String(row.BoletaUID)));
}

export async function filterTicketsForUser(ctx, rows) {
  if (canViewAllTickets(ctx)) return rows;
  const allowedIds = await assignedTicketIdsForUser(ctx.user.UsuarioID);
  return rows.filter((row) => allowedIds.has(String(row.BoletaUID)));
}

export async function assertTicketAccess(ctx, ticketId) {
  if (canViewAllTickets(ctx)) return true;
  const allowedIds = await assignedTicketIdsForUser(ctx.user.UsuarioID);
  if (!allowedIds.has(String(ticketId))) {
    throw forbidden('Solo puede consultar o modificar las boletas en las que está asignado.');
  }
  return true;
}
