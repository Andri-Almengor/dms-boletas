import { badRequest, forbidden } from '../core/errors.js';
import { nowIso, pick } from '../core/utils.js';
import { findById, readTable, updateRow } from '../infra/sheets.repository.js';
import { audit } from '../services/audit.service.js';
import { ensureSheetColumns } from '../services/sheet-columns.service.js';
import { maintenanceAutomationHandlers as baseMaintenanceHandlers } from './maintenance-automation.module.js';

const LOCATION_COLUMN = 'UbicacionesEquipoJSON';
const writeTails = new Map();

function clean(value) {
  return String(value ?? '').trim();
}

function normalized(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isActive(row = {}) {
  return row.Activo !== false && String(row.Estado || 'ACTIVO').toUpperCase() !== 'INACTIVO';
}

function canRemoveMaintenanceLocations(ctx) {
  return ctx.permissions?.includes('USUARIOS_GESTIONAR')
    || ctx.permissions?.includes('MANTENIMIENTOS_GESTIONAR')
    || ctx.permissions?.includes('MANTENIMIENTOS_ELIMINAR');
}

function parseArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function groupId(item) {
  if (typeof item === 'string') return clean(item);
  return clean(pick(item, ['id', 'value', 'UbicacionEquipoID', 'ubicacionEquipoId']));
}

function parseStoredGroups(maintenance = {}) {
  return parseArray(maintenance[LOCATION_COLUMN]).map((item) => {
    if (typeof item === 'string') return { id: clean(item) };
    return {
      id: groupId(item),
      name: clean(pick(item, ['name', 'nombre', 'Nombre', 'UbicacionEquipoNombre'])),
      locationId: clean(pick(item, ['locationId', 'ubicacionId', 'UbicacionID'])),
      locationName: clean(pick(item, ['locationName', 'ubicacionNombre', 'UbicacionNombre'])),
    };
  }).filter((item) => item.id);
}

function requestedGroupIds(payload = {}) {
  const source = payload.UbicacionesEquipoJSON
    ?? payload.ubicacionesEquipoJSON
    ?? payload.UbicacionesEquipoIDs
    ?? payload.ubicacionesEquipoIds
    ?? payload.locationIds
    ?? payload.locations
    ?? [];
  return [...new Set(parseArray(source).map(groupId).filter((id) => id && !id.startsWith('legacy:')))];
}

function serializeGroups(groups = []) {
  return JSON.stringify(groups.map((group) => ({
    id: clean(group.id),
    name: clean(group.name),
    locationId: clean(group.locationId),
    locationName: clean(group.locationName),
  })).filter((group) => group.id));
}

function withLocationWrite(maintenanceId, operation) {
  const key = clean(maintenanceId);
  const previous = writeTails.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  const settled = current.catch(() => {});
  writeTails.set(key, settled);
  settled.finally(() => {
    if (writeTails.get(key) === settled) writeTails.delete(key);
  });
  return current;
}

async function catalogContext(maintenance) {
  const [equipmentRows, clientLocations] = await Promise.all([
    readTable('ClienteUbicacionesEquipo'),
    readTable('ClienteUbicaciones'),
  ]);
  let clientId = clean(maintenance.ClienteID);
  if (!clientId && maintenance.UbicacionID) {
    clientId = clean(clientLocations.find((row) => clean(row.UbicacionID) === clean(maintenance.UbicacionID))?.ClienteID);
  }
  const allowedLocationIds = new Set(clientLocations
    .filter((row) => !clientId || clean(row.ClienteID) === clientId)
    .map((row) => clean(row.UbicacionID))
    .filter(Boolean));
  const locationNames = new Map(clientLocations.map((row) => [clean(row.UbicacionID), clean(row.Nombre)]));
  const equipmentById = new Map(equipmentRows.map((row) => [clean(row.UbicacionEquipoID), row]));
  return { clientId, allowedLocationIds, locationNames, equipmentById };
}

function snapshotFromCatalog(row, locationNames) {
  const locationId = clean(row?.UbicacionID);
  return {
    id: clean(row?.UbicacionEquipoID),
    name: clean(row?.Nombre),
    locationId,
    locationName: clean(locationNames.get(locationId)),
  };
}

async function resolveRequestedGroups(maintenance, requestedIds, devices = []) {
  const context = await catalogContext(maintenance);
  const stored = parseStoredGroups(maintenance);
  const storedById = new Map(stored.map((group) => [group.id, group]));
  const deviceIds = new Set(devices.map((device) => clean(device.UbicacionEquipoID)).filter(Boolean));
  const result = [];

  for (const id of requestedIds) {
    const row = context.equipmentById.get(id);
    if (row) {
      if (!context.allowedLocationIds.has(clean(row.UbicacionID))) {
        throw badRequest('Una de las ubicaciones del equipo no pertenece al cliente seleccionado en el mantenimiento.');
      }
      if (!isActive(row) && !storedById.has(id) && !deviceIds.has(id)) {
        throw badRequest(`La ubicación del equipo “${clean(row.Nombre) || id}” está inactiva y no puede agregarse al mantenimiento.`);
      }
      result.push(snapshotFromCatalog(row, context.locationNames));
      continue;
    }

    const historical = storedById.get(id);
    if (historical && deviceIds.has(id)) {
      result.push(historical);
      continue;
    }
    throw badRequest('Una de las ubicaciones del equipo seleccionadas ya no existe. Actualice el catálogo e inténtelo nuevamente.');
  }

  return result;
}

async function buildLocationGroups(maintenance, devices = []) {
  const context = await catalogContext(maintenance);
  const stored = parseStoredGroups(maintenance);
  const storedById = new Map(stored.map((group) => [group.id, group]));
  const orderedIds = stored.map((group) => group.id);
  const deviceNameFallback = new Map();

  devices.forEach((device) => {
    const id = clean(device.UbicacionEquipoID);
    if (id && !orderedIds.includes(id)) orderedIds.push(id);
    if (id) deviceNameFallback.set(id, clean(device.UbicacionEquipoNombre || device.Zona));
  });

  const groups = orderedIds.map((id) => {
    const row = context.equipmentById.get(id);
    const storedGroup = storedById.get(id) || {};
    const snapshot = row ? snapshotFromCatalog(row, context.locationNames) : storedGroup;
    return {
      id,
      name: clean(snapshot.name || deviceNameFallback.get(id) || 'Ubicación no disponible'),
      locationId: clean(snapshot.locationId),
      locationName: clean(snapshot.locationName),
      description: clean(row?.Descripcion),
      active: row ? isActive(row) : false,
      available: Boolean(row),
      deviceCount: devices.filter((device) => clean(device.UbicacionEquipoID) === id).length,
    };
  });

  const legacyByName = new Map();
  devices.filter((device) => !clean(device.UbicacionEquipoID)).forEach((device) => {
    const name = clean(device.UbicacionEquipoNombre || device.Zona || 'Sin ubicación');
    const id = `legacy:${normalized(name) || 'sin-ubicacion'}`;
    if (!legacyByName.has(id)) legacyByName.set(id, {
      id,
      name,
      locationId: '',
      locationName: '',
      description: 'Registro histórico sin identificador de ubicación.',
      active: false,
      available: false,
      deviceCount: 0,
      legacy: true,
    });
    legacyByName.get(id).deviceCount += 1;
  });

  return [...groups, ...legacyByName.values()];
}

async function persistSelection(ctx, maintenance, groups, action) {
  await ensureSheetColumns('Mantenimiento', [LOCATION_COLUMN]);
  const before = parseStoredGroups(maintenance);
  const after = await updateRow('Mantenimiento', maintenance.MantenimientoID, {
    [LOCATION_COLUMN]: serializeGroups(groups),
    ActualizadoPor: ctx.user.UsuarioID,
    FechaActualizacion: nowIso(),
  });
  await audit(ctx, action, 'Mantenimiento', maintenance.MantenimientoID, { [LOCATION_COLUMN]: before }, { [LOCATION_COLUMN]: groups });
  return after;
}

async function locationsUpdate(ctx) {
  const maintenanceId = clean(pick(ctx.payload, ['maintenanceId', 'MantenimientoID', 'id']));
  if (!maintenanceId) throw badRequest('No se indicó el mantenimiento.');

  return withLocationWrite(maintenanceId, async () => {
    const maintenance = await findById('Mantenimiento', maintenanceId);
    if (String(maintenance.Estado || 'PENDIENTE').toUpperCase() !== 'PENDIENTE') {
      throw badRequest('Las ubicaciones solo pueden modificarse mientras el mantenimiento está pendiente.');
    }

    const devices = (await readTable('Evidencia_Mantenimientos'))
      .filter((device) => clean(device.MantenimientoRef) === maintenanceId && device.Activo !== false);
    const requestedIds = requestedGroupIds(ctx.payload);
    const requestedSet = new Set(requestedIds);
    const storedIds = parseStoredGroups(maintenance).map((group) => group.id).filter(Boolean);
    const removedIds = storedIds.filter((id) => !requestedSet.has(id));

    if (removedIds.length && !canRemoveMaintenanceLocations(ctx)) {
      throw forbidden('Los técnicos pueden agregar ubicaciones, pero solo un administrador puede retirarlas del mantenimiento.');
    }

    const usedIds = [...new Set(devices.map((device) => clean(device.UbicacionEquipoID)).filter(Boolean))];
    const missingUsed = usedIds.filter((id) => !requestedSet.has(id));
    if (missingUsed.length) {
      throw badRequest('No se puede quitar una ubicación que todavía tiene dispositivos. Mueva o elimine primero esos dispositivos.');
    }

    const groups = await resolveRequestedGroups(maintenance, requestedIds, devices);
    await persistSelection(ctx, maintenance, groups, 'ACTUALIZAR_UBICACIONES_MANTENIMIENTO');
    return get({ ...ctx, payload: { maintenanceId } });
  });
}

async function ensureDeviceLocationGroup(ctx, result) {
  const maintenanceId = clean(pick(result, ['MantenimientoRef'], pick(ctx.payload, ['maintenanceId', 'MantenimientoID', 'MantenimientoRef'])));
  const equipmentLocationId = clean(pick(result, ['UbicacionEquipoID'], pick(ctx.payload, ['UbicacionEquipoID', 'ubicacionEquipoId'])));
  if (!maintenanceId || !equipmentLocationId) return;

  await withLocationWrite(maintenanceId, async () => {
    const maintenance = await findById('Mantenimiento', maintenanceId);
    const current = parseStoredGroups(maintenance);
    if (current.some((group) => group.id === equipmentLocationId)) return;
    const groups = await resolveRequestedGroups(maintenance, [...current.map((group) => group.id), equipmentLocationId]);
    await persistSelection(ctx, maintenance, groups, 'AGREGAR_UBICACION_MANTENIMIENTO_AUTOMATICA');
  });
}

async function get(ctx) {
  const data = await baseMaintenanceHandlers.get(ctx);
  const maintenance = data?.mantenimiento || {};
  const devices = data?.dispositivos || [];
  const groups = await buildLocationGroups(maintenance, devices);
  return {
    ...data,
    mantenimiento: {
      ...maintenance,
      [LOCATION_COLUMN]: serializeGroups(groups.filter((group) => !group.legacy)),
    },
    ubicacionesEquipo: groups,
    equipmentLocations: groups,
  };
}

async function deviceCreate(ctx) {
  const result = await baseMaintenanceHandlers.deviceCreate(ctx);
  await ensureDeviceLocationGroup(ctx, result);
  return result;
}

async function deviceUpdate(ctx) {
  const result = await baseMaintenanceHandlers.deviceUpdate(ctx);
  await ensureDeviceLocationGroup(ctx, result);
  return result;
}

async function deviceAutosave(ctx) {
  const result = await baseMaintenanceHandlers.deviceAutosave(ctx);
  await ensureDeviceLocationGroup(ctx, result);
  return result;
}

export const maintenanceLocationGroupHandlers = {
  ...baseMaintenanceHandlers,
  get,
  locationsUpdate,
  deviceCreate,
  deviceUpdate,
  deviceAutosave,
};
