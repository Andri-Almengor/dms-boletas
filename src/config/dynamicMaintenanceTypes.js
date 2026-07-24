import {
  MAINTENANCE_CATEGORIES,
  canonicalMaintenanceCategoryName,
  getMaintenanceCategory,
} from './maintenanceCategories';
import { pick, toBoolean } from '../services/moduleApi';

function normalized(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ');
}

export function activeDeviceType(row = {}) {
  const active = toBoolean(pick(row, ['Activo', 'activo'], true), true);
  const status = String(pick(row, ['Estado', 'estado'], 'ACTIVO')).toUpperCase();
  return active && status !== 'INACTIVO';
}

export function deviceTypeId(row = {}) {
  return String(pick(row, ['TipoDispositivoID', 'ID', 'id'], '') || '').trim();
}

export function deviceTypeName(row = {}) {
  return String(pick(row, ['Nombre', 'nombre'], '') || '').trim();
}

export function maintenanceCountKeyForDeviceType(row = {}) {
  const name = canonicalMaintenanceCategoryName(deviceTypeName(row));
  const known = getMaintenanceCategory(name);
  if (known.countField) return known.countField;

  const id = deviceTypeId(row);
  if (id) return `TipoDispositivo:${id}`;
  return `TipoDispositivoNombre:${normalized(name)}`;
}

export function iconForMaintenanceType(name = '') {
  const known = getMaintenanceCategory(name);
  if (known.icon && known.icon !== 'devices_other') return known.icon;

  const key = normalized(name);
  if (/camara|cctv|video vigilancia/.test(key)) return 'videocam';
  if (/puerta|acceso|lector|cerradura/.test(key)) return 'door_front';
  if (/servidor/.test(key)) return 'dns';
  if (/grabador|nvr|dvr/.test(key)) return 'storage';
  if (/audio|bocina|altavoz/.test(key)) return 'speaker';
  if (/sensor/.test(key)) return 'sensors';
  if (/impresora/.test(key)) return 'print';
  if (/gabinete/.test(key)) return 'inventory_2';
  if (/video wall|videowall/.test(key)) return 'view_quilt';
  return 'devices_other';
}

export function buildDynamicMaintenanceCategories(deviceTypes = [], {
  counts = {},
  registered = {},
} = {}) {
  const activeRows = deviceTypes.filter(activeDeviceType);
  const categories = [];
  const representedNames = new Set();
  const representedKeys = new Set();

  for (const row of activeRows) {
    const rawName = deviceTypeName(row);
    if (!rawName) continue;
    const key = canonicalMaintenanceCategoryName(rawName);
    const known = getMaintenanceCategory(key);
    const countField = maintenanceCountKeyForDeviceType(row);
    const typeId = deviceTypeId(row);
    const dedupeKey = known.countField || typeId || `${normalized(key)}|${countField}`;
    if (representedKeys.has(dedupeKey)) continue;

    categories.push({
      key,
      label: known.countField ? key : rawName,
      icon: iconForMaintenanceType(key),
      countField,
      questions: known.questions || [],
      typeId,
      source: 'catalog',
    });
    representedNames.add(normalized(key));
    representedKeys.add(dedupeKey);
  }

  for (const item of MAINTENANCE_CATEGORIES) {
    const usedHistorically = Number(counts[item.countField] || 0) > 0 || Number(registered[item.key] || 0) > 0;
    if (!usedHistorically || representedNames.has(normalized(item.key))) continue;
    categories.push({ ...item, label: item.key, typeId: '', source: 'legacy' });
  }

  if (!categories.length) {
    return MAINTENANCE_CATEGORIES.map((item) => ({ ...item, label: item.key, typeId: '', source: 'fallback' }));
  }

  return categories.sort((left, right) => {
    if (left.source === 'catalog' && right.source !== 'catalog') return -1;
    if (left.source !== 'catalog' && right.source === 'catalog') return 1;
    return String(left.label || left.key).localeCompare(String(right.label || right.key), 'es');
  });
}

export function selectedMaintenanceCategories(deviceTypes = [], counts = {}, registered = {}) {
  return buildDynamicMaintenanceCategories(deviceTypes, { counts, registered })
    .filter((item) => Number(counts[item.countField] || 0) > 0);
}

export function hasSelectedMaintenanceCategory(counts = {}) {
  return Object.values(counts || {}).some((value) => Number(value || 0) > 0);
}

export function parseMaintenanceCounts(row = {}) {
  let counts = {};
  try {
    counts = typeof row.CantidadesJSON === 'string'
      ? JSON.parse(row.CantidadesJSON || '{}')
      : row.CantidadesJSON || {};
  } catch {
    counts = {};
  }

  for (const item of MAINTENANCE_CATEGORIES) {
    if (row[item.countField] !== undefined && row[item.countField] !== '') {
      counts[item.countField] = Number(row[item.countField] || 0);
    }
  }
  return counts;
}
