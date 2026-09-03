export const EVIDENCE_IMAGE_COMPRESSION_QUALITY = 0.92;
export const EVIDENCE_IMAGE_MAX_DIMENSION = 2560;
export const EVIDENCE_IMAGE_COMPRESSION_MIN_BYTES = 512 * 1024;

const OPTIMIZABLE_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/webp', 'image/png']);
const SKIPPED_EXTENSIONS = new Set(['gif', 'heic', 'heif', 'svg']);

function extension(name = '') {
  const parts = String(name || '').toLowerCase().split('.');
  return parts.length > 1 ? parts.pop() : '';
}

function normalizedMimeType(file = {}) {
  return String(file.type || '').trim().toLowerCase();
}

function canUseCanvasCompression(file) {
  if (!(file instanceof Blob)) return false;
  if (Number(file.size || 0) < EVIDENCE_IMAGE_COMPRESSION_MIN_BYTES) return false;
  if (SKIPPED_EXTENSIONS.has(extension(file.name))) return false;
  if (!OPTIMIZABLE_MIME_TYPES.has(normalizedMimeType(file))) return false;
  return typeof document !== 'undefined' && typeof URL !== 'undefined';
}

function targetDimensions(width, height) {
  const largestSide = Math.max(width, height);
  if (!Number.isFinite(largestSide) || largestSide <= 0 || largestSide <= EVIDENCE_IMAGE_MAX_DIMENSION) {
    return { width, height };
  }
  const scale = EVIDENCE_IMAGE_MAX_DIMENSION / largestSide;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function decodeWithImageBitmap(file) {
  if (typeof globalThis.createImageBitmap !== 'function') return null;
  try {
    const bitmap = await globalThis.createImageBitmap(file, { imageOrientation: 'from-image' });
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close?.(),
    };
  } catch {
    return null;
  }
}

function decodeWithImageElement(file) {
  if (typeof globalThis.Image !== 'function' || typeof URL?.createObjectURL !== 'function') return Promise.resolve(null);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new globalThis.Image();
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      image.onload = null;
      image.onerror = null;
      resolve(value);
    };
    image.onload = () => finish({
      source: image,
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      release: () => URL.revokeObjectURL(url),
    });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      finish(null);
    };
    image.src = url;
  });
}

async function decodeImage(file) {
  return (await decodeWithImageBitmap(file)) || decodeWithImageElement(file);
}

function canvasToBlob(canvas, mimeType) {
  return new Promise((resolve) => {
    try {
      canvas.toBlob(
        (blob) => resolve(blob),
        mimeType,
        mimeType === 'image/png' ? undefined : EVIDENCE_IMAGE_COMPRESSION_QUALITY,
      );
    } catch {
      resolve(null);
    }
  });
}

function compressedFile(blob, original) {
  try {
    return new File([blob], original.name, {
      type: blob.type || original.type,
      lastModified: Number(original.lastModified || Date.now()),
    });
  } catch {
    return original;
  }
}

/**
 * Optimiza fotografías antes de subirlas sin cambiar el flujo de evidencias.
 * - Calidad conservadora: 92 % para JPEG/WebP.
 * - Lado mayor máximo: 2560 px.
 * - PNG conserva su formato y transparencia.
 * - GIF/HEIC/HEIF y archivos pequeños se mantienen intactos.
 * - Si el resultado no pesa menos, se conserva el original.
 */
export async function compressEvidenceImage(file) {
  if (!canUseCanvasCompression(file)) return file;

  const decoded = await decodeImage(file);
  if (!decoded?.source || !decoded.width || !decoded.height) return file;

  try {
    const dimensions = targetDimensions(decoded.width, decoded.height);
    const canvas = document.createElement('canvas');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext('2d');
    if (!context) return file;

    context.drawImage(decoded.source, 0, 0, dimensions.width, dimensions.height);
    const outputMimeType = normalizedMimeType(file) === 'image/jpg' ? 'image/jpeg' : normalizedMimeType(file);
    const blob = await canvasToBlob(canvas, outputMimeType);
    if (!blob?.size || blob.size >= Number(file.size || 0)) return file;

    return compressedFile(blob, file);
  } catch {
    return file;
  } finally {
    decoded.release?.();
  }
}
