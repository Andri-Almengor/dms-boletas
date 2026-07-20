import { maintenanceSignatureHandlers } from './maintenance-signature.module.js';
import { ticketGroupSignatureHandlers } from './ticket-group-signature.module.js';

function isMaintenanceToken(value) {
  return String(value || '').trim().startsWith('mntsig_');
}

export const publicSignatureHandlers = {
  publicGet: async (ctx) => (
    isMaintenanceToken(ctx.payload.token)
      ? maintenanceSignatureHandlers.publicGet(ctx)
      : ticketGroupSignatureHandlers.publicGet(ctx)
  ),

  publicSubmit: async (ctx) => (
    isMaintenanceToken(ctx.payload.token)
      ? maintenanceSignatureHandlers.publicSubmit(ctx)
      : ticketGroupSignatureHandlers.publicSubmit(ctx)
  ),
};
