import { ticketHandlers } from '../modules/tickets.module.js';
import { ticketDeliveryHandlers } from '../modules/ticket-delivery.module.js';
import { filterRows, readTable } from '../infra/sheets.repository.js';
import { assertTicketPayloadAccess, assignedTicketIdsForUser, canViewAllTickets } from './ticket-access.service.js';

ticketHandlers.list = async (ctx) => {
  const { payload } = ctx;
  let rows = (await readTable('Boletas'))
    .filter((row) => row.Activo !== false && String(row.Estado || '').toUpperCase() !== 'ANULADA');

  if (!canViewAllTickets(ctx)) {
    const allowedIds = await assignedTicketIdsForUser(ctx.user.UsuarioID);
    rows = rows.filter((row) => allowedIds.has(String(row.BoletaUID)));
  }

  if (payload.status || payload.estado) {
    rows = rows.filter((row) => String(row.Estado || '').toUpperCase() === String(payload.status || payload.estado).toUpperCase());
  }
  if (payload.dateFrom) rows = rows.filter((row) => String(row.Fecha || '').slice(0, 10) >= String(payload.dateFrom));
  if (payload.dateTo) rows = rows.filter((row) => String(row.Fecha || '').slice(0, 10) <= String(payload.dateTo));

  return filterRows(rows, payload, ['Titulo', 'Cliente', 'Ubicacion', 'Categoria', 'TipoDispositivo', 'Modelo', 'BoletaID']);
};

for (const key of [
  'get',
  'update',
  'autosave',
  'returnPending',
  'annul',
  'evidenceUpload',
  'evidenceUpdate',
  'evidenceDelete',
  'mediaGet',
  'signatureUpload',
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
