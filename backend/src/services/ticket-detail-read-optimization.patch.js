import { notFound } from '../core/errors.js';
import { pick } from '../core/utils.js';
import { createTicketDetailSnapshot } from './ticket-detail-snapshot.service.js';
import { ticketHandlers as baseTicketHandlers } from '../modules/tickets.module.js';
import { ticketMultiHandlers } from '../modules/ticket-multi.module.js';
import { ticketAccessHandlers } from '../modules/ticket-access.module.js';
import { ticketDeliveryHandlers } from '../modules/ticket-delivery.module.js';
import { assertTicketPayloadAccess } from './ticket-access.service.js';

const INSTALL_FLAG = Symbol.for('dms.ticketDetailReadOptimization');

function clean(value) {
  return String(value ?? '').trim();
}

if (!ticketDeliveryHandlers[INSTALL_FLAG]) {
  const previousBaseGet = baseTicketHandlers.get;
  const previousDeliveryGet = ticketDeliveryHandlers.get;

  // ticket-multi ya vuelve a materializar asignados/evidencias para todas las
  // visitas. Cuando el acceso fue validado con la fila fresca, no tiene sentido
  // que el get base lea y enriquezca esas mismas tablas una vez adicional.
  baseTicketHandlers.get = async (ctx) => {
    if (ctx.__ticketDetailRow?.BoletaUID) return { boleta: ctx.__ticketDetailRow };
    return previousBaseGet(ctx);
  };

  ticketDeliveryHandlers.get = async (ctx) => {
    // La variante utilizada por el selector de vinculaciones tiene su propio
    // contrato y se conserva exactamente en el parche previo.
    if (ctx.payload?.visitLinkCandidates === true) return previousDeliveryGet(ctx);

    const ticketId = clean(pick(ctx.payload, ['boletaUid', 'BoletaUID', 'id']));
    if (!ticketId) throw notFound('No se indicó la boleta solicitada.');

    const snapshot = createTicketDetailSnapshot();
    // El repositorio ya mantiene coherencia por revisión para todas las
    // escrituras de la aplicación. Forzar Boletas aquí hacía que cada detalle
    // abierto después de la ventana de coalescencia descartara una tabla válida
    // y descargara nuevamente la hoja completa. Reutilizamos la misma política
    // TTL/coherencia que las listas; el snapshot sigue aislando esta solicitud.
    const tickets = await snapshot.read('Boletas');
    const ticket = snapshot.locate(tickets, ticketId);
    if (!ticket) throw notFound('No se encontró la boleta solicitada.');

    // Se mantienen las dos capas de acceso existentes. No se amplía ningún rol
    // ni se cambia la restricción de técnicos por asignación.
    await ticketAccessHandlers.assertTicketAccess(ctx, ticket, 'consultar', snapshot);
    await assertTicketPayloadAccess(ctx, ctx.payload, snapshot);

    return ticketMultiHandlers.get({
      ...ctx,
      __ticketDetailRow: ticket,
      __ticketDetailSnapshot: snapshot,
    });
  };

  ticketDeliveryHandlers[INSTALL_FLAG] = true;
}
