import { findById } from '../infra/sheets.repository.js';
import { audit } from '../services/audit.service.js';
import { deliverSignedTicket } from '../services/ticket-group-delivery.service.js';
import {
  applyPublicSignature,
  ensureSignatureRequestForTicket,
  findSignatureRequestByToken,
  signatureRequestView,
  updateSignatureDelivery,
  visitGroupHasSignature,
} from '../services/ticket-group-signature-request.service.js';
import {
  ensureVisitGroupForTicket,
  ticketHasStoredSignature,
  ticketVisitNumber,
} from '../services/ticket-visit-group.service.js';
import { ticketAccessHandlers } from './ticket-access.module.js';

function clean(value) {
  return String(value ?? '').trim();
}

function visitView(ticket = {}) {
  return {
    uid: clean(ticket.BoletaUID),
    number: clean(ticket.BoletaID || ticket.BoletaUID),
    visitNumber: ticketVisitNumber(ticket),
    title: clean(ticket.Titulo, 'Boleta de servicio'),
    date: ticket.Fecha || '',
    location: [ticket.Ubicacion, ticket.UbicacionEquipo].filter(Boolean).join(' · '),
    result: ticket.Resultado || '',
    signed: ticketHasStoredSignature(ticket),
  };
}

function publicTicketView(group) {
  const ticket = group.root;
  return {
    uid: clean(ticket.BoletaUID),
    number: group.visits.map((visit) => visit.BoletaID || visit.BoletaUID).join(', '),
    title: clean(ticket.Titulo, 'Seguimiento de servicio'),
    clientName: clean(ticket.Cliente, 'Cliente'),
    date: ticket.Fecha || '',
    location: [ticket.Ubicacion, ticket.UbicacionEquipo].filter(Boolean).join(' · '),
    supervisor: ticket.Supervisor || '',
    signed: group.visits.every(ticketHasStoredSignature),
    visitCount: group.visits.length,
    visits: group.visits.map(visitView),
  };
}

function isFinalized(ticket = {}) {
  return clean(ticket.Estado).toUpperCase().includes('FINAL');
}

export const ticketGroupSignatureHandlers = {
  link: async (ctx) => {
    const ticketId = ctx.payload.boletaUid || ctx.payload.BoletaUID || ctx.payload.id;
    const ticket = await findById('Boletas', ticketId);
    await ticketAccessHandlers.assertTicketAccess(ctx, ticket, 'consultar el enlace de firma de');
    const [request, group] = await Promise.all([
      ensureSignatureRequestForTicket({ ticketId, origin: ctx.origin, actor: ctx.user.UsuarioID }),
      ensureVisitGroupForTicket(ticketId, ctx.user.UsuarioID),
    ]);
    return {
      request,
      signed: await visitGroupHasSignature(ticketId),
      ticket: publicTicketView(group),
      group: {
        id: group.id,
        rootId: group.rootId,
        visitCount: group.visits.length,
      },
    };
  },

  publicGet: async (ctx) => {
    const requestRow = await findSignatureRequestByToken(ctx.payload.token);
    const group = await ensureVisitGroupForTicket(requestRow.BoletaUID, 'CLIENTE');
    const request = signatureRequestView(requestRow);
    const signed = group.visits.some(ticketHasStoredSignature);
    return {
      request: {
        ...request,
        ticketNumber: group.visits.map((visit) => visit.BoletaID || visit.BoletaUID).join(', '),
        visitCount: group.visits.length,
      },
      ticket: publicTicketView(group),
      alreadySigned: request.status === 'FIRMADA' || signed,
      expired: request.status === 'EXPIRADA',
    };
  },

  publicSubmit: async (ctx) => {
    const signed = await applyPublicSignature({
      token: ctx.payload.token,
      base64: ctx.payload.base64,
      mimeType: ctx.payload.mimeType || 'image/png',
    });
    const group = signed.group || await ensureVisitGroupForTicket(signed.ticket.BoletaUID, 'CLIENTE');

    if (signed.alreadySigned) {
      return {
        signed: true,
        alreadySigned: true,
        request: signed.request,
        ticket: publicTicketView(group),
        message: group.visits.length > 1
          ? 'Las visitas relacionadas ya cuentan con la firma del cliente.'
          : 'La boleta ya cuenta con la firma del cliente.',
      };
    }

    const systemContext = {
      ...ctx,
      user: { UsuarioID: 'CLIENTE', Nombre: 'Cliente' },
      permissions: [],
    };
    const finalized = group.visits.some(isFinalized);
    let delivery = null;
    let deliveryError = '';

    if (finalized) {
      try {
        delivery = await deliverSignedTicket(systemContext, {
          ticketId: group.rootId,
          signatureRequest: signed.request,
        });
        await updateSignatureDelivery(signed.request.id, {
          state: delivery.notificationState,
          error: delivery.errors.join(' | '),
          pdfUrl: delivery.report.pdfUrl,
        });
      } catch (error) {
        deliveryError = String(error?.message || error);
        await updateSignatureDelivery(signed.request.id, {
          state: 'ERROR',
          error: deliveryError,
        }).catch(() => {});
      }
    } else {
      await updateSignatureDelivery(signed.request.id, {
        state: 'ESPERANDO_FINALIZACION',
        error: '',
      }).catch(() => {});
    }

    await audit(systemContext, 'FIRMA_PUBLICA_GRUPO_BOLETAS', 'Boletas', group.rootId, null, {
      GrupoVisitaID: group.id,
      CantidadVisitas: group.visits.length,
      FirmaArchivoID: signed.file?.id || '',
      FirmaURL: signed.file?.webViewLink || '',
      SolicitudFirmaID: signed.request.id,
      EstadoEntrega: finalized ? (delivery?.notificationState || 'ERROR') : 'ESPERANDO_FINALIZACION',
      ErrorEntrega: deliveryError || delivery?.errors?.join(' | ') || '',
    }).catch(() => {});

    const message = !finalized
      ? `La firma se guardó para ${group.visits.length} visita(s). El reporte se enviará cuando el seguimiento sea finalizado.`
      : deliveryError
        ? 'La firma se guardó para todas las visitas. El reporte firmado quedó pendiente de reenvío automático.'
        : 'La firma se guardó para todas las visitas y el reporte actualizado fue enviado al correo del cliente y al Chat de boletas.';

    return {
      signed: true,
      alreadySigned: false,
      request: signed.request,
      ticket: publicTicketView(group),
      delivery,
      deliveryState: finalized ? (delivery?.notificationState || 'ERROR') : 'ESPERANDO_FINALIZACION',
      deliveryError,
      message,
    };
  },
};
