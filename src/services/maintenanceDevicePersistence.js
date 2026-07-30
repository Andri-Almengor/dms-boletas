import {
  buildMaintenanceDevicePersistenceState,
  cleanMaintenancePersistenceValue,
  ensureMaintenanceDeviceIdentity,
} from '../features/maintenance/maintenanceDevicePersistenceState.js';
import { maintenanceDevicePayload } from '../pages/maintenance/maintenanceFormData';
import {
  updateMaintenanceImagesInBatches,
  uploadMaintenanceImagesInBatches,
} from './maintenanceImageBatch';
import { MODULE_ROUTES, pick, requestAvailable } from './moduleApi';

function releaseUploadedPreviews(images = [], uploadedKeys = new Set()) {
  for (const image of images) {
    if (!uploadedKeys.has(cleanMaintenancePersistenceValue(image.localId))) continue;

    if (image?.previewUrl?.startsWith('blob:') && typeof URL !== 'undefined') {
      URL.revokeObjectURL(image.previewUrl);
    }
    if (image?.file && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('dms-draft-file-removed', {
        detail: {
          route: `${window.location.pathname}${window.location.search || ''}`,
          file: image.file,
        },
      }));
    }
  }
}

export async function persistMaintenanceDevice({
  maintenanceId,
  device,
  sessionToken,
}) {
  if (!device) throw new Error('No se recibió el dispositivo que se debe guardar.');

  const requestDevice = ensureMaintenanceDeviceIdentity(device);
  const route = cleanMaintenancePersistenceValue(device.id)
    ? MODULE_ROUTES.maintenance.deviceUpdate
    : MODULE_ROUTES.maintenance.deviceCreate;
  const saved = await requestAvailable(
    route,
    maintenanceDevicePayload(requestDevice, maintenanceId),
    sessionToken,
  );
  const deviceId = cleanMaintenancePersistenceValue(
    pick(saved, ['EvidenciaMantenimientoID', 'deviceId', 'id'], requestDevice.id),
  );
  if (!deviceId) throw new Error('El backend no devolvió el identificador del dispositivo.');

  const metadataResult = await updateMaintenanceImagesInBatches({
    maintenanceId,
    deviceId,
    images: device.images || [],
    sessionToken,
  });
  const uploadResult = await uploadMaintenanceImagesInBatches({
    maintenanceId,
    deviceId,
    images: device.newImages || [],
    sessionToken,
  });
  const state = buildMaintenanceDevicePersistenceState({
    device: requestDevice,
    deviceId,
    metadataResult,
    uploadResult,
  });

  releaseUploadedPreviews(device.newImages || [], state.uploadedKeys);
  return {
    ...state,
    deviceId,
    requestDevice,
    metadataResult,
    uploadResult,
  };
}

export async function persistMaintenanceDeviceCollection({
  maintenanceId,
  devices = [],
  sessionToken,
  onPersisted,
}) {
  const results = [];

  for (let index = 0; index < devices.length; index += 1) {
    const result = await persistMaintenanceDevice({
      maintenanceId,
      device: devices[index],
      sessionToken,
    });
    results.push(result);
    if (typeof onPersisted === 'function') onPersisted(result, index);

    if (!result.complete) {
      const error = new Error(result.failureMessage);
      error.code = 'MAINTENANCE_DEVICE_PARTIAL_SAVE';
      error.persistenceResult = result;
      throw error;
    }
  }

  return results;
}
