function readValue(object, keys, fallback = '') {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return fallback;
}

export function maintenanceDeviceId(device = {}) {
  return String(readValue(device, [
    'id',
    'localId',
    'EvidenciaMantenimientoID',
    'deviceId',
  ], '')).trim();
}

export function resolveMaintenanceDirectRequest(searchParams, editing = false) {
  const get = (key) => String(searchParams?.get?.(key) || '').trim();
  const directDeviceMode = Boolean(editing && get('directDevice') === '1');
  const requestedNewDevice = Boolean(directDeviceMode && get('newDevice') === '1');

  return {
    directDeviceMode,
    requestedNewDevice,
    requestedStep: get('step') === 'devices' || directDeviceMode ? 2 : 0,
    requestedDeviceId: get('device'),
  };
}

export function maintenanceProgress(step, totalSteps) {
  const safeTotal = Math.max(1, Number(totalSteps) || 1);
  const safeStep = Math.min(Math.max(0, Number(step) || 0), safeTotal - 1);
  return Math.round(((safeStep + 1) / safeTotal) * 100);
}

export function createMaintenanceQuickModal(type) {
  return {
    type,
    values: {
      nombre: '',
      direccion: '',
      descripcion: '',
    },
  };
}

export function validateMaintenanceQuickModal(modal) {
  if (!String(modal?.values?.nombre || '').trim()) return 'El nombre es obligatorio.';
  return '';
}

export function mapCreatedMaintenanceLocation(result = {}, fallbackName = '') {
  return {
    id: String(readValue(result, ['UbicacionID', 'id'])),
    name: readValue(result, ['Nombre'], fallbackName),
  };
}

export function mapCreatedMaintenanceEquipment(result = {}, fallbackName = '') {
  return {
    id: String(readValue(result, ['UbicacionEquipoID', 'id'])),
    name: readValue(result, ['Nombre'], fallbackName),
  };
}
