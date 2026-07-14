import { forbidden } from '../core/errors.js';
import { findById, readTable } from '../infra/sheets.repository.js';
import { pick } from '../core/utils.js';

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

export async function filterTicketListResult(ctx, result) {
  if (canViewAllTickets(ctx)) return result;
  const allowedIds = await assignedTicketIdsForUser(ctx.user.UsuarioID);
  if (Array.isArray(result)) return result.filter((row) => allowedIds.has(String(row.BoletaUID)));
  const items = Array.isArray(result?.items) ? result.items : [];
  const filtered = items.filter((row) => allowedIds.has(String(row.BoletaUID)));
  return { ...result, items: filtered, total: filtered.length };
}

async function resolveTicketId(payload = {}) {
  const direct = pick(payload, ['boletaUid', 'BoletaUID', 'ticketId']);
  if (direct) return direct;
  const evidenceId = pick(payload, ['evidenciaId', 'EvidenciaID']);
  if (evidenceId) {
    const evidence = await findById('EvidenciasBoleta', evidenceId);
    return evidence.BoletaUID;
  }
  return '';
}

export async function assertTicketPayloadAccess(ctx, payload = {}) {
  if (canViewAllTickets(ctx)) return true;
  const ticketId = await resolveTicketId(payload);
  if (!ticketId) throw forbidden('No fue posible validar el acceso a la boleta.');
  const allowedIds = await assignedTicketIdsForUser(ctx.user.UsuarioID);
  if (!allowedIds.has(String(ticketId))) {
    throw forbidden('Solo puede consultar o modificar las boletas en las que está asignado.');
  }
  return true;
}
