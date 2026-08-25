import { badRequest } from '../core/errors.js';

export const EVIDENCE_VIDEO_MAX_SECONDS = 90;
export const EVIDENCE_IMAGE_MAX_BYTES = 15 * 1024 * 1024;
export const EVIDENCE_VIDEO_MAX_BYTES = 300 * 1024 * 1024;
export const EVIDENCE_DOCUMENT_MAX_BYTES = 15 * 1024 * 1024;

const VIDEO_MIME_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v']);
const DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

function clean(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function extension(value = '') {
  const parts = clean(value).toLowerCase().split('.');
  return parts.length > 1 ? parts.pop() : '';
}

function inferredMimeType(payload = {}) {
  const direct = clean(payload.mimeType || payload.MimeType).toLowerCase();
  if (direct) return direct;
  const ext = extension(payload.fileName || payload.NombreArchivo || payload.Nombre);
  if (['mp4', 'm4v'].includes(ext)) return 'video/mp4';
  if (ext === 'mov') return 'video/quicktime';
  if (ext === 'webm') return 'video/webm';
  if (['jpg', 'jpeg'].includes(ext)) return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'doc') return 'application/msword';
  if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return 'application/octet-stream';
}

function estimatedBytes(payload = {}) {
  const explicit = Number(payload.size || payload.bytes || payload.Size || payload.TamanoBytes || 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const base64 = clean(payload.base64).replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  if (!base64) return 0;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

export function evidenceMediaType(payload = {}) {
  const mimeType = inferredMimeType(payload);
  if (mimeType.startsWith('video/') || VIDEO_MIME_TYPES.has(mimeType)) return 'VIDEO';
  if (mimeType.startsWith('image/')) return 'IMAGEN';
  if (DOCUMENT_MIME_TYPES.has(mimeType)) return 'DOCUMENTO';
  return 'OTRO';
}

export function validateEvidenceMediaPayload(payload = {}, { allowDocuments = false, index = 0, requireData = true } = {}) {
  const fileName = clean(payload.fileName || payload.NombreArchivo || payload.Nombre, `evidencia-${index + 1}`);
  const mimeType = inferredMimeType(payload);
  const mediaType = evidenceMediaType({ ...payload, mimeType });
  const size = estimatedBytes(payload);
  const durationSeconds = Number(payload.durationSeconds || payload.DuracionSegundos || 0);

  if (requireData && !clean(payload.base64)) throw badRequest(`La evidencia ${fileName} no contiene datos para cargar.`);

  if (mediaType === 'VIDEO') {
    if (!VIDEO_MIME_TYPES.has(mimeType)) {
      throw badRequest(`El video ${fileName} no tiene un formato compatible. Use MP4, MOV o WebM.`);
    }
    if (size > EVIDENCE_VIDEO_MAX_BYTES) throw badRequest(`El video ${fileName} supera el límite de 300 MB.`);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw badRequest(`No se pudo validar la duración del video ${fileName}. Selecciónelo nuevamente desde la aplicación.`);
    }
    if (durationSeconds > EVIDENCE_VIDEO_MAX_SECONDS + 0.25) {
      throw badRequest(`El video ${fileName} supera el máximo de ${EVIDENCE_VIDEO_MAX_SECONDS} segundos.`);
    }
  } else if (mediaType === 'IMAGEN') {
    if (size > EVIDENCE_IMAGE_MAX_BYTES) throw badRequest(`La imagen ${fileName} supera el límite de 15 MB.`);
  } else if (allowDocuments && mediaType === 'DOCUMENTO') {
    if (size > EVIDENCE_DOCUMENT_MAX_BYTES) throw badRequest(`El archivo ${fileName} supera el límite de 15 MB.`);
  } else {
    throw badRequest(allowDocuments
      ? `La evidencia ${fileName} no es compatible. Use una imagen, un video MP4/MOV/WebM de hasta 1 minuto y 30 segundos, PDF o Word.`
      : `La evidencia ${fileName} no es compatible. Use una imagen o un video MP4/MOV/WebM de hasta 1 minuto y 30 segundos.`);
  }

  return {
    mimeType,
    mediaType,
    durationSeconds: mediaType === 'VIDEO' ? Math.round(durationSeconds * 100) / 100 : 0,
    size,
  };
}

export function normalizeMacAddress(value = '') {
  const raw = clean(value);
  if (!raw) return '';
  const compact = raw.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
  if (compact.length !== 12 || !/^[A-F0-9]{12}$/.test(compact)) {
    throw badRequest('La dirección MAC no es válida. Use el formato AA:BB:CC:DD:EE:FF.');
  }
  return compact.match(/.{2}/g).join(':');
}
