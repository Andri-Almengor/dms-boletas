const MEDIA_REFERENCE_PREFIX = 'dms-offline-media://';

const BLOB_BACKED_KINDS = Object.freeze(new Set([
  'maintenanceImage',
  'ticketEvidence',
  'ticketSignature',
]));

const ENTITY_ID_KEYS = Object.freeze({
  maintenanceImage: ['imageId', 'FotoDispositivoID', 'id'],
  ticketEvidence: ['evidenciaId', 'EvidenciaID', 'id'],
  ticketSignature: ['boletaUid', 'BoletaUID', 'id'],
});

function pick(object, keys, fallback = '') {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return fallback;
}

function normalizeBase64(value = '') {
  const text = String(value || '').trim();
  const match = text.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.*)$/s);
  return {
    base64: match ? match[2] : text,
    mimeType: match?.[1] || '',
  };
}

export function isBlobBackedOfflineKind(kind) {
  return BLOB_BACKED_KINDS.has(String(kind || ''));
}

export function offlineMediaReference(mediaId) {
  const id = String(mediaId || '').trim();
  return id ? `${MEDIA_REFERENCE_PREFIX}${encodeURIComponent(id)}` : '';
}

export function offlineMediaIdFromReference(value) {
  const text = String(value || '');
  if (!text.startsWith(MEDIA_REFERENCE_PREFIX)) return '';
  try {
    return decodeURIComponent(text.slice(MEDIA_REFERENCE_PREFIX.length));
  } catch {
    return text.slice(MEDIA_REFERENCE_PREFIX.length);
  }
}

export function isOfflineMediaReference(value) {
  return Boolean(offlineMediaIdFromReference(value));
}

export function isInlineBase64(value) {
  const text = String(value || '').trim();
  return Boolean(text && (/^data:[^;,]+(?:;charset=[^;,]+)?;base64,/i.test(text) || /^[A-Za-z0-9+/=\r\n]+$/.test(text)));
}

export function offlineMediaEntityId(kind, payload = {}) {
  return String(pick(payload, ENTITY_ID_KEYS[kind] || ['id']));
}

export function offlineMediaId(payload = {}) {
  return String(pick(payload, ['offlineMediaId', 'OfflineMediaID', 'mediaId']));
}

export function stripInlineMediaPayload(payload = {}, mediaId = '') {
  const next = {
    ...payload,
    offlineMediaId: String(mediaId || offlineMediaId(payload)),
    OfflineMediaID: String(mediaId || offlineMediaId(payload)),
    offlineMediaStored: true,
  };
  delete next.base64;
  delete next.dataUrl;
  delete next.fileBase64;
  return next;
}

export function createOfflineMediaRecord(kind, payload = {}, blob, mediaId) {
  const id = String(mediaId || offlineMediaId(payload));
  return {
    mediaId: id,
    entityId: offlineMediaEntityId(kind, payload),
    kind: String(kind || ''),
    maintenanceId: String(pick(payload, ['maintenanceId', 'MantenimientoID', 'MantenimientoRef'])),
    deviceId: String(pick(payload, ['deviceId', 'DispositivoMantenimientoRef', 'EvidenciaMantenimientoID'])),
    fileName: String(pick(payload, ['fileName', 'NombreArchivo', 'Nombre'], 'evidencia')),
    mimeType: String(blob?.type || pick(payload, ['mimeType', 'MimeType'], 'application/octet-stream')),
    size: Number(blob?.size || 0),
    blob,
    status: 'PENDING',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function base64ToBlob(value, fallbackMimeType = 'application/octet-stream') {
  const normalized = normalizeBase64(value);
  const mimeType = normalized.mimeType || fallbackMimeType || 'application/octet-stream';
  const binary = globalThis.atob(normalized.base64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType });
}

export async function blobToBase64(blob) {
  if (!(blob instanceof Blob)) throw new TypeError('El archivo offline no contiene un Blob válido.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = '';
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return globalThis.btoa(binary);
}

export async function optimizeOfflineImageBlob(blob, options = {}) {
  if (!(blob instanceof Blob) || !String(blob.type || '').toLowerCase().startsWith('image/')) return blob;
  if (['image/gif', 'image/svg+xml'].includes(String(blob.type || '').toLowerCase())) return blob;
  if (typeof globalThis.createImageBitmap !== 'function') return blob;

  const maxDimension = Math.max(640, Number(options.maxDimension || 1920));
  const quality = Math.min(0.95, Math.max(0.55, Number(options.quality || 0.82)));
  let bitmap;
  try {
    bitmap = await globalThis.createImageBitmap(blob);
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = longest > maxDimension ? maxDimension / longest : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    if (scale === 1 && blob.size < 1_500_000) return blob;

    let optimized = null;
    const inputType = String(blob.type || '').toLowerCase();
    const outputType = ['image/jpeg', 'image/png', 'image/webp'].includes(inputType) ? inputType : 'image/jpeg';
    if (typeof globalThis.OffscreenCanvas === 'function') {
      const canvas = new globalThis.OffscreenCanvas(width, height);
      canvas.getContext('2d', { alpha: false })?.drawImage(bitmap, 0, 0, width, height);
      optimized = await canvas.convertToBlob({ type: outputType, quality });
    } else if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d', { alpha: false })?.drawImage(bitmap, 0, 0, width, height);
      optimized = await new Promise((resolve) => canvas.toBlob(resolve, outputType, quality));
    }
    return optimized?.size && optimized.size < blob.size ? optimized : blob;
  } catch {
    return blob;
  } finally {
    bitmap?.close?.();
  }
}

export async function hydrateMediaPayload(payload = {}, mediaRecord = null) {
  if (!mediaRecord?.blob) return { ...payload };
  const next = {
    ...payload,
    base64: await blobToBase64(mediaRecord.blob),
    mimeType: payload.mimeType || payload.MimeType || mediaRecord.mimeType || mediaRecord.blob.type,
    fileName: payload.fileName || payload.NombreArchivo || mediaRecord.fileName,
  };
  delete next.offlineMediaId;
  delete next.OfflineMediaID;
  delete next.offlineMediaStored;
  return next;
}
