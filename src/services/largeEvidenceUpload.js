import { fileToBase64 } from '../utils/fileEncoding';
import { requestAvailable } from './moduleApi';

export const LARGE_EVIDENCE_THRESHOLD_BYTES = 256 * 1024;
const TICKET_LARGE_INIT_ROUTES = ['boletas.evidence.large.init', 'tickets.evidence.large.init'];
const TICKET_LARGE_CHUNK_ROUTES = ['boletas.evidence.large.chunk', 'tickets.evidence.large.chunk'];
const MAINTENANCE_LARGE_INIT_ROUTES = ['maintenance.images.large.init', 'mantenimientos.imagenes.grande.iniciar'];
const MAINTENANCE_LARGE_CHUNK_ROUTES = ['maintenance.images.large.chunk', 'mantenimientos.imagenes.grande.bloque'];

function requestOptions(signal) {
  return signal ? { signal } : {};
}

function assertOnline() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('Las cargas por bloques necesitan conexión a internet para cargarse de forma segura.');
  }
}

export function shouldUseLargeEvidenceUpload(item = {}) {
  const size = Number(item.size || item.file?.size || 0);
  const online = typeof navigator === 'undefined' || navigator.onLine !== false;
  const previouslyRequiredOnline = String(item.mediaType || '').toLowerCase() === 'video' && size > 30 * 1024 * 1024;
  return previouslyRequiredOnline || (online && size > LARGE_EVIDENCE_THRESHOLD_BYTES);
}

async function uploadByChunks({ initRoutes, chunkRoutes, initPayload, file, sessionToken, signal, onProgress, chunkPayload = {} }) {
  assertOnline();
  const init = await requestAvailable(initRoutes, initPayload, sessionToken, requestOptions(signal));
  if (init?.complete) return init.evidence || init;

  const uploadToken = String(init?.uploadToken || '');
  const chunkBytes = Math.max(256 * 1024, Math.min(256 * 1024, Number(init?.chunkBytes || 256 * 1024)));
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
        ...chunkPayload,
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
    initRoutes: TICKET_LARGE_INIT_ROUTES,
    chunkRoutes: TICKET_LARGE_CHUNK_ROUTES,
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
    initRoutes: MAINTENANCE_LARGE_INIT_ROUTES,
    chunkRoutes: MAINTENANCE_LARGE_CHUNK_ROUTES,
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

export function uploadLargeKnowledgeAttachment({ tutorialId, file, sessionToken, signal }) {
  const routes = ['knowledge.attachments.upload', 'baseConocimientos.adjuntos.upload', 'conocimiento.adjuntos.upload'];
  return uploadByChunks({initRoutes:routes,chunkRoutes:routes,file,sessionToken,signal,
    initPayload:{tutorialId,uploadPhase:'init',fileName:file.name,nombre:file.name,mimeType:file.type || 'application/octet-stream',size:file.size},
    chunkPayload:{tutorialId,uploadPhase:'chunk'},
  });
}
