import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import {
  createMaintenanceDevice,
  EMPTY_MAINTENANCE,
  fileToBase64,
  maintenanceDevicePayload,
  maintenancePayload,
  mapMaintenance,
  mapMaintenanceDevice,
} from '../pages/maintenance/maintenanceFormData';
import { MODULE_ROUTES, normalizeItems, pick, requestAvailable } from '../services/moduleApi';

const clientView = (row) => ({ id: String(pick(row, ['ClienteID', 'ID', 'RowID'])), name: pick(row, ['Nombre', 'Clientes', 'RazonSocial']) });
const locationView = (row) => ({ id: String(pick(row, ['UbicacionID', 'id', 'RowID'])), name: pick(row, ['Nombre']) });
const equipmentView = (row) => ({ id: String(pick(row, ['UbicacionEquipoID', 'id', 'RowID'])), name: pick(row, ['Nombre']) });
const DEVICE_AUTOSAVE_DELAY_MS = 1800;

function localDraftKey(maintenanceId) {
  return `dms-maintenance-device-draft:${maintenanceId || 'new'}`;
}

function serializableDevice(device) {
  if (!device) return null;
  const { newImages: _newImages, ...rest } = device;
  return { ...rest, images: (device.images || []).map(({ dataUrl: _dataUrl, ...image }) => image), newImages: [] };
}

function uploadedImageView(row) {
  return {
    ...row,
    id: String(pick(row, ['FotoDispositivoID', 'id'])),
    dirty: false,
  };
}

function deviceSignature(device) {
  if (!device) return '';
  const payload = maintenanceDevicePayload(device, '');
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

function hasPendingMedia(device) {
  return Boolean((device?.newImages || []).length)
    || (device?.images || []).some((image) => image.dirty);
}

export default function useMaintenanceForm({ editing, maintenanceId }) {
  const navigate = useNavigate();
  const { sessionToken, user, hasPermission } = useAuth();
  const isAdmin = hasPermission('USUARIOS_GESTIONAR') || hasPermission('MANTENIMIENTOS_ELIMINAR');
  const canCreate = hasPermission('MANTENIMIENTOS_CREAR') || hasPermission('BOLETAS_CREAR');
  const canEdit = hasPermission('MANTENIMIENTOS_EDITAR') || hasPermission('BOLETAS_EDITAR');
  const canCreateLocation = hasPermission('CLIENTES_DATOS_OPERATIVOS_CREAR')
    || hasPermission('CLIENTES_EDITAR')
    || hasPermission('MANTENIMIENTOS_CREAR')
    || hasPermission('MANTENIMIENTOS_EDITAR')
    || hasPermission('MANTENIMIENTOS_GESTIONAR')
    || hasPermission('BOLETAS_CREAR')
    || hasPermission('BOLETAS_EDITAR');

  const [form, setForm] = useState({ ...EMPTY_MAINTENANCE, responsables: user?.UsuarioID ? [String(user.UsuarioID)] : [] });
  const [devices, setDevices] = useState([]);
  const [activeDevice, setActiveDevice] = useState(null);
  const [clients, setClients] = useState([]);
  const [users, setUsers] = useState([]);
  const [locations, setLocations] = useState([]);
  const [equipment, setEquipment] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deviceSaving, setDeviceSaving] = useState(false);
  const [deviceAutosaveStatus, setDeviceAutosaveStatus] = useState('idle');
  const [error, setError] = useState('');
  const activeDeviceRef = useRef(null);
  const deviceSavePromiseRef = useRef(null);
  const lastSavedDeviceSignatureRef = useRef('');
  const failedDeviceSignatureRef = useRef('');
  const draftConsumedRef = useRef(false);

  useEffect(() => {
    activeDeviceRef.current = activeDevice;
  }, [activeDevice]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      requestAvailable(MODULE_ROUTES.clients.list, { page: 1, pageSize: 1000, activo: true }, sessionToken),
      requestAvailable(['users.assignment.list', 'users.list'], { page: 1, pageSize: 1000 }, sessionToken),
      editing ? requestAvailable(MODULE_ROUTES.maintenance.get, { maintenanceId }, sessionToken) : Promise.resolve(null),
    ]).then(([clientData, userData, maintenanceData]) => {
      if (!active) return;
      setClients(normalizeItems(clientData).map(clientView));
      setUsers(normalizeItems(userData).filter((item) => String(pick(item, ['Estado'], 'ACTIVO')).toUpperCase() === 'ACTIVO'));
      if (maintenanceData) {
        setForm(mapMaintenance(maintenanceData));
        setDevices((maintenanceData.dispositivos || maintenanceData.devices || []).map(mapMaintenanceDevice));
      }
    }).catch((err) => active && setError(err.message)).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [editing, maintenanceId, sessionToken]);

  useEffect(() => {
    if (!form.clienteId) { setLocations([]); return; }
    requestAvailable(MODULE_ROUTES.clients.locationsList, { clienteId: form.clienteId, activo: true, pageSize: 1000 }, sessionToken)
      .then((data) => setLocations(normalizeItems(data).map(locationView))).catch((err) => setError(err.message));
  }, [form.clienteId, sessionToken]);

  useEffect(() => {
    if (!form.ubicacionId) { setEquipment([]); return; }
    requestAvailable(MODULE_ROUTES.clients.equipmentLocationsList, { ubicacionId: form.ubicacionId, activo: true, pageSize: 1000 }, sessionToken)
      .then((data) => setEquipment(normalizeItems(data).map(equipmentView))).catch((err) => setError(err.message));
  }, [form.ubicacionId, sessionToken]);

  const technicians = users.map((item) => {
    const label = pick(item, ['NombreCompleto', 'Nombre']);
    const parts = String(label).split(/\s+/);
    return { value: String(pick(item, ['UsuarioID', 'id'])), label, note: pick(item, ['Correo', 'NombreUsuario']), initials: `${parts[0]?.[0] || ''}${parts[1]?.[0] || ''}`.toUpperCase() };
  }).filter((item) => item.value && item.label);

  const registered = useMemo(() => devices.reduce((map, item) => ({ ...map, [item.categoria]: (map[item.categoria] || 0) + 1 }), {}), [devices]);
  const expectedTotal = Object.values(form.counts).reduce((sum, value) => sum + Number(value || 0), 0);
  const readOnly = editing && form.estado === 'FINALIZADO' && !isAdmin;

  function updateCount(key, value) {
    setForm((current) => ({ ...current, counts: { ...current.counts, [key]: Math.max(0, Number(value || 0)) } }));
  }

  function saveActiveDevice(device) {
    setDevices((current) => current.some((item) => item.localId === device.localId)
      ? current.map((item) => item.localId === device.localId ? device : item)
      : [...current, device]);
  }

  function openDevice(device) {
    activeDeviceRef.current = device;
    lastSavedDeviceSignatureRef.current = device?.id ? deviceSignature(device) : '';
    failedDeviceSignatureRef.current = '';
    setDeviceAutosaveStatus(device?.id ? 'server' : 'idle');
    setActiveDevice(device);
  }

  const applySavedDevice = useCallback((snapshot, deviceId, uploadedImages = [], savedExistingImageIds = []) => {
    const merge = (current) => {
      if (!current || current.localId !== snapshot.localId) return current;
      const uploadedLocalIds = new Set((snapshot.newImages || []).map((image) => image.localId));
      const savedExisting = new Set(savedExistingImageIds);
      const existingImages = (current.images || []).map((image) => savedExisting.has(image.id) ? { ...image, dirty: false } : image);
      const knownIds = new Set(existingImages.map((image) => String(image.id)));
      const additions = uploadedImages.filter((image) => image.id && !knownIds.has(String(image.id)));
      return {
        ...current,
        id: deviceId || current.id,
        images: [...existingImages, ...additions],
        newImages: (current.newImages || []).filter((image) => !uploadedLocalIds.has(image.localId)),
      };
    };
    setActiveDevice((current) => merge(current));
    setDevices((current) => {
      const found = current.some((item) => item.localId === snapshot.localId);
      if (!found) return [...current, merge(snapshot)];
      return current.map((item) => item.localId === snapshot.localId ? merge(item) : item);
    });
  }, []);

  const commitActiveDevice = useCallback(async (device, { automatic = false, closeAfter = false } = {}) => {
    if (!device) return null;
    saveActiveDevice(device);
    const snapshotSignature = deviceSignature(device);
    if (!automatic) failedDeviceSignatureRef.current = '';

    const validForServer = Boolean(device.categoria && device.nombre?.trim() && device.zona?.trim());
    if (!editing || !maintenanceId) {
      try { localStorage.setItem(localDraftKey(maintenanceId), JSON.stringify(serializableDevice(device))); } catch { /* El borrador local es auxiliar. */ }
      lastSavedDeviceSignatureRef.current = snapshotSignature;
      setDeviceAutosaveStatus('local');
      if (closeAfter) {
        setActiveDevice(null);
        window.dispatchEvent(new CustomEvent('dms-offline-editing-complete'));
      }
      return device;
    }

    if (!validForServer) {
      setDeviceAutosaveStatus('local');
      if (!automatic) setError('Categoría, nombre y ubicación específica son obligatorios para guardar el dispositivo.');
      return null;
    }

    if (deviceSavePromiseRef.current) {
      if (automatic) return deviceSavePromiseRef.current;
      try { await deviceSavePromiseRef.current; } catch { /* El guardado manual vuelve a intentarlo con la versión más reciente. */ }
      const latest = activeDeviceRef.current || device;
      return commitActiveDevice(latest, { automatic: false, closeAfter });
    }

    const task = (async () => {
      if (!automatic) setDeviceSaving(true);
      setDeviceAutosaveStatus('saving');
      try {
        const route = device.id
          ? (automatic ? MODULE_ROUTES.maintenance.deviceAutosave : MODULE_ROUTES.maintenance.deviceUpdate)
          : MODULE_ROUTES.maintenance.deviceCreate;
        const saved = await requestAvailable(route, maintenanceDevicePayload(device, maintenanceId), sessionToken);
        const deviceId = String(pick(saved, ['EvidenciaMantenimientoID', 'deviceId', 'id'], device.id));
        if (!deviceId) throw new Error('El backend no devolvió el identificador del dispositivo.');

        const savedExistingImageIds = [];
        const existingImagesToSave = automatic ? [] : (device.images || []).filter((item) => item.dirty);
        for (const image of existingImagesToSave) {
          await requestAvailable(MODULE_ROUTES.maintenance.imageUpdate, {
            maintenanceId,
            deviceId,
            imageId: image.id,
            Tipo: image.Tipo,
            Nota: image.Nota,
          }, sessionToken);
          savedExistingImageIds.push(image.id);
        }

        const uploadedImages = [];
        const newImagesToUpload = automatic ? [] : (device.newImages || []);
        for (const image of newImagesToUpload) {
          const uploaded = await requestAvailable(MODULE_ROUTES.maintenance.imageUpload, {
            maintenanceId,
            deviceId,
            Tipo: image.type,
            Nota: image.note,
            fileName: image.file.name,
            mimeType: image.file.type || 'image/jpeg',
            base64: await fileToBase64(image.file),
          }, sessionToken);
          uploadedImages.push(uploadedImageView(uploaded));
        }

        const savedSnapshot = {
          ...device,
          id: deviceId,
          images: automatic
            ? (device.images || [])
            : [
              ...(device.images || []).map((image) => savedExistingImageIds.includes(image.id) ? { ...image, dirty: false } : image),
              ...uploadedImages,
            ],
          newImages: automatic ? (device.newImages || []) : [],
        };
        applySavedDevice(automatic ? { ...device, newImages: [] } : device, deviceId, uploadedImages, savedExistingImageIds);

        if (saved?.throttled) {
          setDeviceAutosaveStatus('local');
        } else {
          lastSavedDeviceSignatureRef.current = deviceSignature(savedSnapshot);
          failedDeviceSignatureRef.current = '';
          setDeviceAutosaveStatus(automatic && hasPendingMedia(savedSnapshot) ? 'local' : 'server');
        }
        setError('');
        try { localStorage.removeItem(localDraftKey(maintenanceId)); } catch { /* Sin efecto sobre el guardado. */ }
        if (closeAfter && !saved?.throttled) {
          setActiveDevice(null);
          window.dispatchEvent(new CustomEvent('dms-offline-editing-complete'));
        }
        return savedSnapshot;
      } catch (err) {
        if (automatic) failedDeviceSignatureRef.current = snapshotSignature;
        setDeviceAutosaveStatus('error');
        if (!automatic) setError(err.message);
        throw err;
      } finally {
        if (!automatic) setDeviceSaving(false);
        deviceSavePromiseRef.current = null;
      }
    })();

    deviceSavePromiseRef.current = task;
    return task;
  }, [applySavedDevice, editing, maintenanceId, sessionToken]);

  useEffect(() => {
    if (!activeDevice || readOnly || saving || deviceSaving) return undefined;
    const currentSignature = deviceSignature(activeDevice);
    if (currentSignature === lastSavedDeviceSignatureRef.current) {
      setDeviceAutosaveStatus(editing && maintenanceId && !hasPendingMedia(activeDevice) ? 'server' : 'local');
      return undefined;
    }
    if (currentSignature === failedDeviceSignatureRef.current) return undefined;

    if (!editing || !maintenanceId) {
      const timer = window.setTimeout(() => {
        try { localStorage.setItem(localDraftKey(maintenanceId), JSON.stringify(serializableDevice(activeDevice))); } catch { /* El formulario sigue funcionando. */ }
        saveActiveDevice(activeDevice);
        lastSavedDeviceSignatureRef.current = currentSignature;
        setDeviceAutosaveStatus('local');
      }, 700);
      return () => window.clearTimeout(timer);
    }

    if (!activeDevice.categoria || !activeDevice.nombre?.trim() || !activeDevice.zona?.trim()) {
      setDeviceAutosaveStatus('local');
      return undefined;
    }

    setDeviceAutosaveStatus('saving');
    const timer = window.setTimeout(() => {
      commitActiveDevice(activeDevice, { automatic: true }).catch(() => {});
    }, DEVICE_AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [activeDevice, commitActiveDevice, deviceSaving, editing, maintenanceId, readOnly, saving]);

  async function closeActiveDevice() {
    if (!activeDevice) return null;
    try {
      return await commitActiveDevice(activeDevice, { automatic: false, closeAfter: true });
    } catch {
      return null;
    }
  }

  async function saveAndAddAnotherDevice() {
    if (!activeDevice) return null;
    try {
      const saved = await commitActiveDevice(activeDevice, { automatic: false, closeAfter: false });
      if (saved) openDevice(createDeviceForForm());
      return saved;
    } catch {
      return null;
    }
  }

  async function removeDevice(device) {
    if (!isAdmin || !window.confirm('¿Eliminar este dispositivo y sus evidencias?')) return;
    try {
      if (device.id) await requestAvailable(MODULE_ROUTES.maintenance.deviceDelete, { maintenanceId, deviceId: device.id }, sessionToken);
      setDevices((current) => current.filter((item) => item.localId !== device.localId));
      setActiveDevice(null);
    } catch (err) { setError(err.message); }
  }

  function validate() {
    if (!form.titulo.trim()) return 'El título es obligatorio.';
    if (!form.clienteId) return 'Selecciona un cliente.';
    if (!form.responsables.length) return 'Selecciona al menos un responsable.';
    if (devices.some((item) => !item.nombre.trim() || !item.zona.trim())) return 'Cada dispositivo necesita nombre y ubicación específica.';
    return '';
  }

  async function persist(action) {
    const message = validate();
    if (message) { setError(message); return; }
    setSaving(true);
    setError('');
    try {
      const base = await requestAvailable(editing ? MODULE_ROUTES.maintenance.update : MODULE_ROUTES.maintenance.create, maintenancePayload(form, maintenanceId), sessionToken);
      const id = String(pick(base?.mantenimiento || base, ['MantenimientoID', 'maintenanceId', 'id'], maintenanceId));
      if (!id) throw new Error('El backend no devolvió MantenimientoID.');
      for (const device of devices) {
        const saved = await requestAvailable(device.id ? MODULE_ROUTES.maintenance.deviceUpdate : MODULE_ROUTES.maintenance.deviceCreate, maintenanceDevicePayload(device, id), sessionToken);
        const deviceId = String(pick(saved, ['EvidenciaMantenimientoID', 'deviceId', 'id'], device.id));
        for (const image of device.images.filter((item) => item.dirty)) {
          await requestAvailable(MODULE_ROUTES.maintenance.imageUpdate, { maintenanceId: id, deviceId, imageId: image.id, Tipo: image.Tipo, Nota: image.Nota }, sessionToken);
        }
        for (const image of device.newImages) {
          await requestAvailable(MODULE_ROUTES.maintenance.imageUpload, { maintenanceId: id, deviceId, Tipo: image.type, Nota: image.note, fileName: image.file.name, mimeType: image.file.type || 'image/jpeg', base64: await fileToBase64(image.file) }, sessionToken);
        }
      }
      if (action === 'finalize') await requestAvailable(MODULE_ROUTES.maintenance.finalize, { maintenanceId: id }, sessionToken);
      try { localStorage.removeItem(localDraftKey(maintenanceId)); } catch { /* Sin efecto sobre el guardado. */ }
      navigate(`/mantenimientos/${encodeURIComponent(id)}`);
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  }

  function createDeviceForForm() {
    const fresh = createMaintenanceDevice();
    if (editing || draftConsumedRef.current) return fresh;
    draftConsumedRef.current = true;
    try {
      const stored = JSON.parse(localStorage.getItem(localDraftKey(maintenanceId)) || 'null');
      if (stored) return { ...fresh, ...stored, localId: fresh.localId, id: '', images: [], newImages: [] };
    } catch { /* Inicia un dispositivo limpio. */ }
    return fresh;
  }

  return {
    allowed: editing ? canEdit : canCreate,
    isAdmin,
    canCreateLocation,
    form,
    setForm,
    devices,
    activeDevice,
    setActiveDevice,
    openDevice,
    clients,
    locations,
    equipment,
    technicians,
    loading,
    saving,
    deviceSaving,
    deviceAutosaveStatus,
    error,
    setError,
    readOnly,
    registered,
    expectedTotal,
    updateCount,
    saveActiveDevice,
    commitActiveDevice,
    closeActiveDevice,
    saveAndAddAnotherDevice,
    removeDevice,
    persist,
    createDevice: createDeviceForForm,
    sessionToken,
  };
}
