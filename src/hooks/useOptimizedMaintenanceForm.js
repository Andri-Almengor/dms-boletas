import { useCallback } from 'react';
import useMaintenanceDeviceDraft from './useMaintenanceDeviceDraft';
import useScalableMaintenanceForm from './useScalableMaintenanceForm';

export default function useOptimizedMaintenanceForm(options = {}) {
  const state = useScalableMaintenanceForm(options);
  const persistDeviceDraft = Boolean(
    state.activeDevice
    && ['saving', 'local', 'error'].includes(state.deviceAutosaveStatus),
  );
  const draft = useMaintenanceDeviceDraft({
    maintenanceId: options.maintenanceId,
    device: state.activeDevice,
    enabled: true,
    persistEnabled: persistDeviceDraft,
  });

  const createDevice = useCallback(() => {
    const fresh = state.createDevice();
    if (options.editing) return fresh;
    return draft.consumeRestoredDevice(fresh);
  }, [draft, options.editing, state]);

  const cancelActiveDevice = useCallback(() => {
    const cancelled = state.cancelActiveDevice();
    if (cancelled) draft.clearDeviceDraft();
    return cancelled;
  }, [draft, state]);

  const closeActiveDevice = useCallback(async () => {
    const saved = await state.closeActiveDevice();
    if (saved) {
      draft.clearDeviceDraft();
      if (saved.id) draft.markServerSaved();
    }
    return saved;
  }, [draft, state]);

  const saveAndAddAnotherDevice = useCallback(async () => {
    const saved = await state.saveAndAddAnotherDevice();
    if (saved) draft.clearDeviceDraft();
    return saved;
  }, [draft, state]);

  const cancelMaintenanceChanges = useCallback(() => {
    const cancelled = state.cancelMaintenanceChanges();
    if (cancelled) draft.clearDeviceDraft();
    return cancelled;
  }, [draft, state]);

  return {
    ...state,
    createDevice,
    cancelActiveDevice,
    closeActiveDevice,
    saveAndAddAnotherDevice,
    cancelMaintenanceChanges,
    clearDeviceDraft: draft.clearDeviceDraft,
    deviceDraftStorageKey: draft.storageKey,
    deviceAutosaveStatus: persistDeviceDraft ? draft.status : state.deviceAutosaveStatus,
  };
}
