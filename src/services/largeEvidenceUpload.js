import { fileToBase64 } from '../utils/fileEncoding';
import { MODULE_ROUTES, requestAvailable } from './moduleApi';

export const LARGE_EVIDENCE_THRESHOLD_BYTES = 30 * 1024 * 1024;

function requestOptions(signal) {
  return signal ? { signal } : {};
}

function assertOnline() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('Los videos mayores de 30 MB necesitan conexión a internet para cargarse de forma segura.');
  }
}

export function shouldUseLargeEvidenceUpload(item = {}) {
  const mediaType = String(item.mediaType || '').toLowerCase();
  const size = Number(item.size || item.file?.size || 0);
  return mediaType === 'video' && size > LARGE_EVIDENCE_THRESHOLD_BYTES;
}

async function uploadByChunks({ initRoutes, chunkRoutes, initPayload, file, sessionToken, signal, onProgress }) {
  assertOnline();
  const init = await requestAvailable(initRoutes, initPayload, sessionToken, requestOptions(signal));
  if (init?.complete) return init.evidence || init;

  const uploadToken = String(init?.uploadToken || '');
  const chunkBytes = Math.max(256 * 1024, Number(init?.chunkBytes || 8 * 1024 * 1024));
  if (!uploadToken) throw new Error('El servidor no devolvió una sesión para cargar el video.');

  let offset = 0;
  while (offset < file.size) {
    if (signal?.aborted) {
      const error = new Error('La carga del video fue cancelada.');
      error.name = 'AbortError';
      throw error;
    }
    assertOnline();
    const end = Math.min(file.size, offset + chunkBytes);
    const chunk = file.slice(offset, end, file.type || initPayload.mimeType || 'application/octet-stream');
    let base64 = await fileToBase64(chunk, { signal });
    try {
      const result = await requestAvailable(chunkRoutes, {
        uploadToken,
        offset,
        base64,
      }, sessionToken, requestOptions(signal));
      if (result?.complete) {
        onProgress?.(100);
        return result.evidence || result;
      }
      const nextOffset = Number(result?.nextOffset);
      offset = Number.isFinite(nextOffset) && nextOffset > offset ? nextOffset : end;
      onProgress?.(Math.min(99, Math.round((offset / file.size) * 100)));
    } finally {
      base64 = '';
    }
  }

  throw new Error('La carga del video terminó sin confirmación de Google Drive.');
}

export function uploadLargeTicketEvidence({ boletaUid, evidenceId, item, sessionToken, signal, onProgress }) {
  return uploadByChunks({
    initRoutes: MODULE_ROUTES.tickets.largeEvidenceInit,
    chunkRoutes: MODULE_ROUTES.tickets.largeEvidenceChunk,
    file: item.file,
    sessionToken,
    signal,
    onProgress,
    initPayload: {
      boletaUid,
      evidenciaId: evidenceId,
      EvidenciaID: evidenceId,
      nombre: item.name || item.file.name,
      nota: item.note,
      fileName: item.file.name,
      mimeType: item.mimeType || item.file.type,
      mediaType: item.mediaType,
      durationSeconds: Number(item.durationSeconds || 0),
      size: Number(item.size || item.file.size || 0),
    },
  });
}

export function uploadLargeMaintenanceEvidence({ maintenanceId, deviceId, imageId, item, sessionToken, signal, onProgress }) {
  return uploadByChunks({
    initRoutes: MODULE_ROUTES.maintenance.largeImageInit,
    chunkRoutes: MODULE_ROUTES.maintenance.largeImageChunk,
    file: item.file,
    sessionToken,
    signal,
    onProgress,
    initPayload: {
      maintenanceId,
      deviceId,
      imageId,
      FotoDispositivoID: imageId,
      Tipo: item.type,
      Nota: item.note,
      fileName: item.file.name,
      mimeType: item.mimeType || item.file.type,
      mediaType: item.mediaType,
      durationSeconds: Number(item.durationSeconds || 0),
      size: Number(item.size || item.file.size || 0),
    },
  });
}
