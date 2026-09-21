import { nowIso } from '../core/utils.js';
import { trashFile } from '../infra/drive.repository.js';
import {
  findRows,
  updateRow,
  updateRows,
  withTransaction,
} from '../infra/sheets.repository.js';
import {
  applyPublicSignature as applySingleSignature,
  ensureSignatureRequestForTicket as ensureSingleRequest,
  ensureSignatureStorage,
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

function clean(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

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

export async function resetVisitGroupSignature({
  ticketId,
  origin = '',
  actor = 'SISTEMA',
}) {
  await ensureSignatureStorage();
  const group = await ensureVisitGroupForTicket(ticketId, actor);
  const signatureFileIds = [...new Set(group.visits
    .map((visit) => clean(visit.FirmaArchivoID || visit.FirmaFileID))
    .filter(Boolean))];
  const requests = (await findRows(
    'FirmaSolicitudes',
    { BoletaUID: group.rootId },
    { limit: 5000 },
  )).sort((left, right) => String(right.FechaCreacion || '').localeCompare(String(left.FechaCreacion || '')));
  const reusableRequest = requests.find((row) => clean(row.Token)) || null;
  const timestamp = nowIso();
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

  await withTransaction(async () => {
    await updateRows('Boletas', group.visits.map((visit) => ({
      idValue: visit.BoletaUID,
      patch: {
        FirmaArchivoID: '',
        FirmaURL: '',
        FirmaMimeType: '',
        FirmaOrigen: '',
        FirmaFecha: '',
        EstadoEntregaFirma: 'ESPERANDO_FIRMA',
        UltimoErrorEntregaFirma: '',
        FirmaReenviadaEn: '',
        Version: Number(visit.Version || 0) + 1,
        ActualizadoPor: actor,
        FechaActualizacion: timestamp,
      },
    })));

    if (reusableRequest) {
      await updateRow('FirmaSolicitudes', reusableRequest.SolicitudFirmaID, {
        Estado: 'PENDIENTE',
        FirmaArchivoID: '',
        FirmaURL: '',
        FechaFirma: '',
        FechaExpiracion: expiresAt,
        EstadoEntrega: '',
        ErrorEntrega: '',
        PDFURLFirmado: '',
        ActualizadoPor: actor,
        FechaActualizacion: timestamp,
      });
    }
  });

  const request = await ensureSingleRequest({
    ticketId: group.rootId,
    origin,
    actor,
  });

  for (const fileId of signatureFileIds) {
    await trashFile(fileId).catch((error) => {
      console.warn(`[ticket-signature-reset:${group.rootId}] No se pudo enviar la firma anterior a la papelera de Drive: ${String(error?.message || error)}`);
    });
  }

  const refreshedGroup = await ensureVisitGroupForTicket(group.rootId, actor);
  return {
    group: refreshedGroup,
    request,
    previousSignatureFileIds: signatureFileIds,
    reusedLink: Boolean(reusableRequest && clean(reusableRequest.Token) === clean(request?.token)),
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
