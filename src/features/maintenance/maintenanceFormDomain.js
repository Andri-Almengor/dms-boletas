function readValue(object, keys, fallback = '') {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return fallback;
}

export function maintenanceClientView(row = {}) {
  return {
    id: String(readValue(row, ['ClienteID', 'ID', 'RowID'])),
    name: readValue(row, ['Nombre', 'Clientes', 'RazonSocial']),
  };
}

export function maintenanceLocationView(row = {}) {
  return {
    id: String(readValue(row, ['UbicacionID', 'ubicacionId', 'id', 'RowID'])),
    name: readValue(row, ['Nombre']),
  };
}

export function maintenanceEquipmentView(row = {}) {
  return {
    id: String(readValue(row, ['UbicacionEquipoID', 'ubicacionEquipoId', 'id', 'RowID'])),
    name: readValue(row, ['Nombre']),
    locationId: String(readValue(row, ['UbicacionID', 'ubicacionId'])),
  };
}

export function activeMaintenanceUsers(rows = []) {
  return rows.filter((item) => String(readValue(item, ['Estado'], 'ACTIVO')).toUpperCase() === 'ACTIVO');
}

export function buildMaintenanceTechnicians(users = []) {
  return users.map((item) => {
    const label = readValue(item, ['NombreCompleto', 'Nombre']);
    const parts = String(label).split(/\s+/);
    return {
      value: String(readValue(item, ['UsuarioID', 'id'])),
      label,
      note: readValue(item, ['Correo', 'NombreUsuario']),
      initials: `${parts[0]?.[0] || ''}${parts[1]?.[0] || ''}`.toUpperCase(),
    };
  }).filter((item) => item.value && item.label);
}

export function countRegisteredMaintenanceDevices(devices = []) {
  return devices.reduce((map, item) => ({
    ...map,
    [item.categoria]: (map[item.categoria] || 0) + 1,
  }), {});
}

export function expectedMaintenanceTotal(counts = {}) {
  return Object.values(counts || {}).reduce((sum, value) => sum + Number(value || 0), 0);
}

export function updateMaintenanceCount(counts = {}, key, value) {
  return {
    ...counts,
    [key]: Math.max(0, Number(value || 0)),
  };
}

export function validateMaintenanceForm(form = {}) {
  if (!String(form.titulo || '').trim()) return 'El título es obligatorio.';
  if (!form.clienteId) return 'Selecciona un cliente.';
  if (!(form.responsables || []).length) return 'Selecciona al menos un responsable.';
  return '';
}

export function maintenanceReadOnly({ editing = false, estado = '', isAdmin = false } = {}) {
  return Boolean(editing && estado === 'FINALIZADO' && !isAdmin);
}

export function filterMaintenanceEquipment(equipment = [], locationId = '') {
  const normalizedLocationId = String(locationId || '').trim();
  if (!normalizedLocationId) return [];
  return equipment.filter((item) => !item.locationId || String(item.locationId) === normalizedLocationId);
}
