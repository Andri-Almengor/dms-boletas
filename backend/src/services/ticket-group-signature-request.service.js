import {
  applyPublicSignature as applySingleSignature,
  ensureSignatureRequestForTicket as ensureSingleRequest,
  findSignatureRequestByToken,
  signatureRequestView,
  ticketHasSignature,
  updateSignatureDelivery,
} from './ticket-signature-request.service.js';
import {
  applySignatureToVisitGroup,
  ensureVisitGroupForTicket,
  synchronizeVisitGroupSignature,
  ticketHasStoredSignature,
} from './ticket-visit-group.service.js';

export { findSignatureRequestByToken, signatureRequestView, updateSignatureDelivery };

export async function visitGroupHasSignature(ticketId) {
  const group = await ensureVisitGroupForTicket(ticketId);
  return group.visits.some(ticketHasStoredSignature);
}

export async function ensureSignatureRequestForTicket({ ticketId, origin = '', actor = 'SISTEMA' }) {
  let group = await ensureVisitGroupForTicket(ticketId, actor);
  if (group.visits.some(ticketHasStoredSignature)) {
    group = await synchronizeVisitGroupSignature(group.rootId, actor);
    const signed = group.visits.find(ticketHasStoredSignature) || group.root;
    return {
      id: '',
      token: '',
      ticketUid: group.rootId,
      ticketNumber: group.visits.map((visit) => visit.BoletaID || visit.BoletaUID).join(', '),
      clientId: signed.ClienteID || group.root.ClienteID || '',
      clientName: signed.Cliente || group.root.Cliente || 'Cliente',
      ticketTitle: group.root.Titulo || 'Seguimiento de servicio',
      clientEmail: signed.CorreoCliente || group.root.CorreoCliente || '',
      url: '',
      status: 'FIRMADA',
      signedAt: signed.FirmaFecha || signed.FechaActualizacion || '',
      groupId: group.id,
      rootId: group.rootId,
      visitCount: group.visits.length,
    };
  }

  const request = await ensureSingleRequest({
    ticketId: group.rootId,
    origin,
    actor,
  });
  return {
    ...request,
    groupId: group.id,
    rootId: group.rootId,
    ticketNumber: group.visits.map((visit) => visit.BoletaID || visit.BoletaUID).join(', '),
    visitCount: group.visits.length,
  };
}

export async function applyPublicSignature({ token, base64, mimeType = 'image/png' }) {
  const signed = await applySingleSignature({ token, base64, mimeType });
  const ticketId = signed.ticket?.BoletaUID || signed.request?.ticketUid;
  if (!ticketId || signed.alreadySigned) {
    if (ticketId) await synchronizeVisitGroupSignature(ticketId, 'CLIENTE').catch(() => {});
    return signed;
  }

  const group = await applySignatureToVisitGroup(ticketId, {
    fileId: signed.file?.id || signed.ticket?.FirmaArchivoID || '',
    url: signed.file?.webViewLink || signed.ticket?.FirmaURL || '',
    mimeType: signed.file?.mimeType || mimeType,
    origin: 'ENLACE_CLIENTE_GRUPO',
    signedAt: signed.request?.signedAt || signed.ticket?.FirmaFecha,
  }, 'CLIENTE');

  return {
    ...signed,
    ticket: group.root,
    group,
  };
}

export { ticketHasSignature };
