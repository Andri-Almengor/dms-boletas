import { apiRequest } from '../api';
import { fileToBase64, mapFilesSequentially } from '../utils/fileEncoding';
import { MODULE_ROUTES, pick, requestAvailable } from './moduleApi';
import { maintenanceImageSyncBase, withSyncBase } from './maintenanceSyncBase';
import { isAbortError, isNetworkError } from './requestErrors';

const IMAGE_UPLOAD_BATCH_ROUTES = ['maintenance.images.uploadBatch', 'mantenimientos.imagenes.subirLote'];
const IMAGE_UPDATE_BATCH_ROUTES = ['maintenance.images.updateBatch', 'mantenimientos.imagenes.actualizarLote'];
const MAX_FILES_PER_REQUEST = 10;
const MAX_RAW_BYTES_PER_REQUEST = 10 * 1024 * 1024;
const MAX_METADATA_UPDATES_PER_REQUEST = 80;

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
    mimeType: image.file.type || 'image/jpeg',
    base64,
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
        mimeType: image.file.type || 'image/jpeg',
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

export async function uploadMaintenanceImagesInBatches({
  maintenanceId,
  deviceId,
  images = [],
  sessionToken,
  signal,
}) {
  const uploaded = [];
  const failed = [];
  const chunks = chunkByWeight(images);
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
      const result = await requestAvailable(
        MODULE_ROUTES.maintenance.imageUpdate,
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
