import { fileToBase64 } from '../utils/fileEncoding';
import { requestAvailable } from './moduleApi';
import { withMediaUploadPriority } from './mediaActivity';

export const LARGE_EVIDENCE_THRESHOLD_BYTES = 6 * 1024 * 1024;
export const LARGE_EVIDENCE_CHUNK_BYTES = 6 * 1024 * 1024;
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

function ticketUploadSessionKey(boletaUid, file) {
  if (!boletaUid || !file) return '';
  // Stable across a refresh followed by selecting the same local file.
  return `dms-ticket-large:${encodeURIComponent(boletaUid)}:${encodeURIComponent(file.name || '')}:${file.size}:${file.lastModified || 0}`;
}

function storedTicketSession(key) {
  if (!key) return null;
  try {
    const data = JSON.parse(sessionStorage.getItem(key) || 'null');
    return data && data.uploadToken && data.evidenceId ? data : null;
  } catch {
    return null;
  }
}

function saveTicketSession(key, data) {
  if (!key) return;
  try { sessionStorage.setItem(key, JSON.stringify(data)); } catch { /* restricted storage */ }
}

function clearTicketSession(key) {
  if (!key) return;
  try { sessionStorage.removeItem(key); } catch { /* restricted storage */ }
}

export function resumableTicketEvidenceId(boletaUid, item = {}) {
  const file = item.file;
  if (!file) return '';
  return String(storedTicketSession(ticketUploadSessionKey(boletaUid, file))?.evidenceId || '');
}

function uncertainChunkFailure(error) {
  const status = Number(error?.status || 0);
  const code = String(error?.code || '').toUpperCase();
  return [502, 503, 504].includes(status)
    || (status === 0 && ['UNKNOWN_RESULT', 'REQUEST_TIMEOUT'].includes(code));
}

export function shouldUseLargeEvidenceUpload(item = {}, {
  thresholdBytes = LARGE_EVIDENCE_THRESHOLD_BYTES,
  alwaysVideo = false,
} = {}) {
  const size = Number(item.size || item.file?.size || 0);
  const online = typeof navigator === 'undefined' || navigator.onLine !== false;
  const video = String(item.mediaType || '').toLowerCase() === 'video';
  const previouslyRequiredOnline = video && size > 30 * 1024 * 1024;
  // Online videos always use Drive resumable uploads, including 18-second
  // recordings below the old 6 MiB threshold. Offline images are unchanged.
  return previouslyRequiredOnline || (online && ((alwaysVideo && video) || size > Math.max(256 * 1024, Number(thresholdBytes) || LARGE_EVIDENCE_THRESHOLD_BYTES)));
}

async function uploadByChunks({ initRoutes, chunkRoutes, initPayload, file, sessionToken, signal, onProgress, chunkPayload = {}, ticketSessionKey = '' }) {
  return withMediaUploadPriority(async () => {
    assertOnline();
    const stored = storedTicketSession(ticketSessionKey);
    // Status probes use the existing authorized init route and signed Drive
    // token. No second upload is started while an earlier result is uncertain.
    const init = await requestAvailable(initRoutes, {
      ...initPayload,
      ...(stored?.uploadToken ? { resumeUploadToken: stored.uploadToken } : {}),
    }, sessionToken, requestOptions(signal));
    if (init?.complete) {
      clearTicketSession(ticketSessionKey);
      onProgress?.(100);
      return init.evidence || init;
    }

    const uploadToken = String(init?.uploadToken || '');
    const chunkBytes = Math.max(256 * 1024, Number(init?.chunkBytes || LARGE_EVIDENCE_CHUNK_BYTES));
    if (!uploadToken) throw new Error('El servidor no devolvió una sesión para cargar el video.');
    if (stored?.uploadToken && stored.uploadToken !== uploadToken) {
      throw new Error('La sesión del video cambió. No se repetirá una carga sin reconciliarla.');
    }
    const resume = { uploadToken, evidenceId: initPayload.evidenciaId || '' };
    saveTicketSession(ticketSessionKey, resume);
    let offset = Number(init?.nextOffset || 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > file.size) {
      throw new Error('Google Drive devolvió una posición de carga inválida.');
    }
    let unchangedProbes = 0;
    onProgress?.(Math.min(99, Math.round((offset / file.size) * 100)));

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
        let nextResult;
        try {
          nextResult = await requestAvailable(chunkRoutes, {
            ...chunkPayload, uploadToken, offset, base64,
          }, sessionToken, requestOptions(signal));
        } catch (error) {
          if (!ticketSessionKey || !uncertainChunkFailure(error)) throw error;
          // A proxy 502 does not prove Drive rejected the block. Query the
          // authoritative offset before ever sending these bytes again.
          nextResult = await requestAvailable(initRoutes, {
            ...initPayload,
            resumeUploadToken: uploadToken,
          }, sessionToken, requestOptions(signal));
        }
        if (nextResult?.complete) {
          clearTicketSession(ticketSessionKey);
          onProgress?.(100);
          return nextResult.evidence || nextResult;
        }
        const nextOffset = Number(nextResult?.nextOffset);
        if (!Number.isSafeInteger(nextOffset) || nextOffset < offset || nextOffset > file.size) {
          throw new Error('Google Drive no confirmó una posición válida para continuar la carga.');
        }
        if (nextOffset === offset) {
          unchangedProbes += 1;
          if (unchangedProbes > 2) throw new Error('Google Drive no confirmó el bloque después de varios intentos. Reintente la carga para consultar su estado.');
        } else {
          unchangedProbes = 0;
          offset = nextOffset;
        }
        onProgress?.(Math.min(99, Math.round((offset / file.size) * 100)));
      } finally {
        base64 = '';
      }
    }

    if (!ticketSessionKey) throw new Error('La carga del video terminó sin confirmación de Google Drive.');

    // If the final response was lost after Drive accepted the last block,
    // reconcile completion rather than issuing a second upload.
    const completed = await requestAvailable(initRoutes, {
      ...initPayload, resumeUploadToken: uploadToken,
    }, sessionToken, requestOptions(signal));
    if (completed?.complete) {
      clearTicketSession(ticketSessionKey);
      onProgress?.(100);
      return completed.evidence || completed;
    }
    throw new Error('La carga del video terminó sin confirmación de Google Drive. Reintente para consultar su estado.');
  });
}

export function uploadLargeTicketEvidence({ boletaUid, evidenceId, item, sessionToken, signal, onProgress }) {
  return uploadByChunks({
    initRoutes: TICKET_LARGE_INIT_ROUTES,
    chunkRoutes: TICKET_LARGE_CHUNK_ROUTES,
    file: item.file,
    sessionToken,
    signal,
    onProgress,
    ticketSessionKey: ticketUploadSessionKey(boletaUid, item.file),
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
      FechaCaptura: item.capturedAt,
      ProyectoDestinoTipo: item.projectTargetType,
      ProyectoRelacionClave: item.projectRelationKey,
      ProyectoComponenteLocalID: item.projectComponentLocalId,
      ProyectoComponenteTipoDispositivoID: item.projectComponentTypeId,
      ProyectoComponenteNombre: item.projectComponentName,
      fileName: item.file.name,
      mimeType: item.mimeType || item.file.type,
      mediaType: item.mediaType,
      durationSeconds: Number(item.durationSeconds || 0),
      size: Number(item.size || item.file.size || 0),
    },
  });
}

function knowledgeUploadStorageKey(tutorialId, attachmentId) {
  return `dms_knowledge_upload_${tutorialId}_${attachmentId}`;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timer);
      const error = new Error('La carga fue cancelada.');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  });
}

export async function uploadLargeKnowledgeAttachment({
  tutorialId,
  file,
  sessionToken,
  signal,
  onProgress,
  attachmentId,
  isPrimary = false,
  replaceAttachmentId = '',
}) {
  const routes = ['knowledge.attachments.upload', 'baseConocimientos.adjuntos.upload', 'conocimiento.adjuntos.upload'];
  const stableId = attachmentId || crypto.randomUUID?.() || `knowledge-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const storageKey = knowledgeUploadStorageKey(tutorialId, stableId);
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); } catch { saved = null; }

  let uploadToken = saved?.uploadToken || '';
  let chunkBytes = Number(saved?.chunkBytes || 0);
  let offset = 0;

  if (!uploadToken) {
    const init = await requestAvailable(routes, {
      tutorialId,
      uploadPhase: 'init',
      attachmentId: stableId,
      replaceAttachmentId,
      fileName: file.name,
      nombre: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      isPrimary,
    }, sessionToken, requestOptions(signal));
    if (init?.complete) {
      onProgress?.(100);
      return init.evidence || init;
    }
    uploadToken = String(init?.uploadToken || '');
    chunkBytes = Number(init?.chunkBytes || LARGE_EVIDENCE_CHUNK_BYTES);
    if (!uploadToken) throw new Error('El servidor no devolvió una sesión resumible para el documento.');
    sessionStorage.setItem(storageKey, JSON.stringify({ uploadToken, chunkBytes }));
  } else {
    const status = await requestAvailable(routes, {
      tutorialId,
      uploadPhase: 'status',
      uploadToken,
      replaceAttachmentId,
      isPrimary,
    }, sessionToken, requestOptions(signal));
    if (status?.complete && status?.evidence) {
      sessionStorage.removeItem(storageKey);
      onProgress?.(100);
      return status.evidence;
    }
    offset = Number(status?.nextOffset || 0);
    onProgress?.(Math.min(99, Math.round((offset / file.size) * 100)));
  }

  while (offset < file.size) {
    if (signal?.aborted) {
      const error = new Error('La carga fue cancelada.');
      error.name = 'AbortError';
      throw error;
    }
    assertOnline();
    const end = Math.min(file.size, offset + Math.max(256 * 1024, chunkBytes || LARGE_EVIDENCE_CHUNK_BYTES));
    const chunk = file.slice(offset, end, file.type || 'application/octet-stream');
    let base64 = await fileToBase64(chunk, { signal });
    let completed = null;
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const result = await requestAvailable(routes, {
            tutorialId,
            uploadPhase: 'chunk',
            uploadToken,
            offset,
            base64,
            replaceAttachmentId,
            isPrimary,
          }, sessionToken, requestOptions(signal));
          if (result?.complete) {
            completed = result.evidence || result;
            break;
          }
          const nextOffset = Number(result?.nextOffset);
          if (!Number.isSafeInteger(nextOffset) || nextOffset <= offset || nextOffset > file.size) {
            throw new Error('El servidor no confirmó el siguiente bloque del documento.');
          }
          offset = nextOffset;
          onProgress?.(Math.min(99, Math.round((offset / file.size) * 100)));
          break;
        } catch (error) {
          if (signal?.aborted || error?.name === 'AbortError') throw error;
          if (attempt >= 2) throw error;
          await sleep(300 * (2 ** attempt), signal);
          const status = await requestAvailable(routes, {
            tutorialId,
            uploadPhase: 'status',
            uploadToken,
            replaceAttachmentId,
            isPrimary,
          }, sessionToken, requestOptions(signal));
          if (status?.complete && status?.evidence) {
            completed = status.evidence;
            break;
          }
          const recoveredOffset = Number(status?.nextOffset || offset);
          if (Number.isSafeInteger(recoveredOffset) && recoveredOffset >= 0 && recoveredOffset <= file.size) {
            offset = recoveredOffset;
            if (offset !== end - chunk.size) {
              base64 = '';
              break;
            }
          }
        }
      }
    } finally {
      base64 = '';
    }
    if (completed) {
      sessionStorage.removeItem(storageKey);
      onProgress?.(100);
      return completed;
    }
  }

  throw new Error('La carga terminó sin confirmación de Google Drive.');
}

export function uploadCustomerCaseFile({token,requestId,item,signal,onProgress}) {
  return uploadByChunks({initRoutes:['customerCases.evidence.init'],chunkRoutes:['customerCases.evidence.chunk'],file:item.file,signal,onProgress,
    initPayload:{token,requestId,evidenceId:item.evidenceId,fileName:item.fileName,mimeType:item.mimeType,size:item.size},
    chunkPayload:{token,requestId},
  });
}
