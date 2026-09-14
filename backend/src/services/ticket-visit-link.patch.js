import { ticketDeliveryHandlers } from '../modules/ticket-delivery.module.js';
import { ticketVisitLinkHandlers } from '../modules/ticket-visit-link.module.js';

const INSTALL_FLAG = Symbol.for('dms.ticketVisitLink');

if (!ticketDeliveryHandlers[INSTALL_FLAG]) {
  const previousGet = ticketDeliveryHandlers.get;
  const previousUpdate = ticketDeliveryHandlers.update;

  ticketDeliveryHandlers.get = async (ctx) => {
    if (ctx.payload?.visitLinkCandidates === true) {
      return ticketVisitLinkHandlers.candidates(ctx);
    }
    return previousGet(ctx);
  };

  ticketDeliveryHandlers.update = async (ctx) => {
    if (Array.isArray(ctx.payload?.visitLinkTargetIds)) {
      return ticketVisitLinkHandlers.link({
        ...ctx,
        payload: {
          ...ctx.payload,
          targetTicketIds: ctx.payload.visitLinkTargetIds,
        },
      });
    }
    return previousUpdate(ctx);
  };

  ticketDeliveryHandlers[INSTALL_FLAG] = true;
}
