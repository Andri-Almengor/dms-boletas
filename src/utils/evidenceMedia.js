export const EVIDENCE_VIDEO_MAX_SECONDS = 90;
export const EVIDENCE_IMAGE_MAX_BYTES = 15 * 1024 * 1024;
export const EVIDENCE_VIDEO_MAX_BYTES = 17 * 1024 * 1024;
export const EVIDENCE_DOCUMENT_MAX_BYTES = 15 * 1024 * 1024;

const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'm4v', 'webm']);
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif']);
const DOCUMENT_EXTENSIONS = new Set(['pdf', 'doc', 'docx']);

function extension(name = '') {
  const parts = String(name || '').toLowerCase().split('.');
  return parts.length > 1 ? parts.pop() : '';
}

export function inferEvidenceMimeType(file = {}) {
  const direct = String(file.type || file.mimeType || file.MimeType || '').trim().toLowerCase();
  if (direct) return direct;
  const ext = extension(file.name || file.fileName || file.NombreArchivo || file.Nombre);
  if (ext === 'mp4' || ext === 'm4v') return 'video/mp4';
  if (ext === 'mov') return 'video/quicktime';
  if (ext === 'webm') return 'video/webm';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'heic') return 'image/heic';
  if (ext === 'heif') return 'image/heif';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'doc') return 'application/msword';
  if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return 'application/octet-stream';
}

export function evidenceMediaKind(value = {}) {
  const mimeType = inferEvidenceMimeType(value);
  const ext = extension(value.name || value.fileName || value.NombreArchivo || value.Nombre);
  if (mimeType.startsWith('video/') || VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (mimeType.startsWith('image/') || IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (DOCUMENT_EXTENSIONS.has(ext) || mimeType === 'application/pdf' || mimeType.includes('word')) return 'document';
  return 'other';
}

export function isVideoEvidence(value = {}) {
  return evidenceMediaKind(value) === 'video';
}

export function createEvidencePreviewUrl(file) {
  return file instanceof Blob ? URL.createObjectURL(file) : '';
}

export function releaseEvidencePreviewUrl(value = '') {
  if (String(value || '').startsWith('blob:')) URL.revokeObjectURL(value);
}

export function readVideoDuration(file, timeoutMs = 12_000) {
  return new Promise((resolve, reject) => {
    if (!(file instanceof Blob)) {
      reject(new Error('No se pudo leer el video seleccionado.'));
      return;
    }

    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      callback();
    };
    const timer = window.setTimeout(() => finish(() => reject(new Error(`No se pudo comprobar que el video dure máximo ${EVIDENCE_VIDEO_MAX_SECONDS} segundos.`))), timeoutMs);

    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => {
      const duration = Number(video.duration || 0);
      if (!Number.isFinite(duration) || duration <= 0) {
        finish(() => {
          reject(new Error('No se pudo determinar la duración del video.'));
        });
        return;
      }
      finish(() => resolve(Math.round(duration * 100) / 100));
    };
    video.onerror = () => finish(() => reject(new Error('El formato del video no se pudo leer en este dispositivo. Use MP4, MOV o WebM.')));
    video.src = url;
  });
}

export async function validateEvidenceFile(file, { allowDocuments = false } = {}) {
  const name = String(file?.name || 'archivo');
  const mimeType = inferEvidenceMimeType(file);
  const mediaType = evidenceMediaKind({ ...file, mimeType });
  const size = Number(file?.size || 0);

  if (mediaType === 'video') {
    if (size > EVIDENCE_VIDEO_MAX_BYTES) {
      throw new Error(`El video ${name} supera el límite de 17 MB.`);
    }
    const durationSeconds = await readVideoDuration(file);
    if (durationSeconds > EVIDENCE_VIDEO_MAX_SECONDS + 0.25) {
      throw new Error(`El video ${name} dura ${Math.ceil(durationSeconds)} segundos. El máximo permitido es ${EVIDENCE_VIDEO_MAX_SECONDS} segundos.`);
    }
    return { mimeType, mediaType, durationSeconds, size };
  }

  if (mediaType === 'image') {
    if (size > EVIDENCE_IMAGE_MAX_BYTES) {
      throw new Error(`La imagen ${name} supera el límite de 15 MB.`);
    }
    return { mimeType, mediaType, durationSeconds: 0, size };
  }

  if (allowDocuments && mediaType === 'document') {
    if (size > EVIDENCE_DOCUMENT_MAX_BYTES) {
      throw new Error(`El archivo ${name} supera el límite de 15 MB.`);
    }
    return { mimeType, mediaType, durationSeconds: 0, size };
  }

  throw new Error(allowDocuments
    ? `El archivo ${name} no es compatible. Use una imagen, un video MP4/MOV/WebM de hasta 1 minuto y 30 segundos, PDF o Word.`
    : `El archivo ${name} no es compatible. Use una imagen o un video MP4/MOV/WebM de hasta 1 minuto y 30 segundos.`);
}

export async function prepareEvidenceFiles(files = [], options = {}) {
  const prepared = [];
  for (const file of files) {
    const metadata = await validateEvidenceFile(file, options);
    prepared.push({ file, ...metadata });
  }
  return prepared;
}
