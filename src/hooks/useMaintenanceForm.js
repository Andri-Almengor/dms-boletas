import { useEffect, useMemo, useState } from 'react';
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

export default function useMaintenanceForm({ editing, maintenanceId }) {
  const navigate = useNavigate();
  const { sessionToken, user, hasPermission } = useAuth();
  const isAdmin = hasPermission('USUARIOS_GESTIONAR') || hasPermission('MANTENIMIENTOS_ELIMINAR');
  const canCreate = hasPermission('MANTENIMIENTOS_CREAR') || hasPermission('BOLETAS_CREAR');
  const canEdit = hasPermission('MANTENIMIENTOS_EDITAR') || hasPermission('BOLETAS_EDITAR');
  const canCreateLocation = hasPermission('CLIENTES_DATOS_OPERATIVOS_CREAR') || hasPermission('CLIENTES_EDITAR');
  const [form, setForm] = useState({ ...EMPTY_MAINTENANCE, responsables: user?.UsuarioID ? [String(user.UsuarioID)] : [] });
  const [devices, setDevices] = useState([]);
  const [activeDevice, setActiveDevice] = useState(null);
  const [clients, setClients] = useState([]);
  const [users, setUsers] = useState([]);
  const [locations, setLocations] = useState([]);
  const [equipment, setEquipment] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      requestAvailable(MODULE_ROUTES.clients.list, { page: 1, pageSize: 1000, activo: true }, sessionToken),
      requestAvailable(MODULE_ROUTES.users.list, { page: 1, pageSize: 1000 }, sessionToken),
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
      navigate(`/mantenimientos/${encodeURIComponent(id)}`);
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  }

  return {
    allowed: editing ? canEdit : canCreate, isAdmin, canCreateLocation, form, setForm, devices,
    activeDevice, setActiveDevice, clients, locations, equipment, technicians, loading, saving,
    error, setError, readOnly, registered, expectedTotal, updateCount, saveActiveDevice,
    removeDevice, persist, createDevice: () => createMaintenanceDevice(), sessionToken,
  };
}
