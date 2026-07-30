import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createMaintenanceDevice,
  maintenanceDevicePayload,
} from '../../pages/maintenance/maintenanceFormData';
import { releaseLocalFiles } from '../../utils/localFileLifecycle';
import {
  MAINTENANCE_DEVICE_DRAFT_DELAY_MS,
  cloneMaintenanceDevice,
  maintenanceDeviceChanged,
  maintenanceDeviceDraftKey,
  maintenanceDeviceSignature,
  mergeMaintenanceDevice,
  pendingMaintenanceImagesToRelease,
  restoreLegacyMaintenanceDevice,
  serializableMaintenanceDevice,
} from './maintenanceDeviceState';

function notifyOfflineEditingComplete() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('dms-offline-editing-complete'));
}

function releasePendingImages(current, original) {
  releaseLocalFiles(pendingMaintenanceImagesToRelease(current, original));
}

export default function useMaintenanceDeviceEditorLifecycle({
  editing,
  maintenanceId,
  readOnly,
  saving,
  deviceSaving,
  setDevices,
  setError,
}) {
  const [activeDevice, setActiveDeviceState] = useState(null);
  const [deviceAutosaveStatus, setDeviceAutosaveStatus] = useState('idle');
  const activeDeviceRef = useRef(null);
  const originalDeviceRef = useRef(null);
  const lastSavedDeviceSignatureRef = useRef('');
  const draftConsumedRef = useRef(false);
  const draftKey = maintenanceDeviceDraftKey(maintenanceId);

  const signatureOf = useCallback((device) => {
    if (!device) return '';
    return maintenanceDeviceSignature(device, maintenanceDevicePayload(device, ''));
  }, []);

  const setActiveDevice = useCallback((value) => {
    if (typeof value === 'function') {
      setActiveDeviceState((current) => {
        const next = value(current);
        activeDeviceRef.current = next;
        return next;
      });
      return;
    }
    activeDeviceRef.current = value;
    setActiveDeviceState(value);
  }, []);

  const clearDeviceDraft = useCallback(() => {
    try { localStorage.removeItem(draftKey); } catch { /* Sin efecto. */ }
  }, [draftKey]);

  const saveActiveDevice = useCallback((device) => {
    const snapshot = cloneMaintenanceDevice(device);
    setDevices((current) => mergeMaintenanceDevice(current, snapshot));
    return snapshot;
  }, [setDevices]);

  const openDevice = useCallback((device) => {
    const snapshot = cloneMaintenanceDevice(device);
    originalDeviceRef.current = cloneMaintenanceDevice(snapshot);
    activeDeviceRef.current = snapshot;
    lastSavedDeviceSignatureRef.current = signatureOf(snapshot);
    setDeviceAutosaveStatus(snapshot?.id ? 'server' : 'idle');
    setError('');
    setActiveDeviceState(snapshot);
  }, [setError, signatureOf]);

  const cancelActiveDevice = useCallback(() => {
    const current = activeDeviceRef.current;
    const original = originalDeviceRef.current;
    if (!current) return true;
    const changed = maintenanceDeviceChanged(current, original, signatureOf);
    if (changed && !window.confirm('¿Descartar los cambios realizados en este dispositivo?')) return false;

    releasePendingImages(current, original);
    clearDeviceDraft();
    originalDeviceRef.current = null;
    activeDeviceRef.current = null;
    setActiveDeviceState(null);
    setDeviceAutosaveStatus('idle');
    setError('');
    notifyOfflineEditingComplete();
    return true;
  }, [clearDeviceDraft, setError, signatureOf]);

  const markDeviceSaved = useCallback((device, {
    closeAfter = false,
    status = device?.id ? 'server' : 'local',
  } = {}) => {
    const snapshot = saveActiveDevice(device);
    originalDeviceRef.current = cloneMaintenanceDevice(snapshot);
    activeDeviceRef.current = snapshot;
    lastSavedDeviceSignatureRef.current = signatureOf(snapshot);
    setDeviceAutosaveStatus(status);
    clearDeviceDraft();

    if (closeAfter) {
      activeDeviceRef.current = null;
      setActiveDeviceState(null);
      notifyOfflineEditingComplete();
    } else {
      setActiveDeviceState(snapshot);
    }
    return snapshot;
  }, [clearDeviceDraft, saveActiveDevice, signatureOf]);

  const removeDeviceLocally = useCallback((device) => {
    releaseLocalFiles(device?.newImages || []);
    setDevices((current) => current.filter((item) => item.localId !== device.localId));
    clearDeviceDraft();
    originalDeviceRef.current = null;
    activeDeviceRef.current = null;
    setActiveDeviceState(null);
    setDeviceAutosaveStatus('idle');
  }, [clearDeviceDraft, setDevices]);

  const createDeviceForForm = useCallback(() => {
    const fresh = createMaintenanceDevice();
    if (editing || draftConsumedRef.current) return fresh;
    draftConsumedRef.current = true;
    try {
      const stored = JSON.parse(localStorage.getItem(draftKey) || 'null');
      return restoreLegacyMaintenanceDevice(fresh, stored);
    } catch {
      return fresh;
    }
  }, [draftKey, editing]);

  useEffect(() => {
    if (!activeDevice || readOnly || saving || deviceSaving) return undefined;
    const currentSignature = signatureOf(activeDevice);
    if (currentSignature === lastSavedDeviceSignatureRef.current) {
      setDeviceAutosaveStatus(activeDevice.id ? 'server' : 'idle');
      return undefined;
    }

    setDeviceAutosaveStatus('saving');
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(draftKey, JSON.stringify(serializableMaintenanceDevice(activeDevice)));
        setDeviceAutosaveStatus('local');
      } catch {
        setDeviceAutosaveStatus('error');
      }
    }, MAINTENANCE_DEVICE_DRAFT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [activeDevice, deviceSaving, draftKey, readOnly, saving, signatureOf]);

  return {
    activeDevice,
    setActiveDevice,
    getActiveDevice: () => activeDeviceRef.current,
    openDevice,
    cancelActiveDevice,
    saveActiveDevice,
    markDeviceSaved,
    removeDeviceLocally,
    createDevice: createDeviceForForm,
    clearDeviceDraft,
    deviceAutosaveStatus,
    setDeviceAutosaveStatus,
    draftKey,
  };
}
