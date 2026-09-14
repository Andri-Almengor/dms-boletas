import { pick } from '../core/utils.js';
import { notFound } from '../core/errors.js';
import { findById } from '../infra/sheets.repository.js';
import { ticketDeliveryHandlers } from '../modules/ticket-delivery.module.js';
import { ticketAccessHandlers } from '../modules/ticket-access.module.js';
import { maintenanceProgressChatHandlers } from '../modules/maintenance-progress-chat.module.js';
import { createProtectedMediaStreamUrl } from './protected-media-stream.service.js';

const INSTALL_FLAG = Symbol.for('dms.protectedMediaStream');

function clean(value) {
  return String(value ?? '').trim();
}

function isActive(row) {
  return Boolean(row) && row.Activo !== false && clean(row.Activo).toLowerCase() !== 'false';
}

function isVideo(row) {
  return Boolean(row) && (
    clean(row.TipoMedio).toUpperCase() === 'VIDEO'
    || clean(row.MimeType).toLowerCase().startsWith('video/')
  );
}

function ticketStreamResult(row, ticket, ctx, kind = 'evidence') {
  const fileId = clean(pick(row, ['ArchivoID', 'ArchivoFileID', 'DriveFileID', 'FirmaArchivoID', 'FirmaFileID']));
  if (!fileId) throw notFound(kind === 'signature' ? 'La firma no tiene un archivo asociado.' : 'La evidencia no tiene un archivo asociado.');
  const evidenceId = kind === 'signature' ? '' : clean(row.EvidenciaID);
  const mimeType = clean(row.MimeType || row.FirmaMimeType) || (kind === 'signature' ? 'image/png' : 'application/octet-stream');
  return {
    mediaId: evidenceId || clean(ticket.BoletaUID),
    kind,
    fileId,
    mimeType,
    streamUrl: createProtectedMediaStreamUrl({
      fileId,
      mimeType,
      boletaUid: ticket.BoletaUID,
      evidenceId,
      kind,
      userId: ctx.user?.UsuarioID,
      sessionToken: ctx.sessionToken,
    }),
  };
}

function maintenanceStreamResult(row, ctx) {
  const fileId = clean(pick(row, ['DriveFileID', 'ArchivoID', 'ArchivoFileID']));
  if (!fileId) throw notFound('La evidencia no tiene un archivo asociado.');
  const imageId = clean(row.FotoDispositivoID);
  const mimeType = row.MimeType || 'video/mp4';
  return {
    FotoDispositivoID: imageId,
    fileId,
    mimeType,
    streamUrl: createProtectedMediaStreamUrl({
      fileId,
      mimeType,
      boletaUid: `maintenance-media:${imageId}`,
      evidenceId: imageId,
      kind: 'maintenance-media',
      userId: ctx.user?.UsuarioID,
      sessionToken: ctx.sessionToken,
    }),
  };
}

if (!ticketDeliveryHandlers[INSTALL_FLAG]) {
  const originalMediaGet = ticketDeliveryHandlers.mediaGet;
  ticketDeliveryHandlers.mediaGet = async (ctx) => {
    const evidenceId = clean(pick(ctx.payload, ['evidenciaId', 'EvidenciaID', 'mediaId', 'id']));
    const requestedTicketId = clean(pick(ctx.payload, ['boletaUid', 'BoletaUID']));
    const requestedFileId = clean(pick(ctx.payload, ['fileId', 'ArchivoID', 'ArchivoFileID', 'DriveFileID']));
    const kind = clean(pick(ctx.payload, ['kind', 'tipo'])).toLowerCase();

    if (evidenceId) {
      const row = await findById('EvidenciasBoleta', evidenceId);
      if (!row || !isActive(row)) throw notFound('La evidencia solicitada ya no está disponible.');
      const rowTicketId = clean(row.BoletaUID);
      if (requestedTicketId && rowTicketId !== requestedTicketId) {
        throw notFound('La evidencia no pertenece a la boleta solicitada.');
      }
      const actualFileId = clean(pick(row, ['ArchivoID', 'ArchivoFileID', 'DriveFileID']));
      if (requestedFileId && actualFileId && requestedFileId !== actualFileId) {
        throw notFound('El archivo solicitado no coincide con la evidencia autorizada.');
      }
      const ticket = await findById('Boletas', rowTicketId);
      if (!ticket) throw notFound('La boleta asociada a la evidencia ya no está disponible.');
      await ticketAccessHandlers.assertTicketAccess(ctx, ticket);
      return ticketStreamResult(row, ticket, ctx, 'evidence');
    }

    if (kind === 'signature' || kind === 'firma') {
      if (!requestedTicketId) throw notFound('No fue posible identificar la boleta de la firma.');
      const ticket = await findById('Boletas', requestedTicketId);
      if (!ticket) throw notFound('La boleta solicitada ya no está disponible.');
      await ticketAccessHandlers.assertTicketAccess(ctx, ticket);
      const signatureFileId = clean(pick(ticket, ['FirmaArchivoID', 'FirmaFileID']));
      if (!signatureFileId) return originalMediaGet(ctx);
      if (requestedFileId && requestedFileId !== signatureFileId) {
        throw notFound('El archivo solicitado no coincide con la firma autorizada.');
      }
      return ticketStreamResult({
        FirmaArchivoID: signatureFileId,
        FirmaMimeType: ticket.FirmaMimeType || 'image/png',
      }, ticket, ctx, 'signature');
    }

    // Compatibilidad para registros históricos que solo envían fileId: el
    // manejador existente conserva su búsqueda y validación de pertenencia.
    return originalMediaGet(ctx);
  };
  ticketDeliveryHandlers[INSTALL_FLAG] = true;
}

if (!maintenanceProgressChatHandlers[INSTALL_FLAG]) {
  const originalMediaGet = maintenanceProgressChatHandlers.mediaGet;
  maintenanceProgressChatHandlers.mediaGet = async (ctx) => {
    const imageId = clean(pick(ctx.payload, ['imageId', 'FotoDispositivoID', 'id']));
    if (imageId) {
      const row = await findById('Mantenimiento imagenes', imageId);
      if (isVideo(row)) return maintenanceStreamResult(row, ctx);
    }
    return originalMediaGet(ctx);
  };
  maintenanceProgressChatHandlers[INSTALL_FLAG] = true;
}
