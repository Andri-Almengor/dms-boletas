import { pick } from '../core/utils.js';
import { notFound } from '../core/errors.js';
import { findById } from '../infra/sheets.repository.js';
import { ticketDeliveryHandlers } from '../modules/ticket-delivery.module.js';
import { maintenanceProgressChatHandlers } from '../modules/maintenance-progress-chat.module.js';
import { createProtectedMediaStreamUrl } from './protected-media-stream.service.js';

const INSTALL_FLAG = Symbol.for('dms.protectedMediaStream');

function clean(value) {
  return String(value ?? '').trim();
}

function isVideo(row = {}) {
  return clean(row.TipoMedio).toUpperCase() === 'VIDEO'
    || clean(row.MimeType).toLowerCase().startsWith('video/');
}

function ticketStreamResult(row) {
  const fileId = clean(pick(row, ['ArchivoID', 'ArchivoFileID', 'DriveFileID']));
  if (!fileId) throw notFound('La evidencia no tiene un archivo asociado.');
  return {
    mediaId: row.EvidenciaID,
    kind: 'evidence',
    fileId,
    mimeType: row.MimeType || 'video/mp4',
    streamUrl: createProtectedMediaStreamUrl({ fileId, mimeType: row.MimeType || 'video/mp4' }),
  };
}

function maintenanceStreamResult(row) {
  const fileId = clean(pick(row, ['DriveFileID', 'ArchivoID', 'ArchivoFileID']));
  if (!fileId) throw notFound('La evidencia no tiene un archivo asociado.');
  return {
    FotoDispositivoID: row.FotoDispositivoID,
    fileId,
    mimeType: row.MimeType || 'video/mp4',
    streamUrl: createProtectedMediaStreamUrl({ fileId, mimeType: row.MimeType || 'video/mp4' }),
  };
}

if (!ticketDeliveryHandlers[INSTALL_FLAG]) {
  const originalMediaGet = ticketDeliveryHandlers.mediaGet;
  ticketDeliveryHandlers.mediaGet = async (ctx) => {
    const evidenceId = clean(pick(ctx.payload, ['evidenciaId', 'EvidenciaID', 'mediaId', 'id']));
    if (evidenceId) {
      const row = await findById('EvidenciasBoleta', evidenceId);
      const boletaUid = clean(pick(ctx.payload, ['boletaUid', 'BoletaUID']));
      if (boletaUid && clean(row.BoletaUID) !== boletaUid) {
        throw notFound('La evidencia no pertenece a la boleta solicitada.');
      }
      if (isVideo(row)) return ticketStreamResult(row);
    }
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
      if (isVideo(row)) return maintenanceStreamResult(row);
    }
    return originalMediaGet(ctx);
  };
  maintenanceProgressChatHandlers[INSTALL_FLAG] = true;
}
