import './customer-case-payload-limit.patch.js';
import './customer-case-ticket-link.patch.js';
import { pick } from '../core/utils.js';
import { ticketDeliveryHandlers } from '../modules/ticket-delivery.module.js';
import { finalizeCustomerCaseForTicket } from './customer-case-sync.service.js';

const INSTALL_FLAG = Symbol.for('dms.customerCaseTicketFinalization');

if (!ticketDeliveryHandlers[INSTALL_FLAG]) {
  const finalize = ticketDeliveryHandlers.finalize;
  ticketDeliveryHandlers.finalize = async (ctx) => {
    const result = await finalize(ctx);
    const ticketId = pick(
      result?.boleta || {},
      ['BoletaUID', 'boletaUid', 'id'],
      pick(ctx.payload, ['boletaUid', 'BoletaUID', 'id']),
    );
    let customerCase = null;
    let customerCaseSyncError = '';
    try {
      customerCase = await finalizeCustomerCaseForTicket(
        ticketId,
        ctx.user?.UsuarioID || 'SISTEMA',
      );
    } catch (error) {
      customerCaseSyncError = String(error?.message || error);
      console.error(`[customer-case-finalization] No se pudo cerrar el caso de la boleta ${ticketId}:`, error);
    }
    return {
      ...result,
      customerCase,
      customerCaseSyncError,
    };
  };
  ticketDeliveryHandlers[INSTALL_FLAG] = true;
}
