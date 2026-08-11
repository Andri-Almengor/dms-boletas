import { pick } from '../core/utils.js';
import { findById } from '../infra/sheets.repository.js';
import { ticketMultiHandlers } from '../modules/ticket-multi.module.js';
import { audit } from './audit.service.js';

const baseAnnul = ticketMultiHandlers.annul;

ticketMultiHandlers.annul = async function auditedTicketAnnul(ctx) {
  const id = pick(ctx.payload, ['boletaUid', 'BoletaUID', 'id']);
  const before = await findById('Boletas', id);
  const result = await baseAnnul(ctx);
  const after = result?.boleta || result;
  await audit(ctx, 'ELIMINAR_BOLETA', 'Boletas', id, before, after).catch(() => {});
  return result;
};
