import { useEffect, useMemo, useRef, useState } from 'react';
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
const LOCAL_DRAFT_DELAY_MS = 650;

function localDraftKey(maintenanceId) {
  return `dms-maintenance-device-draft:${maintenanceId || 'new'}`;
}

function cloneDevice(device) {
  if (!device) return null;
  return {
    ...device,
    respuestas: { ...(device.respuestas || {}) },
    images: (device.images || []).map((image) => ({ ...image })),
    newImages: (device.newImages || []).map((image) => ({ ...image })),
  };
}

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

function maintenanceSignature(form, devices) {
  return JSON.stringify({
    form,
    devices: (devices || []).map(serializableDevice),
  });
}

function releasePendingImages(current, original = null) {
  const originalIds = new Set((original?.newImages || []).map((image) => image.localId));
  (current?.newImages || []).forEach((image) => {
    if (originalIds.has(image.localId)) return;
    if (image?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(image.previewUrl);
    if (image?.file) {
      window.dispatchEvent(new CustomEvent('dms-draft-file-removed', {
        detail: { route: `${window.location.pathname}${window.location.search || ''}`, file: image.file },
      }));
    }
  });
}

export default function useMaintenanceForm({ editing, maintenanceId }) {
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
  const originalDeviceRef = useRef(null);
  const deviceSavePromiseRef = useRef(null);
  const lastSavedDeviceSignatureRef = useRef('');
  const initialMaintenanceSignatureRef = useRef('');
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
        const mappedForm = mapMaintenance(maintenanceData);
        const mappedDevices = (maintenanceData.dispositivos || maintenanceData.devices || []).map(mapMaintenanceDevice);
        setForm(mappedForm);
        setDevices(mappedDevices);
        initialMaintenanceSignatureRef.current = maintenanceSignature(mappedForm, mappedDevices);
      } else {
        setForm((current) => {
          initialMaintenanceSignatureRef.current = maintenanceSignature(current, []);
          return current;
        });
      }
    }).catch((err) => active && setError(err.message)).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [editing, maintenanceId, sessionToken]);

  useEffect(() => {
    if (!form.clienteId) { setLocations([]); return; }
    requestAvailable(MODULE_ROUTES.clients.locationsList, { clienteId: form.clienteId, activo: true, pageSize: 1000 }, sessionToken)
      .then((data) => setLocations(normalizeItems(data).map(locationView)))
      .catch((err) => setError(err.message));
  }, [form.clienteId, sessionToken]);

  useEffect(() => {
    if (!form.ubicacionId) { setEquipment([]); return; }
    requestAvailable(MODULE_ROUTES.clients.equipmentLocationsList, { ubicacionId: form.ubicacionId, activo: true, pageSize: 1000 }, sessionToken)
      .then((data) => setEquipment(normalizeItems(data).map(equipmentView)))
      .catch((err) => setError(err.message));
  }, [form.ubicacionId, sessionToken]);

  const technicians = users.map((item) => {
    const label = pick(item, ['NombreCompleto', 'Nombre']);
    const parts = String(label).split(/\s+/);
    return {
      value: String(pick(item, ['UsuarioID', 'id'])),
      label,
      note: pick(item, ['Correo', 'NombreUsuario']),
      initials: `${parts[0]?.[0] || ''}${parts[1]?.[0] || ''}`.toUpperCase(),
    };
  }).filter((item) => item.value && item.label);

  const registered = useMemo(() => devices.reduce((map, item) => ({
    ...map,
    [item.categoria]: (map[item.categoria] || 0) + 1,
  }), {}), [devices]);
  const expectedTotal = Object.values(form.counts).reduce((sum, value) => sum + Number(value || 0), 0);
  const readOnly = editing && form.estado === 'FINALIZADO' && !isAdmin;
  const maintenanceDirty = useMemo(() => (
    Boolean(initialMaintenanceSignatureRef.current)
    && maintenanceSignature(form, devices) !== initialMaintenanceSignatureRef.current
  ), [form, devices]);

  function updateCount(key, value) {
    setForm((current) => ({ ...current, counts: { ...current.counts, [key]: Math.max(0, Number(value || 0)) } }));
  }

  function saveActiveDevice(device) {
    const snapshot = cloneDevice(device);
    setDevices((current) => current.some((item) => item.localId === snapshot.localId)
      ? current.map((item) => item.localId === snapshot.localId ? snapshot : item)
      : [...current, snapshot]);
  }

  function openDevice(device) {
    const snapshot = cloneDevice(device);
    originalDeviceRef.current = cloneDevice(snapshot);
    activeDeviceRef.current = snapshot;
    lastSavedDeviceSignatureRef.current = deviceSignature(snapshot);
    setDeviceAutosaveStatus(snapshot?.id ? 'server' : 'idle');
    setError('');
    setActiveDevice(snapshot);
  }

  function cancelActiveDevice() {
    const current = activeDeviceRef.current;
    const original = originalDeviceRef.current;
    if (!current) return true;
    const changed = deviceSignature(current) !== deviceSignature(original);
    if (changed && !window.confirm('¿Descartar los cambios realizados en este dispositivo?')) return false;

    releasePendingImages(current, original);
    try { localStorage.removeItem(localDraftKey(maintenanceId)); } catch { /* Sin efecto. */ }
    originalDeviceRef.current = null;
    activeDeviceRef.current = null;
    setActiveDevice(null);
    setDeviceAutosaveStatus('idle');
    setError('');
    window.dispatchEvent(new CustomEvent('dms-offline-editing-complete'));
    return true;
  }

  useEffect(() => {
    if (!activeDevice || readOnly || saving || deviceSaving) return undefined;
    const currentSignature = deviceSignature(activeDevice);
    if (currentSignature === lastSavedDeviceSignatureRef.current) {
      setDeviceAutosaveStatus(activeDevice.id ? 'server' : 'idle');
      return undefined;
    }

    setDeviceAutosaveStatus('saving');
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(localDraftKey(maintenanceId), JSON.stringify(serializableDevice(activeDevice)));
        setDeviceAutosaveStatus('local');
      } catch {
        setDeviceAutosaveStatus('error');
      }
    }, LOCAL_DRAFT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [activeDevice, deviceSaving, maintenanceId, readOnly, saving]);

  async function commitActiveDevice(device, { closeAfter = false } = {}) {
    if (!device) return null;
    const valid = Boolean(
      device.categoria
      && device.nombre?.trim()
      && device.zona?.trim()
      && device.fechaTrabajo
      && (device.tecnicoIds || []).length,
    );
    if (!valid) {
      setError('Tipo, nombre, ubicación específica, fecha de trabajo y al menos un técnico son obligatorios.');
      return null;
    }

    if (!editing || !maintenanceId) {
      saveActiveDevice(device);
      const snapshot = cloneDevice(device);
      originalDeviceRef.current = cloneDevice(snapshot);
      lastSavedDeviceSignatureRef.current = deviceSignature(snapshot);
      setDeviceAutosaveStatus('local');
      try { localStorage.removeItem(localDraftKey(maintenanceId)); } catch { /* Sin efecto. */ }
      if (closeAfter) {
        setActiveDevice(null);
        activeDeviceRef.current = null;
        window.dispatchEvent(new CustomEvent('dms-offline-editing-complete'));
      }
      return snapshot;
    }

    if (deviceSavePromiseRef.current) return deviceSavePromiseRef.current;

    const task = (async () => {
      setDeviceSaving(true);
      setDeviceAutosaveStatus('saving');
      setError('');
      try {
        const route = device.id ? MODULE_ROUTES.maintenance.deviceUpdate : MODULE_ROUTES.maintenance.deviceCreate;
        const saved = await requestAvailable(route, maintenanceDevicePayload(device, maintenanceId), sessionToken);
        const deviceId = String(pick(saved, ['EvidenciaMantenimientoID', 'deviceId', 'id'], device.id));
        if (!deviceId) throw new Error('El backend no devolvió el identificador del dispositivo.');

        const savedExistingImageIds = [];
        for (const image of (device.images || []).filter((item) => item.dirty)) {
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
        for (const image of device.newImages || []) {
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
          if (image?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(image.previewUrl);
        }

        const savedSnapshot = {
          ...cloneDevice(device),
          id: deviceId,
          images: [
            ...(device.images || []).map((image) => savedExistingImageIds.includes(image.id) ? { ...image, dirty: false } : { ...image }),
            ...uploadedImages,
          ],
          newImages: [],
        };
        saveActiveDevice(savedSnapshot);
        originalDeviceRef.current = cloneDevice(savedSnapshot);
        activeDeviceRef.current = savedSnapshot;
        lastSavedDeviceSignatureRef.current = deviceSignature(savedSnapshot);
        setDeviceAutosaveStatus('server');
        try { localStorage.removeItem(localDraftKey(maintenanceId)); } catch { /* Sin efecto. */ }

        if (closeAfter) {
          setActiveDevice(null);
          activeDeviceRef.current = null;
          window.dispatchEvent(new CustomEvent('dms-offline-editing-complete'));
        } else {
          setActiveDevice(savedSnapshot);
        }
        return savedSnapshot;
      } catch (err) {
        setDeviceAutosaveStatus('error');
        setError(err.message);
        throw err;
      } finally {
        setDeviceSaving(false);
        deviceSavePromiseRef.current = null;
      }
    })();

    deviceSavePromiseRef.current = task;
    return task;
  }

  async function closeActiveDevice() {
    if (!activeDeviceRef.current) return null;
    try {
      return await commitActiveDevice(activeDeviceRef.current, { closeAfter: true });
    } catch {
      return null;
    }
  }

  async function saveAndAddAnotherDevice() {
    if (!activeDeviceRef.current) return null;
    try {
      const saved = await commitActiveDevice(activeDeviceRef.current, { closeAfter: false });
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
      activeDeviceRef.current = null;
      originalDeviceRef.current = null;
    } catch (err) {
      setError(err.message);
    }
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
        for (const image of (device.images || []).filter((item) => item.dirty)) {
          await requestAvailable(MODULE_ROUTES.maintenance.imageUpdate, { maintenanceId: id, deviceId, imageId: image.id, Tipo: image.Tipo, Nota: image.Nota }, sessionToken);
        }
        for (const image of device.newImages || []) {
          await requestAvailable(MODULE_ROUTES.maintenance.imageUpload, { maintenanceId: id, deviceId, Tipo: image.type, Nota: image.note, fileName: image.file.name, mimeType: image.file.type || 'image/jpeg', base64: await fileToBase64(image.file) }, sessionToken);
        }
      }

      if (action === 'finalize') await requestAvailable(MODULE_ROUTES.maintenance.finalize, { maintenanceId: id }, sessionToken);
      try { localStorage.removeItem(localDraftKey(maintenanceId)); } catch { /* Sin efecto. */ }
      navigate(`/mantenimientos/${encodeURIComponent(id)}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function cancelMaintenanceChanges() {
    if (maintenanceDirty && !window.confirm('¿Cancelar la edición y descartar los cambios del mantenimiento?')) return false;
    try { localStorage.removeItem(localDraftKey(maintenanceId)); } catch { /* Sin efecto. */ }
    navigate(editing ? `/mantenimientos/${encodeURIComponent(maintenanceId)}` : '/mantenimientos');
    return true;
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
    maintenanceDirty,
    updateCount,
    saveActiveDevice,
    commitActiveDevice,
    closeActiveDevice,
    cancelActiveDevice,
    cancelMaintenanceChanges,
    saveAndAddAnotherDevice,
    removeDevice,
    persist,
    createDevice: createDeviceForForm,
    sessionToken,
  };
}
