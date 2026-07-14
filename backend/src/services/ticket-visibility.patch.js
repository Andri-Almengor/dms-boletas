import { ticketHandlers } from '../modules/tickets.module.js';
import { ticketDeliveryHandlers } from '../modules/ticket-delivery.module.js';
import { assertTicketPayloadAccess, filterTicketListResult } from './ticket-access.service.js';

const originalList = ticketHandlers.list;
ticketHandlers.list = async (ctx) => filterTicketListResult(ctx, await originalList(ctx));

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
