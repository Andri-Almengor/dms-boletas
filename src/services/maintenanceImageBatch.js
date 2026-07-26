import { fileToBase64 } from '../pages/maintenance/maintenanceFormData';
import { MODULE_ROUTES, pick, requestAvailable } from './moduleApi';

const IMAGE_UPLOAD_BATCH_ROUTES = ['maintenance.images.uploadBatch', 'mantenimientos.imagenes.subirLote'];
const IMAGE_UPDATE_BATCH_ROUTES = ['maintenance.images.updateBatch', 'mantenimientos.imagenes.actualizarLote'];
const MAX_FILES_PER_REQUEST = 10;
const MAX_RAW_BYTES_PER_REQUEST = 10 * 1024 * 1024;
const MAX_METADATA_UPDATES_PER_REQUEST = 80;

function clean(value) {
  return String(value ?? '').trim();
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

function uploadedView(row = {}) {
  return {
    ...row,
    id: clean(pick(row, ['FotoDispositivoID', 'id'])),
    dirty: false,
  };
}

async function uploadFallback({ maintenanceId, deviceId, images, sessionToken }) {
  const uploaded = [];
  const failed = [];
  for (const image of images) {
    try {
      const result = await requestAvailable(MODULE_ROUTES.maintenance.imageUpload, {
        maintenanceId,
        deviceId,
        imageId: image.localId,
        Tipo: image.type,
        Nota: image.note,
        fileName: image.file.name,
        mimeType: image.file.type || 'image/jpeg',
        base64: await fileToBase64(image.file),
      }, sessionToken);
      uploaded.push({ ...uploadedView(result), clientKey: image.localId });
    } catch (error) {
      failed.push({ clientKey: image.localId, fileName: image.file?.name, message: error.message });
    }
  }
  return { uploaded, failed };
}

export async function uploadMaintenanceImagesInBatches({ maintenanceId, deviceId, images = [], sessionToken }) {
  const uploaded = [];
  const failed = [];
  const chunks = chunkByWeight(images);

  for (const chunk of chunks) {
    const payloadImages = await Promise.all(chunk.map(async (image) => ({
      localId: image.localId,
      imageId: image.localId,
      Tipo: image.type,
      Nota: image.note,
      fileName: image.file.name,
      mimeType: image.file.type || 'image/jpeg',
      base64: await fileToBase64(image.file),
    })));

    try {
      const result = await requestAvailable(IMAGE_UPLOAD_BATCH_ROUTES, {
        maintenanceId,
        deviceId,
        images: payloadImages,
      }, sessionToken);
      uploaded.push(...(result?.uploaded || []).map(uploadedView));
      failed.push(...(result?.failed || []));
    } catch (error) {
      if (!missingRoute(error)) throw error;
      const fallback = await uploadFallback({ maintenanceId, deviceId, images: chunk, sessionToken });
      uploaded.push(...fallback.uploaded);
      failed.push(...fallback.failed);
    }
  }

  return { uploaded, failed, total: images.length };
}

export async function updateMaintenanceImagesInBatches({ maintenanceId, deviceId, images = [], sessionToken }) {
  const dirty = images.filter((item) => item?.dirty && item?.id);
  if (!dirty.length) return { updatedIds: [], failed: [] };

  const updatedIds = [];
  const failed = [];
  for (const chunk of chunkItems(dirty)) {
    const updates = chunk.map((image) => ({ imageId: image.id, Tipo: image.Tipo, Nota: image.Nota }));
    try {
      const result = await requestAvailable(IMAGE_UPDATE_BATCH_ROUTES, {
        maintenanceId,
        deviceId,
        updates,
      }, sessionToken);
      updatedIds.push(...(result?.updated || []).map((row) => clean(pick(row, ['FotoDispositivoID', 'id']))).filter(Boolean));
      failed.push(...(result?.failed || []));
    } catch (error) {
      if (!missingRoute(error)) throw error;
      for (const image of chunk) {
        try {
          await requestAvailable(MODULE_ROUTES.maintenance.imageUpdate, {
            maintenanceId,
            deviceId,
            imageId: image.id,
            Tipo: image.Tipo,
            Nota: image.Nota,
          }, sessionToken);
          updatedIds.push(image.id);
        } catch (itemError) {
          failed.push({ imageId: image.id, message: itemError.message });
        }
      }
    }
  }

  return { updatedIds, failed };
}
