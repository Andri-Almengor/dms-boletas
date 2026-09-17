import { notFound } from '../core/errors.js';
import { pick } from '../core/utils.js';
import { findById } from '../infra/sheets.repository.js';
import { createTicketDetailSnapshot } from './ticket-detail-snapshot.service.js';
import { ticketHandlers as baseTicketHandlers } from '../modules/tickets.module.js';
import { ticketMultiHandlers } from '../modules/ticket-multi.module.js';
import { ticketAccessHandlers } from '../modules/ticket-access.module.js';
import { ticketDeliveryHandlers } from '../modules/ticket-delivery.module.js';
import { assertTicketPayloadAccess } from './ticket-access.service.js';

const INSTALL_FLAG = Symbol.for('dms.ticketDetailReadOptimization');
const clean = (value) => String(value ?? '').trim();

if (!ticketDeliveryHandlers[INSTALL_FLAG]) {
  const previousBaseGet = baseTicketHandlers.get;
  const previousDeliveryGet = ticketDeliveryHandlers.get;
  baseTicketHandlers.get = async (ctx) => {
    if (ctx.__ticketDetailRow?.BoletaUID) return { boleta: ctx.__ticketDetailRow };
    return previousBaseGet(ctx);
  };
  ticketDeliveryHandlers.get = async (ctx) => {
    if (ctx.payload?.visitLinkCandidates === true) return previousDeliveryGet(ctx);
    const ticketId = clean(pick(ctx.payload, ['boletaUid', 'BoletaUID', 'id']));
    if (!ticketId) throw notFound('No se indicó la boleta solicitada.');
    let ticket;
    try { ticket = await findById('Boletas', ticketId); }
    catch { throw notFound('No se encontró la boleta solicitada.'); }
    const snapshot = createTicketDetailSnapshot(ticket);
    await ticketAccessHandlers.assertTicketAccess(ctx, ticket, 'consultar', snapshot);
    await assertTicketPayloadAccess(ctx, ctx.payload);
    return ticketMultiHandlers.get({ ...ctx, __ticketDetailRow: ticket, __ticketDetailSnapshot: snapshot });
  };
  ticketDeliveryHandlers[INSTALL_FLAG] = true;
}
