import { AppError } from '../core/errors.js';
import { pick } from '../core/utils.js';
import { findById, readTable } from '../infra/sheets.repository.js';
import { audit } from '../services/audit.service.js';
import {
  ensureVisitGroupForTicket,
  ticketHasStoredSignature,
} from '../services/ticket-visit-group.service.js';
import {
  isManualVisitLinkCandidate,
  linkTicketsToVisitGroup,
} from '../services/ticket-visit-link.service.js';
import { ticketAccessHandlers } from './ticket-access.module.js';

function clean(value) {
  return String(value ?? '').trim();
}

function targetIds(payload = {}) {
  const value = payload.targetTicketIds || payload.boletaUids || payload.BoletasUID || payload.ids || [];
  return Array.isArray(value) ? [...new Set(value.map(clean).filter(Boolean))] : [];
}

async function listAccessiblePendingClientTickets(ctx, clienteId) {
  const items = [];
  const pageSize = 1000;
  let page = 1;
  let total = 0;
  do {
    const result = await ticketAccessHandlers.list({
      ...ctx,
      payload: {
        page,
        pageSize,
        status: 'PENDIENTE',
        clienteId,
      },
    });
    items.push(...(result?.items || []));
    total = Number(result?.total || items.length);
    page += 1;
  } while (items.length < total);
  return items;
}

function candidateView(ticket) {
  return {
    BoletaUID: ticket.BoletaUID,
    BoletaID: ticket.BoletaID,
    Fecha: ticket.Fecha,
    Titulo: ticket.Titulo,
    Ubicacion: ticket.Ubicacion,
    UbicacionEquipo: ticket.UbicacionEquipo,
    ClienteID: ticket.ClienteID,
    Cliente: ticket.Cliente,
    Estado: ticket.Estado,
    Firmada: ticketHasStoredSignature(ticket),
  };
}

export const ticketVisitLinkHandlers = {
  candidates: async (ctx) => {
    const sourceId = clean(pick(ctx.payload, ['boletaUid', 'BoletaUID', 'id']));
    const source = await findById('Boletas', sourceId);
    await ticketAccessHandlers.assertTicketAccess(ctx, source, 'relacionar');
    const sourceGroup = await ensureVisitGroupForTicket(sourceId, ctx.user.UsuarioID);
    const accessibleTickets = await listAccessiblePendingClientTickets(ctx, sourceGroup.root.ClienteID);
    const allTickets = await readTable('Boletas');
    const items = accessibleTickets
      .filter((candidate) => isManualVisitLinkCandidate({ sourceGroup, candidate, allTickets }))
      .map(candidateView);
    return {
      items,
      total: items.length,
      clienteId: sourceGroup.root.ClienteID,
      cliente: sourceGroup.root.Cliente || '',
      grupoVisitaId: sourceGroup.id,
    };
  },

  link: async (ctx) => {
    const sourceId = clean(pick(ctx.payload, ['boletaUid', 'BoletaUID', 'id']));
    const selectedIds = targetIds(ctx.payload);
    if (!selectedIds.length) {
      throw new AppError('VISIT_LINK_TARGET_REQUIRED', 'Seleccione al menos una boleta para relacionar.', 400);
    }

    const source = await findById('Boletas', sourceId);
    await ticketAccessHandlers.assertTicketAccess(ctx, source, 'relacionar');
    for (const id of selectedIds) {
      const target = await findById('Boletas', id);
      await ticketAccessHandlers.assertTicketAccess(ctx, target, 'relacionar');
    }

    const result = await linkTicketsToVisitGroup({
      sourceTicketId: sourceId,
      targetTicketIds: selectedIds,
      actor: ctx.user.UsuarioID,
    });

    if (result.linkedIds.length) {
      await audit(ctx, 'RELACIONAR_BOLETAS_EXISTENTES', 'Boletas', result.group.rootId, source, {
        GrupoVisitaID: result.group.id,
        BoletaPrincipalUID: result.group.rootId,
        BoletasRelacionadas: result.linkedIds,
        CantidadVisitas: result.group.visits.length,
      });
    }

    return ticketAccessHandlers.get({
      ...ctx,
      payload: { boletaUid: sourceId, id: sourceId },
    });
  },
};
