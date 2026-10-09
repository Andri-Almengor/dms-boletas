import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { expectedMaintenanceTotalFromCatalog } from '../config/dynamicMaintenanceTypes';
import {
  buildMaintenanceTechnicians,
  countRegisteredMaintenanceDevices,
  expectedMaintenanceTotal,
  maintenanceReadOnly,
  updateMaintenanceCount,
  validateMaintenanceForm,
} from '../features/maintenance/maintenanceFormDomain';
import { maintenanceFormSignature } from '../features/maintenance/maintenanceDeviceState';
import useMaintenanceDeviceEditorLifecycle from '../features/maintenance/useMaintenanceDeviceEditorLifecycle';
import useMaintenanceResources from '../features/maintenance/useMaintenanceResources';
import useMaintenanceDeviceCatalogData from './useMaintenanceDeviceCatalogData';
import {
  EMPTY_MAINTENANCE,
  maintenancePayload,
} from '../pages/maintenance/maintenanceFormData';
import {
  persistMaintenanceDevice,
  persistMaintenanceDeviceCollection,
} from '../services/maintenanceDevicePersistence';
import { MODULE_ROUTES, pick, requestAvailable } from '../services/moduleApi';

export default function useMaintenanceForm({ editing, maintenanceId, navigationState }) {
  const navigate = useNavigate();
  const { sessionToken, user, hasPermission } = useAuth();
  const isAdmin = hasPermission('USUARIOS_GESTIONAR')
    || hasPermission('MANTENIMIENTOS_GESTIONAR')
    || hasPermission('MANTENIMIENTOS_ELIMINAR');
  const canCreate = hasPermission('MANTENIMIENTOS_CREAR')
    || hasPermission('MANTENIMIENTOS_GESTIONAR')
    || hasPermission('USUARIOS_GESTIONAR')
    || hasPermission('BOLETAS_CREAR');
  const canEdit = hasPermission('MANTENIMIENTOS_EDITAR')
    || hasPermission('MANTENIMIENTOS_GESTIONAR')
    || hasPermission('USUARIOS_GESTIONAR')
    || hasPermission('BOLETAS_EDITAR');
  const canCreateLocation = hasPermission('CLIENTES_DATOS_OPERATIVOS_CREAR')
    || hasPermission('CLIENTES_EDITAR')
    || hasPermission('MANTENIMIENTOS_CREAR')
    || hasPermission('MANTENIMIENTOS_EDITAR')
    || hasPermission('MANTENIMIENTOS_GESTIONAR')
    || hasPermission('USUARIOS_GESTIONAR')
    || hasPermission('BOLETAS_CREAR')
    || hasPermission('BOLETAS_EDITAR');

  const [form, setForm] = useState({ ...EMPTY_MAINTENANCE, responsables: user?.UsuarioID ? [String(user.UsuarioID)] : [] });
  const [devices, setDevices] = useState([]);
  const [saving, setSaving] = useState(false);
  const [deviceSaving, setDeviceSaving] = useState(false);
  const [error, setError] = useState('');
  const deviceSavePromiseRef = useRef(null);
  const initialMaintenanceSignatureRef = useRef('');

  const captureInitialState = useCallback((nextForm, nextDevices) => {
    initialMaintenanceSignatureRef.current = maintenanceFormSignature(nextForm, nextDevices);
  }, []);

  const resources = useMaintenanceResources({
    editing,
    maintenanceId,
    sessionToken,
    clientId: form.clienteId,
    locationId: form.ubicacionId,
    setForm,
    setDevices,
    setError,
    onInitialState: captureInitialState,
  });

  const { catalogs: countCatalogs } = useMaintenanceDeviceCatalogData(sessionToken, {
    resources: ['deviceTypes'],
  });

  const technicians = useMemo(
    () => buildMaintenanceTechnicians(resources.users),
    [resources.users],
  );
  const registered = useMemo(
    () => countRegisteredMaintenanceDevices(devices),
    [devices],
  );
  const expectedTotal = useMemo(
    () => countCatalogs.deviceTypes.length
      ? expectedMaintenanceTotalFromCatalog(countCatalogs.deviceTypes, form.counts, registered)
      : expectedMaintenanceTotal(form.counts, devices),
    [countCatalogs.deviceTypes, devices, form.counts, registered],
  );
  const readOnly = maintenanceReadOnly({ editing, estado: form.estado, isAdmin });
  const maintenanceDirty = useMemo(() => (
    Boolean(initialMaintenanceSignatureRef.current)
    && maintenanceFormSignature(form, devices) !== initialMaintenanceSignatureRef.current
  ), [form, devices]);

  const editor = useMaintenanceDeviceEditorLifecycle({
    editing,
    maintenanceId,
    readOnly,
    saving,
    deviceSaving,
    maintenanceType: form.tipoMantenimiento,
    setDevices,
    setError,
  });

  function updateCount(key, value) {
    setForm((current) => ({
      ...current,
      counts: updateMaintenanceCount(current.counts, key, value),
    }));
  }

  async function commitActiveDevice(device, { closeAfter = false } = {}) {
    if (!device) return null;

    if (!editing || !maintenanceId) {
      return editor.markDeviceSaved(device, { closeAfter, status: 'local' });
    }

    if (deviceSavePromiseRef.current) return deviceSavePromiseRef.current;

    const task = (async () => {
      setDeviceSaving(true);
      editor.setDeviceAutosaveStatus('saving');
      setError('');
      try {
        const result = await persistMaintenanceDevice({
          maintenanceId,
          device,
          sessionToken,
        });

        if (!result.complete) {
          editor.saveActiveDevice(result.snapshot);
          editor.setActiveDevice(result.snapshot);
          setError(result.failureMessage);
          return null;
        }

        if (result.faultNotification?.error) {
          setError(result.faultNotification.error);
        }
        return editor.markDeviceSaved(result.snapshot, { closeAfter, status: 'server' });
      } catch (requestError) {
        editor.setDeviceAutosaveStatus('error');
        setError(requestError.message);
        throw requestError;
      } finally {
        setDeviceSaving(false);
        deviceSavePromiseRef.current = null;
      }
    })();

    deviceSavePromiseRef.current = task;
    return task;
  }

  async function closeActiveDevice() {
    const activeDevice = editor.getActiveDevice();
    if (!activeDevice) return null;
    try {
      return await commitActiveDevice(activeDevice, { closeAfter: true });
    } catch {
      return null;
    }
  }

  async function saveAndAddAnotherDevice() {
    const activeDevice = editor.getActiveDevice();
    if (!activeDevice) return null;
    try {
      const saved = await commitActiveDevice(activeDevice, { closeAfter: false });
      if (saved) editor.openDevice(editor.createDevice());
      return saved;
    } catch {
      return null;
    }
  }

  async function removeDevice(device) {
    if (!isAdmin || !window.confirm('¿Eliminar este dispositivo y sus evidencias?')) return;
    try {
      if (device.id) await requestAvailable(MODULE_ROUTES.maintenance.deviceDelete, { maintenanceId, deviceId: device.id }, sessionToken);
      editor.removeDeviceLocally(device);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function persist(action) {
    const message = validateMaintenanceForm(form);
    if (message) { setError(message); return; }
    setSaving(true);
    setError('');
    try {
      const base = await requestAvailable(
        editing ? MODULE_ROUTES.maintenance.update : MODULE_ROUTES.maintenance.create,
        maintenancePayload(form, maintenanceId),
        sessionToken,
      );
      const id = String(pick(base?.mantenimiento || base, ['MantenimientoID', 'maintenanceId', 'id'], maintenanceId));
      if (!id) throw new Error('El backend no devolvió MantenimientoID.');

      const deviceResults = await persistMaintenanceDeviceCollection({
        maintenanceId: id,
        devices,
        sessionToken,
      });
      const faultNotificationErrors = deviceResults
        .map((result) => result?.faultNotification?.error)
        .filter(Boolean);

      if (faultNotificationErrors.length && action !== 'finalize') {
        editor.clearDeviceDraft();
        setError(`El mantenimiento y sus dispositivos se guardaron, pero falló el aviso de avería: ${[...new Set(faultNotificationErrors)].join(' ')}`);
        return;
      }

      if (action === 'finalize') {
        await requestAvailable(MODULE_ROUTES.maintenance.finalize, { maintenanceId: id }, sessionToken);
      }
      editor.clearDeviceDraft();
      navigate(`/mantenimientos/${encodeURIComponent(id)}`, navigationState ? { state: navigationState } : undefined);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  function cancelMaintenanceChanges() {
    if (maintenanceDirty && !window.confirm('¿Cancelar la edición y descartar los cambios del mantenimiento?')) return false;
    editor.clearDeviceDraft();
    navigate(editing ? `/mantenimientos/${encodeURIComponent(maintenanceId)}` : '/mantenimientos', editing && navigationState ? { state: navigationState } : undefined);
    return true;
  }

  return {
    allowed: editing ? canEdit : canCreate,
    isAdmin,
    canCreateLocation,
    form,
    setForm,
    devices,
    activeDevice: editor.activeDevice,
    setActiveDevice: editor.setActiveDevice,
    openDevice: editor.openDevice,
    clients: resources.clients,
    searchClients: resources.searchClients,
    locations: resources.locations,
    equipment: resources.equipment,
    addLocation: resources.addLocation,
    addEquipment: resources.addEquipment,
    technicians,
    loading: resources.loading,
    saving,
    deviceSaving,
    deviceAutosaveStatus: editor.deviceAutosaveStatus,
    error,
    setError,
    readOnly,
    registered,
    expectedTotal,
    maintenanceDirty,
    updateCount,
    saveActiveDevice: editor.saveActiveDevice,
    markDeviceSaved: editor.markDeviceSaved,
    clearDeviceDraft: editor.clearDeviceDraft,
    commitActiveDevice,
    closeActiveDevice,
    cancelActiveDevice: editor.cancelActiveDevice,
    cancelMaintenanceChanges,
    saveAndAddAnotherDevice,
    removeDevice,
    persist,
    createDevice: editor.createDevice,
    sessionToken,
  };
}
