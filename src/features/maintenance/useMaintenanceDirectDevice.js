import { useEffect, useMemo, useRef } from 'react';
import {
  maintenanceDeviceId,
  resolveMaintenanceDirectRequest,
} from './maintenanceFormOrchestration';

export default function useMaintenanceDirectDevice({
  editing,
  maintenanceId,
  searchParams,
  navigate,
  setStep,
  state,
  canAddExpectedDevice,
}) {
  const query = searchParams?.toString?.() || '';
  const request = useMemo(
    () => resolveMaintenanceDirectRequest(new URLSearchParams(query), editing),
    [editing, query],
  );
  const openedRef = useRef('');
  const actionsRef = useRef({});
  actionsRef.current = {
    createDevice: state.createDevice,
    openDevice: state.openDevice,
    closeActiveDevice: state.closeActiveDevice,
    cancelActiveDevice: state.cancelActiveDevice,
    removeDevice: state.removeDevice,
    setError: state.setError,
  };

  useEffect(() => {
    if (request.requestedStep === 2) setStep(2);
  }, [request.requestedStep, setStep]);

  useEffect(() => {
    if (!editing || state.loading || !request.requestedNewDevice || state.activeDevice) return;
    if (openedRef.current === '__new__') return;
    openedRef.current = '__new__';

    if (!canAddExpectedDevice) {
      actionsRef.current.setError('Primero indique una cantidad mayor que cero para al menos un tipo de dispositivo.');
      return;
    }
    actionsRef.current.openDevice(actionsRef.current.createDevice());
  }, [canAddExpectedDevice, editing, request.requestedNewDevice, state.activeDevice, state.loading]);

  useEffect(() => {
    if (!editing || state.loading || request.requestedNewDevice || !request.requestedDeviceId || state.activeDevice) return;
    if (openedRef.current === request.requestedDeviceId) return;
    if (!state.devices.length) return;

    const selected = state.devices.find((device) => maintenanceDeviceId(device) === request.requestedDeviceId);
    openedRef.current = request.requestedDeviceId;
    if (!selected) {
      actionsRef.current.setError('No se encontró el dispositivo solicitado. Puede seleccionarlo desde la lista.');
      setStep(2);
      return;
    }
    actionsRef.current.openDevice(selected);
  }, [editing, request.requestedDeviceId, request.requestedNewDevice, setStep, state.activeDevice, state.devices, state.loading]);

  const detailUrl = `/mantenimientos/${encodeURIComponent(maintenanceId)}`;

  async function saveDevice() {
    const saved = await actionsRef.current.closeActiveDevice();
    if (saved && request.directDeviceMode) navigate(detailUrl, { replace: true });
    return saved;
  }

  function cancelDevice() {
    const cancelled = actionsRef.current.cancelActiveDevice();
    if (cancelled && request.directDeviceMode) navigate(detailUrl, { replace: true });
    return cancelled;
  }

  async function deleteDevice() {
    await actionsRef.current.removeDevice(state.activeDevice);
    if (request.directDeviceMode) navigate(detailUrl, { replace: true });
  }

  return {
    ...request,
    detailUrl,
    saveDevice,
    cancelDevice,
    deleteDevice,
  };
}
