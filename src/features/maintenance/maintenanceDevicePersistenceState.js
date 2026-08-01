import { createLocalId } from '../../utils/localId.js';
import { cloneMaintenanceDevice } from './maintenanceDeviceState.js';

export function cleanMaintenancePersistenceValue(value) {
  return String(value ?? '').trim();
}

export function ensureMaintenanceDeviceIdentity(
  device = {},
  createId = () => createLocalId('dispositivo'),
) {
  const serverId = cleanMaintenancePersistenceValue(device.id);
  const currentLocalId = cleanMaintenancePersistenceValue(device.localId);
  const generatedId = serverId || currentLocalId || cleanMaintenancePersistenceValue(createId());

  return {
    ...device,
    id: generatedId,
    localId: currentLocalId || generatedId,
  };
}

export function uploadedMaintenanceImageView(row = {}) {
  return {
    ...row,
    id: cleanMaintenancePersistenceValue(row.FotoDispositivoID ?? row.id),
    dirty: false,
  };
}

export function maintenanceDevicePartialFailureText(
  device,
  metadataFailed = [],
  uploadFailed = [],
) {
  const parts = [];
  if (metadataFailed.length) {
    parts.push(`${metadataFailed.length} cambio${metadataFailed.length === 1 ? '' : 's'} de evidencia`);
  }
  if (uploadFailed.length) {
    parts.push(`${uploadFailed.length} fotografía${uploadFailed.length === 1 ? '' : 's'}`);
  }

  const name = device?.nombre || device?.NombreDispositivo || 'sin nombre';
  return `El dispositivo “${name}” se guardó parcialmente. No se pudieron guardar ${parts.join(' y ')}. Los elementos pendientes permanecen en el formulario para reintentarlos.`;
}

export function buildMaintenanceDevicePersistenceState({
  device,
  deviceId,
  metadataResult = {},
  uploadResult = {},
}) {
  const metadataFailed = metadataResult.failed || [];
  const uploadFailed = uploadResult.failed || [];
  const updatedIds = new Set(
    (metadataResult.updatedIds || []).map(cleanMaintenancePersistenceValue).filter(Boolean),
  );
  const updatedRows = new Map(
    (metadataResult.updatedRows || [])
      .map((row) => [cleanMaintenancePersistenceValue(row.id ?? row.FotoDispositivoID), row])
      .filter(([id]) => id),
  );
  const metadataFailedIds = new Set(
    metadataFailed
      .map((item) => cleanMaintenancePersistenceValue(item.imageId ?? item.id))
      .filter(Boolean),
  );
  const uploadedKeys = new Set(
    (uploadResult.uploaded || [])
      .map((item) => cleanMaintenancePersistenceValue(
        item.clientKey ?? item.localId ?? item.imageId ?? item.FotoDispositivoID,
      ))
      .filter(Boolean),
  );
  const failedUploadKeys = new Set(
    uploadFailed
      .map((item) => cleanMaintenancePersistenceValue(item.clientKey ?? item.localId ?? item.imageId))
      .filter(Boolean),
  );

  const snapshot = {
    ...cloneMaintenanceDevice(device),
    id: cleanMaintenancePersistenceValue(deviceId),
    images: [
      ...(device?.images || []).map((image) => {
        const imageId = cleanMaintenancePersistenceValue(image.id);
        const confirmed = updatedRows.get(imageId);
        if (confirmed) return { ...image, ...confirmed, dirty: false };
        return {
          ...image,
          dirty: metadataFailedIds.has(imageId)
            ? true
            : (updatedIds.has(imageId) ? false : image.dirty),
        };
      }),
      ...(uploadResult.uploaded || []).map(uploadedMaintenanceImageView),
    ],
    newImages: (device?.newImages || []).filter((image) => (
      failedUploadKeys.has(cleanMaintenancePersistenceValue(image.localId))
    )),
  };

  const complete = metadataFailed.length === 0 && uploadFailed.length === 0;
  return {
    snapshot,
    complete,
    updatedIds,
    uploadedKeys,
    metadataFailed,
    uploadFailed,
    failureMessage: complete
      ? ''
      : maintenanceDevicePartialFailureText(device, metadataFailed, uploadFailed),
  };
}
