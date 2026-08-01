import {
  buildMaintenanceDevicePersistenceState,
  cleanMaintenancePersistenceValue,
  ensureMaintenanceDeviceIdentity,
} from '../features/maintenance/maintenanceDevicePersistenceState.js';
import { maintenanceDevicePayload } from '../pages/maintenance/maintenanceFormData';
import { releaseLocalFiles } from '../utils/localFileLifecycle';
import {
  updateMaintenanceImagesInBatches,
  uploadMaintenanceImagesInBatches,
} from './maintenanceImageBatch';
import { maintenanceDeviceSyncBase } from './maintenanceSyncBase';
import { MODULE_ROUTES, pick, requestAvailable } from './moduleApi';

function releaseUploadedFiles(images = [], uploadedKeys = new Set()) {
  releaseLocalFiles(images.filter((image) => (
    uploadedKeys.has(cleanMaintenancePersistenceValue(image.localId))
  )));
}

export async function persistMaintenanceDevice({
  maintenanceId,
  device,
  sessionToken,
  signal,
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
    signal ? { signal } : {},
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
    signal,
  });
  const uploadResult = await uploadMaintenanceImagesInBatches({
    maintenanceId,
    deviceId,
    images: device.newImages || [],
    sessionToken,
    signal,
  });
  const confirmedDevice = {
    ...requestDevice,
    id: deviceId,
    syncBase: maintenanceDeviceSyncBase(saved, maintenanceId) || requestDevice.syncBase || null,
  };
  const state = buildMaintenanceDevicePersistenceState({
    device: confirmedDevice,
    deviceId,
    metadataResult,
    uploadResult,
  });

  releaseUploadedFiles(device.newImages || [], state.uploadedKeys);
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
  signal,
  onPersisted,
}) {
  const results = [];

  for (let index = 0; index < devices.length; index += 1) {
    const result = await persistMaintenanceDevice({
      maintenanceId,
      device: devices[index],
      sessionToken,
      signal,
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
