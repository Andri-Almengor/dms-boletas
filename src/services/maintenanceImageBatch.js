import { apiRequest } from '../api';
import { mapWithConcurrency } from '../utils/asyncPool';
import { fileToBase64, mapFilesSequentially } from '../utils/fileEncoding';
import { binaryUploadRequest, canUseBinaryUpload, isBinaryUploadUnavailable } from './binaryUploadApi';
import { shouldUseLargeEvidenceUpload, uploadLargeMaintenanceEvidence } from './largeEvidenceUpload';
import { MODULE_ROUTES, pick, requestAvailable } from './moduleApi';
import { maintenanceImageSyncBase, withSyncBase } from './maintenanceSyncBase';
import { isAbortError, isNetworkError } from './requestErrors';

const IMAGE_UPLOAD_BATCH_ROUTES = ['maintenance.images.uploadBatch', 'mantenimientos.imagenes.subirLote'];
const IMAGE_UPDATE_BATCH_ROUTES = ['maintenance.images.updateBatch', 'mantenimientos.imagenes.actualizarLote'];
const MAX_FILES_PER_REQUEST = 10;
const MAX_RAW_BYTES_PER_REQUEST = 10 * 1024 * 1024;
const MAX_METADATA_UPDATES_PER_REQUEST = 80;
const EVIDENCE_UPLOAD_CONCURRENCY = 3;

let uploadBatchAvailable = null;
let updateBatchAvailable = null;

function clean(value) {
  return String(value ?? '').trim();
}

function requestOptions(signal) {
  return signal ? { signal } : {};
}

function browserIsOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function chunkByWeight(images = []) {
  const chunks = [];
  let current = [];
  let bytes = 0;

  for (const image of images) {
    const size = Math.max(0, Number(image?.file?.size || 0));
    const mustStartNew = current.length > 0
      && (current.length >= MAX_FILES_PER_REQUEST || bytes + size > MAX_RAW_BYTES_PER_REQUEST);
    if (mustStartNew) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(image);
    bytes += size;
  }

  if (current.length) chunks.push(current);
  return chunks;
}

function chunkItems(items = [], size = MAX_METADATA_UPDATES_PER_REQUEST) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function missingRoute(error) {
  const text = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
  return text.includes('route_not_found') || text.includes('ruta no encontrada') || text.includes('unknown action');
}

async function requestOnlineAliases(routes, payload, sessionToken, signal) {
  let lastError;
  for (const route of routes) {
    try {
      return await apiRequest(route, payload, sessionToken, requestOptions(signal));
    } catch (error) {
      lastError = error;
      if (isAbortError(error) || !missingRoute(error)) throw error;
    }
  }
  throw lastError || new Error('La operación por lote no está disponible.');
}

function uploadedView(row = {}, maintenanceId = '') {
  return {
    ...row,
    id: clean(pick(row, ['FotoDispositivoID', 'id'])),
    syncBase: maintenanceImageSyncBase(row, maintenanceId),
    dirty: false,
  };
}

function imagePayload(image, base64) {
  return {
    localId: image.localId,
    imageId: image.localId,
    Tipo: image.type,
    Nota: image.note,
    fileName: image.file.name,
    mimeType: image.mimeType || image.file.type || 'image/jpeg',
    mediaType: image.mediaType || 'image',
    durationSeconds: Number(image.durationSeconds || 0),
    size: Number(image.size || image.file.size || 0),
    base64,
  };
}

function binaryImagePayload(image, maintenanceId, deviceId) {
  return {
    maintenanceId,
    deviceId,
    imageId: image.localId,
    FotoDispositivoID: image.localId,
    DispositivoMantenimientoRef: deviceId,
    Tipo: image.type,
    Nota: image.note,
    fileName: image.file.name,
    mimeType: image.mimeType || image.file.type || 'image/jpeg',
    mediaType: image.mediaType || 'image',
    durationSeconds: Number(image.durationSeconds || 0),
    size: Number(image.size || image.file.size || 0),
  };
}

function imageMetadataPayload(image, maintenanceId, deviceId) {
  return withSyncBase({
    maintenanceId,
    deviceId,
    imageId: image.id,
    Tipo: image.Tipo,
    Nota: image.Nota,
  }, image.syncBase || maintenanceImageSyncBase(image, maintenanceId));
}

async function prepareUploadChunk(images, signal) {
  return mapFilesSequentially(images, async (image) => imagePayload(
    image,
    await fileToBase64(image.file, { signal }),
  ), { signal });
}

function clearPreparedPayloads(items = []) {
  for (const item of items) item.base64 = '';
  items.length = 0;
}

async function uploadFallback({
  maintenanceId,
  deviceId,
  images,
  preparedImages = [],
  sessionToken,
  signal,
}) {
  const uploaded = [];
  const failed = [];
  const preparedByKey = new Map(preparedImages.map((item) => [clean(item.localId), item]));

  for (const image of images) {
    const prepared = preparedByKey.get(clean(image.localId));
    let base64 = prepared?.base64 || '';
    try {
      if (!base64) base64 = await fileToBase64(image.file, { signal });
      const result = await requestAvailable(MODULE_ROUTES.maintenance.imageUpload, {
        maintenanceId,
        deviceId,
        imageId: image.localId,
        Tipo: image.type,
        Nota: image.note,
        fileName: image.file.name,
        mimeType: image.mimeType || image.file.type || 'image/jpeg',
        mediaType: image.mediaType || 'image',
        durationSeconds: Number(image.durationSeconds || 0),
        size: Number(image.size || image.file.size || 0),
        base64,
      }, sessionToken, requestOptions(signal));
      uploaded.push({ ...uploadedView(result, maintenanceId), clientKey: image.localId });
    } catch (error) {
      if (isAbortError(error)) throw error;
      failed.push({ clientKey: image.localId, fileName: image.file?.name, message: error.message });
    } finally {
      base64 = '';
      if (prepared) prepared.base64 = '';
    }
  }
  return { uploaded, failed };
}

async function uploadBinaryImage({ maintenanceId, deviceId, image, sessionToken, signal }) {
  const result = await binaryUploadRequest(
    MODULE_ROUTES.maintenance.imageUpload[0],
    binaryImagePayload(image, maintenanceId, deviceId),
    image.file,
    sessionToken,
    requestOptions(signal),
  );
  return { ...uploadedView(result, maintenanceId), clientKey: image.localId };
}

async function uploadBinaryImages({ maintenanceId, deviceId, images, sessionToken, signal }) {
  if (!images.length || browserIsOffline() || !canUseBinaryUpload()) {
    return { handled: false, uploaded: [], failed: [] };
  }

  const uploaded = [];
  const failed = [];
  const [probe, ...remaining] = images;

  try {
    uploaded.push(await uploadBinaryImage({ maintenanceId, deviceId, image: probe, sessionToken, signal }));
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (isBinaryUploadUnavailable(error)) return { handled: false, uploaded: [], failed: [] };
    failed.push({ clientKey: probe.localId, fileName: probe.file?.name, message: error.message });
  }

  const results = await mapWithConcurrency(
    remaining,
    EVIDENCE_UPLOAD_CONCURRENCY,
    async (image) => {
      try {
        return {
          ok: true,
          row: await uploadBinaryImage({ maintenanceId, deviceId, image, sessionToken, signal }),
        };
      } catch (error) {
        if (isAbortError(error)) throw error;
        return {
          ok: false,
          failure: { clientKey: image.localId, fileName: image.file?.name, message: error.message },
        };
      }
    },
    { signal },
  );

  for (const result of results) {
    if (result?.ok) uploaded.push(result.row);
    else if (result?.failure) failed.push(result.failure);
  }
  return { handled: true, uploaded, failed };
}

async function uploadLargeVideo({ maintenanceId, deviceId, image, sessionToken, signal }) {
  try {
    const result = await uploadLargeMaintenanceEvidence({
      maintenanceId,
      deviceId,
      imageId: image.localId,
      item: image,
      sessionToken,
      signal,
    });
    return { ok: true, row: { ...uploadedView(result, maintenanceId), clientKey: image.localId } };
  } catch (error) {
    if (isAbortError(error)) throw error;
    return {
      ok: false,
      failure: { clientKey: image.localId, fileName: image.file?.name, message: error.message },
    };
  }
}

async function uploadLargeVideos({ maintenanceId, deviceId, images, sessionToken, signal }) {
  const uploaded = [];
  const failed = [];
  if (!images.length) return { uploaded, failed };

  // El primer video confirma si el canal binario funciona. Si el backend viejo
  // obliga a usar Base64, los videos restantes continúan secuencialmente para
  // no multiplicar memoria en el navegador.
  const first = await uploadLargeVideo({ maintenanceId, deviceId, image: images[0], sessionToken, signal });
  if (first.ok) uploaded.push(first.row);
  else failed.push(first.failure);

  const remaining = images.slice(1);
  if (!remaining.length) return { uploaded, failed };

  if (canUseBinaryUpload()) {
    const results = await mapWithConcurrency(
      remaining,
      EVIDENCE_UPLOAD_CONCURRENCY,
      (image) => uploadLargeVideo({ maintenanceId, deviceId, image, sessionToken, signal }),
      { signal },
    );
    for (const result of results) {
      if (result?.ok) uploaded.push(result.row);
      else if (result?.failure) failed.push(result.failure);
    }
  } else {
    for (const image of remaining) {
      const result = await uploadLargeVideo({ maintenanceId, deviceId, image, sessionToken, signal });
      if (result.ok) uploaded.push(result.row);
      else failed.push(result.failure);
    }
  }
  return { uploaded, failed };
}

export async function uploadMaintenanceImagesInBatches({
  maintenanceId,
  deviceId,
  images = [],
  sessionToken,
  signal,
}) {
  const uploaded = [];
  const failed = [];
  const largeVideos = images.filter(shouldUseLargeEvidenceUpload);
  const regularImages = images.filter((image) => !shouldUseLargeEvidenceUpload(image));

  if (largeVideos.length) {
    const large = await uploadLargeVideos({ maintenanceId, deviceId, images: largeVideos, sessionToken, signal });
    uploaded.push(...large.uploaded);
    failed.push(...large.failed);
  }

  if (regularImages.length) {
    const binary = await uploadBinaryImages({
      maintenanceId,
      deviceId,
      images: regularImages,
      sessionToken,
      signal,
    });
    if (binary.handled) {
      uploaded.push(...binary.uploaded);
      failed.push(...binary.failed);
      return { uploaded, failed, total: images.length };
    }
  }

  const chunks = chunkByWeight(regularImages);
  let useFallbackForRemaining = uploadBatchAvailable === false || browserIsOffline();

  for (const chunk of chunks) {
    if (useFallbackForRemaining) {
      const fallback = await uploadFallback({ maintenanceId, deviceId, images: chunk, sessionToken, signal });
      uploaded.push(...fallback.uploaded);
      failed.push(...fallback.failed);
      continue;
    }

    const payloadImages = await prepareUploadChunk(chunk, signal);
    try {
      const result = await requestOnlineAliases(IMAGE_UPLOAD_BATCH_ROUTES, {
        maintenanceId,
        deviceId,
        images: payloadImages,
      }, sessionToken, signal);
      uploadBatchAvailable = true;
      uploaded.push(...(result?.uploaded || []).map((row) => uploadedView(row, maintenanceId)));
      failed.push(...(result?.failed || []));
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (!missingRoute(error) && !isNetworkError(error)) throw error;
      if (missingRoute(error)) uploadBatchAvailable = false;
      useFallbackForRemaining = true;
      const fallback = await uploadFallback({
        maintenanceId,
        deviceId,
        images: chunk,
        preparedImages: payloadImages,
        sessionToken,
        signal,
      });
      uploaded.push(...fallback.uploaded);
      failed.push(...fallback.failed);
    } finally {
      clearPreparedPayloads(payloadImages);
    }
  }

  return { uploaded, failed, total: images.length };
}

async function updateFallback({ maintenanceId, deviceId, images, sessionToken, signal }) {
  const updatedIds = [];
  const updatedRows = [];
  const failed = [];
  for (const image of images) {
    try {
      const result = await requestAvailable(MODULE_ROUTES.maintenance.imageUpdate,
        imageMetadataPayload(image, maintenanceId, deviceId),
        sessionToken,
        requestOptions(signal),
      );
      updatedIds.push(image.id);
      updatedRows.push(uploadedView(result, maintenanceId));
    } catch (error) {
      if (isAbortError(error)) throw error;
      failed.push({ imageId: image.id, message: error.message, code: error.code, details: error.details });
    }
  }
  return { updatedIds, updatedRows, failed };
}

export async function updateMaintenanceImagesInBatches({
  maintenanceId,
  deviceId,
  images = [],
  sessionToken,
  signal,
}) {
  const dirty = images.filter((item) => item?.dirty && item?.id);
  if (!dirty.length) return { updatedIds: [], updatedRows: [], failed: [] };

  const updatedIds = [];
  const updatedRows = [];
  const failed = [];
  let useFallbackForRemaining = updateBatchAvailable === false || browserIsOffline();

  for (const chunk of chunkItems(dirty)) {
    if (useFallbackForRemaining) {
      const fallback = await updateFallback({ maintenanceId, deviceId, images: chunk, sessionToken, signal });
      updatedIds.push(...fallback.updatedIds);
      updatedRows.push(...fallback.updatedRows);
      failed.push(...fallback.failed);
      continue;
    }

    const updates = chunk.map((image) => imageMetadataPayload(image, maintenanceId, deviceId));
    try {
      const result = await requestOnlineAliases(IMAGE_UPDATE_BATCH_ROUTES, {
        maintenanceId,
        deviceId,
        updates,
      }, sessionToken, signal);
      updateBatchAvailable = true;
      const rows = (result?.updated || []).map((row) => uploadedView(row, maintenanceId));
      updatedRows.push(...rows);
      updatedIds.push(...rows.map((row) => row.id).filter(Boolean));
      failed.push(...(result?.failed || []));
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (!missingRoute(error) && !isNetworkError(error)) throw error;
      if (missingRoute(error)) updateBatchAvailable = false;
      useFallbackForRemaining = true;
      const fallback = await updateFallback({ maintenanceId, deviceId, images: chunk, sessionToken, signal });
      updatedIds.push(...fallback.updatedIds);
      updatedRows.push(...fallback.updatedRows);
      failed.push(...fallback.failed);
    }
  }

  return { updatedIds, updatedRows, failed };
}
