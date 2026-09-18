import './ticket-write-consistency.patch.js';
import './ticket-visit-link.patch.js';
import { ticketHandlers } from '../modules/tickets.module.js';
import { ticketDeliveryHandlers } from '../modules/ticket-delivery.module.js';
import { findRows, queryTicketPage } from '../infra/sheets.repository.js';
import { assertTicketPayloadAccess, assignedTicketIdsForUser, canViewAllTickets } from './ticket-access.service.js';

async function assignedIds(userId) {
  if (!userId) return new Set();
  const rows = await findRows('BoletaAsignados', { UsuarioID: userId }, { limit: 50_000 });
  return new Set(rows
    .filter((row) => row.Activo !== false && String(row.Activo ?? 'true').toLowerCase() !== 'false')
    .map((row) => String(row.BoletaUID)));
}
function intersect(left, right) {
  if (!left) return right;
  if (!right) return left;
  const out = new Set();
  for (const value of left) if (right.has(value)) out.add(value);
  return out;
}

ticketHandlers.list = async (ctx) => {
  const { payload } = ctx;
  const viewAll = canViewAllTickets(ctx);
  const requestedAssignedUser = String(payload.asignadoUsuarioId || payload.UsuarioID || '').trim();
  let allowedIds = viewAll ? null : await assignedTicketIdsForUser(ctx.user.UsuarioID);
  if (requestedAssignedUser) allowedIds = intersect(allowedIds, await assignedIds(requestedAssignedUser));
  return queryTicketPage(payload, { allowedIds });
};

for (const key of [
  'get','update','autosave','returnPending','annul','evidenceUpload','evidenceUpdate','evidenceDelete','mediaGet','signatureUpload',
]) {
  const original = ticketHandlers[key];
  if (!original) continue;
  ticketHandlers[key] = async (ctx) => {
    await assertTicketPayloadAccess(ctx, ctx.payload);
    return original(ctx);
  };
}

for (const key of ['finalize', 'testFinalize', 'generatePdf']) {
  const original = ticketDeliveryHandlers[key];
  if (!original) continue;
  ticketDeliveryHandlers[key] = async (ctx) => {
    await assertTicketPayloadAccess(ctx, ctx.payload);
    return original(ctx);
  };
}
