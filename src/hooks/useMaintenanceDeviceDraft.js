import { useCallback, useMemo, useRef } from 'react';
import useFormDraft from './useFormDraft';

const SAVE_DELAY_MS = 650;

function serializableDevice(device) {
  if (!device) return null;
  const { newImages: _newImages, ...rest } = device;
  return {
    ...rest,
    respuestas: { ...(device.respuestas || {}) },
    images: (device.images || []).map(({ dataUrl: _dataUrl, previewUrl: _previewUrl, ...image }) => image),
    newImages: [],
  };
}

export default function useMaintenanceDeviceDraft({
  maintenanceId,
  device,
  enabled = true,
  persistEnabled = Boolean(device),
} = {}) {
  const suffix = String(maintenanceId || 'new');
  const restoredRef = useRef(null);
  const consumedRef = useRef(false);
  const legacyKeys = useMemo(() => [`dms-maintenance-device-draft:${suffix}`], [suffix]);
  const value = useMemo(() => serializableDevice(device), [device]);

  const draft = useFormDraft({
    namespace: 'maintenance-device-state',
    keySuffix: suffix,
    routePrefix: 'maintenance-device-hook',
    legacyKeys,
    enabled,
    persistEnabled: Boolean(persistEnabled && value),
    value,
    onRestore: (restored) => {
      if (!consumedRef.current) restoredRef.current = restored;
    },
    saveDelayMs: SAVE_DELAY_MS,
  });

  const consumeRestoredDevice = useCallback((freshDevice) => {
    consumedRef.current = true;
    const restored = restoredRef.current;
    restoredRef.current = null;
    if (!restored) return freshDevice;
    return {
      ...freshDevice,
      ...restored,
      localId: freshDevice.localId,
      id: '',
      images: [],
      newImages: [],
    };
  }, []);

  const clearDeviceDraft = useCallback(() => {
    restoredRef.current = null;
    consumedRef.current = false;
    draft.clearDraft();
  }, [draft]);

  return {
    ...draft,
    clearDeviceDraft,
    consumeRestoredDevice,
  };
}
