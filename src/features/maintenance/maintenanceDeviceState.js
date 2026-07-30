export const MAINTENANCE_DEVICE_DRAFT_DELAY_MS = 650;

export function maintenanceDeviceDraftKey(maintenanceId) {
  return `dms-maintenance-device-draft:${maintenanceId || 'new'}`;
}

export function cloneMaintenanceDevice(device) {
  if (!device) return null;
  return {
    ...device,
    respuestas: { ...(device.respuestas || {}) },
    images: (device.images || []).map((image) => ({ ...image })),
    newImages: (device.newImages || []).map((image) => ({ ...image })),
  };
}

export function serializableMaintenanceDevice(device) {
  if (!device) return null;
  const { newImages: _newImages, ...rest } = device;
  return {
    ...rest,
    respuestas: { ...(device.respuestas || {}) },
    images: (device.images || []).map(({ dataUrl: _dataUrl, previewUrl: _previewUrl, ...image }) => image),
    newImages: [],
  };
}

export function maintenanceDeviceSignature(device, payload = null) {
  if (!device) return '';
  return JSON.stringify({
    payload,
    dirtyImages: (device.images || [])
      .filter((image) => image.dirty)
      .map((image) => ({ id: image.id, Tipo: image.Tipo, Nota: image.Nota })),
    newImages: (device.newImages || []).map((image) => ({
      localId: image.localId,
      type: image.type,
      note: image.note,
      name: image.file?.name,
      size: image.file?.size,
      lastModified: image.file?.lastModified,
    })),
  });
}

export function maintenanceFormSignature(form, devices = []) {
  return JSON.stringify({
    form,
    devices: devices.map(serializableMaintenanceDevice),
  });
}

export function maintenanceDeviceChanged(current, original, signatureBuilder) {
  return signatureBuilder(current) !== signatureBuilder(original);
}

export function mergeMaintenanceDevice(devices = [], device) {
  const snapshot = cloneMaintenanceDevice(device);
  if (!snapshot) return devices;
  return devices.some((item) => item.localId === snapshot.localId)
    ? devices.map((item) => item.localId === snapshot.localId ? snapshot : item)
    : [...devices, snapshot];
}

export function pendingMaintenanceImagesToRelease(current, original = null) {
  const originalIds = new Set((original?.newImages || []).map((image) => image.localId));
  return (current?.newImages || []).filter((image) => !originalIds.has(image.localId));
}

export function restoreLegacyMaintenanceDevice(freshDevice, storedDevice) {
  if (!storedDevice) return freshDevice;
  return {
    ...freshDevice,
    ...storedDevice,
    localId: freshDevice.localId,
    id: '',
    images: [],
    newImages: [],
  };
}
