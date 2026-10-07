import {
  canonicalMaintenanceCategoryName,
  getMaintenanceCategory,
} from '../../config/maintenanceCategories.js';
import { isProjectMaintenance } from './maintenanceType.js';
import { normalizeProjectChecklist } from './maintenanceProjectChecklist.js';

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

export function countMaintenanceDevicesByCategory(devices = []) {
  return devices.reduce((map, item) => {
    const rawCategory = readValue(
      item,
      ['categoria', 'Categoria', 'TipoDispositivo'],
      'Dispositivo',
    );
    const category = canonicalMaintenanceCategoryName(rawCategory);
    return {
      ...map,
      [category]: (map[category] || 0) + 1,
    };
  }, {});
}

function firstArrayLength(item = {}, keys = []) {
  for (const key of keys) {
    if (Array.isArray(item?.[key])) return item[key].length;
  }
  return 0;
}

export function countMaintenanceEvidence(devices = []) {
  return (devices || []).reduce((sum, item) => (
    sum
    + firstArrayLength(item, ['images', 'Imagenes', 'imagenes'])
    + firstArrayLength(item, ['newImages', 'NuevasImagenes', 'nuevasImagenes'])
  ), 0);
}

function normalizedDynamicCountName(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ');
}

export function shadowedMaintenanceCountKeys(devices = []) {
  const keys = new Set();

  (devices || []).forEach((device) => {
    const rawCategory = readValue(device, ['categoria', 'Categoria', 'TipoDispositivo']);
    const category = getMaintenanceCategory(rawCategory);
    if (!category.countField) return;

    const typeId = String(readValue(device, ['tipoDispositivoId', 'TipoDispositivoID'])).trim();
    if (typeId) keys.add(`TipoDispositivo:${typeId}`);

    const normalizedName = normalizedDynamicCountName(rawCategory);
    if (normalizedName) keys.add(`TipoDispositivoNombre:${normalizedName}`);
  });

  return keys;
}

export function expectedMaintenanceTotal(counts = {}, devices = []) {
  const shadowedKeys = shadowedMaintenanceCountKeys(devices);
  return Object.entries(counts || {}).reduce(
    (sum, [key, value]) => sum + (shadowedKeys.has(key) ? 0 : Number(value || 0)),
    0,
  );
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
  if (isProjectMaintenance(form.tipoMantenimiento)) {
    const checklist = normalizeProjectChecklist(form.projectChecklist);
    const blank = checklist.groups.flatMap((group) => group.questions || []).find((question) => !String(question.label || '').trim());
    if (blank) return 'Complete el texto de todas las preguntas del checklist de progreso o elimine las filas vacías.';
  }
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
