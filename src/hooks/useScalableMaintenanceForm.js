import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useOptimizedMaintenanceBase from './useOptimizedMaintenanceBase';
import { maintenancePayload } from '../pages/maintenance/maintenanceFormData';
import { MODULE_ROUTES, pick, requestAvailable } from '../services/moduleApi';
import { requestMaintenanceFinalization } from '../services/maintenanceFinalization';
import { persistMaintenanceDeviceCollection } from '../services/maintenanceDevicePersistence';
import { createLocalId } from '../utils/localId';

function clean(value) {
  return String(value ?? '').trim();
}

export default function useScalableMaintenanceForm({ editing, maintenanceId }) {
  const navigate = useNavigate();
  const base = useOptimizedMaintenanceBase({ editing, maintenanceId });
  const [batchSaving, setBatchSaving] = useState(false);
  const newMaintenanceIdRef = useRef(clean(maintenanceId) || createLocalId('mantenimiento'));

  const saveDeviceToServer = useCallback((device, { closeAfter = false } = {}) => (
    base.commitActiveDevice(device, { closeAfter })
  ), [base]);

  const closeActiveDevice = useCallback(() => (
    saveDeviceToServer(base.activeDevice, { closeAfter: true })
  ), [base.activeDevice, saveDeviceToServer]);

  const saveAndAddAnotherDevice = useCallback(async () => {
    const saved = await saveDeviceToServer(base.activeDevice, { closeAfter: false });
    if (saved) base.openDevice(base.createDevice());
    return saved;
  }, [base, saveDeviceToServer]);

  const persist = useCallback(async (action) => {
    if (editing) return base.persist(action);
    if (!base.form.titulo.trim()) { base.setError('El título es obligatorio.'); return null; }
    if (!base.form.clienteId) { base.setError('Selecciona un cliente.'); return null; }
    if (!base.form.responsables.length) { base.setError('Selecciona al menos un responsable.'); return null; }

    setBatchSaving(true);
    base.setError('');
    const requestedMaintenanceId = newMaintenanceIdRef.current;
    try {
      const created = await requestAvailable(
        MODULE_ROUTES.maintenance.create,
        maintenancePayload(base.form, requestedMaintenanceId),
        base.sessionToken,
      );
      const id = clean(pick(
        created?.mantenimiento || created,
        ['MantenimientoID', 'maintenanceId', 'id'],
        requestedMaintenanceId,
      ));
      if (!id) throw new Error('El backend no devolvió MantenimientoID.');

      await persistMaintenanceDeviceCollection({
        maintenanceId: id,
        devices: base.devices,
        sessionToken: base.sessionToken,
      });

      if (action === 'finalize') {
        await requestMaintenanceFinalization({ maintenanceId: id, sessionToken: base.sessionToken });
      }
      base.clearDeviceDraft();
      navigate(`/mantenimientos/${encodeURIComponent(id)}`);
      return created;
    } catch (error) {
      base.setError(`${error.message} Puede volver a guardar: el mantenimiento, los dispositivos y las evidencias ya procesadas conservarán sus mismos identificadores y no se duplicarán.`);
      return null;
    } finally {
      setBatchSaving(false);
    }
  }, [base, editing, navigate]);

  return {
    ...base,
    saving: base.saving || batchSaving,
    deviceSaving: base.deviceSaving || batchSaving,
    deviceAutosaveStatus: batchSaving ? 'saving' : base.deviceAutosaveStatus,
    closeActiveDevice,
    saveAndAddAnotherDevice,
    persist,
  };
}
