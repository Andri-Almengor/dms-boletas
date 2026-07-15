import { findById } from '../infra/sheets.repository.js';
import { audit } from '../services/audit.service.js';
import { deliverSignedTicket } from '../services/ticket-delivery.service.js';
import {
  applyPublicSignature,
  ensureSignatureRequestForTicket,
  findSignatureRequestByToken,
  signatureRequestView,
  ticketHasSignature,
  updateSignatureDelivery,
} from '../services/ticket-signature-request.service.js';
import { ticketAccessHandlers } from './ticket-access.module.js';

function publicTicketView(ticket = {}) {
  return {
    uid: String(ticket.BoletaUID || ''),
    number: String(ticket.BoletaID || ticket.BoletaUID || ''),
    title: String(ticket.Titulo || 'Boleta de servicio'),
    clientName: String(ticket.Cliente || 'Cliente'),
    date: ticket.Fecha || '',
    location: [ticket.Ubicacion, ticket.UbicacionEquipo].filter(Boolean).join(' · '),
    supervisor: ticket.Supervisor || '',
    signed: ticketHasSignature(ticket),
  };
}

export const ticketSignatureHandlers = {
  link: async (ctx) => {
    const ticketId = ctx.payload.boletaUid || ctx.payload.BoletaUID || ctx.payload.id;
    const ticket = await findById('Boletas', ticketId);
    await ticketAccessHandlers.assertTicketAccess(ctx, ticket, 'consultar el enlace de firma de');
    const request = await ensureSignatureRequestForTicket({
      ticketId,
      origin: ctx.origin,
      actor: ctx.user.UsuarioID,
    });
    return {
      request,
      signed: ticketHasSignature(ticket),
      ticket: publicTicketView(ticket),
    };
  },

  publicGet: async (ctx) => {
    const requestRow = await findSignatureRequestByToken(ctx.payload.token);
    const ticket = await findById('Boletas', requestRow.BoletaUID);
    const request = signatureRequestView(requestRow);
    return {
      request,
      ticket: publicTicketView(ticket),
      alreadySigned: request.status === 'FIRMADA' || ticketHasSignature(ticket),
      expired: request.status === 'EXPIRADA',
    };
  },

  publicSubmit: async (ctx) => {
    const signed = await applyPublicSignature({
      token: ctx.payload.token,
      base64: ctx.payload.base64,
      mimeType: ctx.payload.mimeType || 'image/png',
    });

    if (signed.alreadySigned) {
      return {
        signed: true,
        alreadySigned: true,
        request: signed.request,
        ticket: publicTicketView(signed.ticket),
        message: 'La boleta ya cuenta con la firma del cliente.',
      };
    }

    const systemContext = {
      ...ctx,
      user: { UsuarioID: 'CLIENTE', Nombre: 'Cliente' },
      permissions: [],
    };

    let delivery = null;
    let deliveryError = '';
    try {
      delivery = await deliverSignedTicket(systemContext, {
        ticketId: signed.ticket.BoletaUID,
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

    await audit(systemContext, 'FIRMA_PUBLICA_BOLETA', 'Boletas', signed.ticket.BoletaUID, null, {
      FirmaArchivoID: signed.file?.id || '',
      FirmaURL: signed.file?.webViewLink || '',
      SolicitudFirmaID: signed.request.id,
      EstadoEntrega: delivery?.notificationState || 'ERROR',
      ErrorEntrega: deliveryError || delivery?.errors?.join(' | ') || '',
    }).catch(() => {});

    return {
      signed: true,
      alreadySigned: false,
      request: signed.request,
      ticket: publicTicketView(signed.ticket),
      delivery,
      deliveryState: delivery?.notificationState || 'ERROR',
      deliveryError,
      message: deliveryError
        ? 'La firma se guardó correctamente. El reporte firmado quedó pendiente de reenvío automático.'
        : 'La firma se guardó y el reporte actualizado fue enviado al correo del cliente y al Chat de boletas.',
    };
  },
};
