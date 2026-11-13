import { badRequest, forbidden } from '../core/errors.js';
import { createHash } from 'node:crypto';
import { nowIso, pick } from '../core/utils.js';
import { query, withTransaction } from '../infra/postgres.js';
import { expectedMaintenanceCountForDevice, raiseExpectedCountsForCreatedDevices } from './maintenance.module.js';
import { appendRows, findById, readTable, updateRow } from '../infra/sheets.repository.js';
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
        // A maintenance may have been moved to another client. Preserve only
        // locations already stored or referenced by its own devices so they
        // can be migrated; never authorize adding a new foreign location.
        if (storedById.has(id) || deviceIds.has(id)) {
          result.push(snapshotFromCatalog(row, context.locationNames));
          continue;
        }
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
    const foreignClient = Boolean(row && context.clientId && !context.allowedLocationIds.has(clean(row.UbicacionID)));
    return {
      id,
      name: clean(snapshot.name || deviceNameFallback.get(id) || 'Ubicación no disponible'),
      locationId: clean(snapshot.locationId),
      locationName: clean(snapshot.locationName),
      description: foreignClient
        ? 'Ubicación del cliente anterior. Reasigne sus dispositivos a ubicaciones del cliente actual antes de retirarla.'
        : clean(row?.Descripcion),
      foreignClient,
      active: row ? isActive(row) && !foreignClient : false,
      available: Boolean(row) && !foreignClient,
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


const MAX_IMPORTED_INVENTORY_DEVICES = 2000;

function sameImportIdentity(row = {}) {
  const categoryKey = normalized(row.TipoDispositivoID || row.TipoDispositivo || row.Categoria);
  const locationKey = clean(row.UbicacionEquipoID);
  const serialKey = normalized(row.Serie);
  const macKey = normalized(row.DireccionMAC);
  const nameKey = normalized(row.NombreDispositivo);
  if (!categoryKey || !locationKey || !(serialKey || macKey || nameKey)) return '';
  return [locationKey,categoryKey,serialKey
    ? 'serial:' + serialKey : macKey ? 'mac:' + macKey : 'name:' + nameKey].join('|');
}

function inventoryImportedDeviceId(maintenanceId, inventoryDeviceId) {
  return 'inv-' + createHash('sha256')
    .update(clean(maintenanceId) + '|inventory|' + clean(inventoryDeviceId))
    .digest('hex').slice(0, 32);
}

/**
 * Recicla únicamente características técnicas. Estado, fecha de trabajo,
 * checklist, observaciones, imágenes y asignaciones NO pasan a una visita nueva.
 */
function inventoryDeviceToMaintenanceRow(item, { maintenanceId, equipmentLocationId, equipmentLocationName, actor }) {
  const details = item.details && typeof item.details === 'object' && !Array.isArray(item.details)
    ? item.details : {};
  const category = clean(item.device_type);
  const current = nowIso();
  return {
    EvidenciaMantenimientoID: inventoryImportedDeviceId(maintenanceId, item.device_id),
    MantenimientoRef: maintenanceId,
    UbicacionEquipoID: equipmentLocationId,
    Zona: equipmentLocationName,
    Categoria: category,
    TipoDispositivo: category,
    TipoDispositivoID: clean(details.typeId),
    NombreDispositivo: clean(item.device_name),
    FabricanteID: clean(details.manufacturerId),
    Fabricante: clean(item.manufacturer),
    ModeloID: clean(details.modelId),
    Modelo: clean(item.model),
    Serie: clean(item.serial),
    DireccionMAC: clean(item.mac),
    // Nueva visita: absolutamente ninguna evidencia/checklist cumplido.
    Funcionamiento: '',
    EnUso: '',
    Estado: 'Pendiente',
    Observacion: '',
    RespuestasJSON: '{}',
    TecnicoIDsJSON: '[]',
    Tecnicos: '',
    FechaTrabajo: '',
    Activo: true,
    CreadoPor: actor,
    FechaCreacion: current,
    ActualizadoPor: actor,
    FechaActualizacion: current,
  };
}

async function inventoryDevicesForEquipmentLocation(clientId, equipmentLocationId) {
  const result = await query(
    'SELECT d.device_id,d.device_type,d.device_name,d.manufacturer,d.model,'
    + ' d.serial,d.mac,d.details FROM dms_client_inventory_devices d'
    + ' JOIN dms_client_inventory inv ON inv.client_id=d.client_id'
    + ' WHERE d.client_id=$1 AND d.details->>\\'equipmentLocationId\\'=$2'
    + ' ORDER BY d.device_id LIMIT $3',
    [clientId,equipmentLocationId,MAX_IMPORTED_INVENTORY_DEVICES+1],
    { label: 'maintenance.locations.inventory.source' },
  );
  if (result.rows.length > MAX_IMPORTED_INVENTORY_DEVICES) {
    throw badRequest('La ubicación contiene demasiados equipos para importar de una vez. Divida la carga por etapas.');
  }
  return result.rows;
}

async function prepareInventoryLocationImport(ctx, maintenance, location, currentDevices) {
  const source = await inventoryDevicesForEquipmentLocation(clean(maintenance.ClienteID), location.id);
  if (!source.length) throw badRequest(
    'La ubicación seleccionada no tiene dispositivos en el inventario generado de este cliente. Actualice el inventario o agregue solo la ubicación.');
  const ids = new Set(currentDevices.map((device) => clean(device.EvidenciaMantenimientoID)));
  const identities = new Set(currentDevices.filter((device) =>
    device.Activo !== false && clean(device.Activo).toLowerCase() !== 'false')
    .map(sameImportIdentity).filter(Boolean));
  const rowsToCreate = [];
  for (const item of source) {
    const row = inventoryDeviceToMaintenanceRow(item, {
      maintenanceId: clean(maintenance.MantenimientoID),
      equipmentLocationId: location.id,
      equipmentLocationName: location.name,
      actor: clean(ctx.user.UsuarioID),
    });
    if (!row.NombreDispositivo || !row.Categoria) continue;
    const identity = sameImportIdentity(row);
    if (ids.has(row.EvidenciaMantenimientoID) || (identity && identities.has(identity))) continue;
    ids.add(row.EvidenciaMantenimientoID);
    if (identity) identities.add(identity);
    rowsToCreate.push(row);
  }
  // Conserva el mismo requisito del alta de dispositivos: solo tipos
  // planificados con cantidad mayor a cero se pueden agregar.
  const forbiddenTypes = [...new Set(rowsToCreate.filter((row) =>
    expectedMaintenanceCountForDevice(maintenance,row).planned <= 0)
    .map((row) => row.TipoDispositivo))];
  if (forbiddenTypes.length) {
    throw badRequest('El inventario incluye tipos sin cantidad planificada: '
      + forbiddenTypes.slice(0, 8).join(', ')
      + '. Edite las cantidades esperadas del mantenimiento antes de importar.');
  }
  return { rowsToCreate, sourceCount: source.length };
}

async function locationsUpdate(ctx) {
  const maintenanceId = clean(pick(ctx.payload, ['maintenanceId', 'MantenimientoID', 'id']));
  if (!maintenanceId) throw badRequest('No se indicó el mantenimiento.');

  return withLocationWrite(maintenanceId, () => withTransaction(async () => {
    // Misma fila que bloquea maintenance.deviceCreate en PostgreSQL; funciona
    // con varias instancias de Render, sin confiar en writeTails en memoria.
    const locked = await query(
      'SELECT "MantenimientoID" FROM "Mantenimiento"'
      + ' WHERE "__valid"=TRUE AND "MantenimientoID"=$1 FOR UPDATE',
      [maintenanceId], { label: 'maintenance.locations.lock' });
    if (!locked.rowCount) throw badRequest('El mantenimiento ya no está disponible.');
    const maintenance = await findById('Mantenimiento', maintenanceId);
    if (String(maintenance.Estado || 'PENDIENTE').toUpperCase() !== 'PENDIENTE') {
      throw badRequest('Las ubicaciones solo pueden modificarse mientras el mantenimiento está pendiente.');
    }

    const existing = await query(
      'SELECT "EvidenciaMantenimientoID","UbicacionEquipoID","TipoDispositivoID",'
      + ' "TipoDispositivo","Categoria","NombreDispositivo","Serie","DireccionMAC","Activo"'
      + ' FROM "Evidencia_Mantenimientos" WHERE "__valid"=TRUE AND "MantenimientoRef"=$1',
      [maintenanceId], { label: 'maintenance.locations.existingDevices' });
    const allDevices = existing.rows || [];
    const devices = allDevices.filter((device) =>
      device.Activo !== false && clean(device.Activo).toLowerCase() !== 'false');
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
    const importId = clean(ctx.payload?.importInventoryLocationId);
    let imported = [];
    if (importId) {
      if (!requestedSet.has(importId)) {
        throw badRequest('La ubicación a importar no forma parte de las ubicaciones seleccionadas.');
      }
      if (clean(maintenance.TipoMantenimiento).toUpperCase() === 'PROYECTO') {
        throw badRequest('Los proyectos requieren su propio registro de equipos y checklist; no se importan automáticamente.');
      }
      const group = groups.find((item) => item.id === importId);
      if (!group) throw badRequest('No se encontró la ubicación seleccionada para importar.');
      const prepared = await prepareInventoryLocationImport(ctx, maintenance, group, allDevices);
      imported = prepared.rowsToCreate;
    }
    await persistSelection(ctx, maintenance, groups, 'ACTUALIZAR_UBICACIONES_MANTENIMIENTO');
    if (imported.length) {
      // La misma API de persistencia PostgreSQL para altas normales,
      // ahora con INSERT batch en la transacción del cambio de ubicación.
      await appendRows('Evidencia_Mantenimientos', imported);
      await raiseExpectedCountsForCreatedDevices(ctx, maintenance, imported);
      await audit(ctx,'IMPORTAR_UBICACION_DESDE_INVENTARIO','Mantenimiento',maintenanceId,null,{
        ubicacionEquipoId:importId, cantidad:imported.length,
      });
    }
    const result = await get({ ...ctx, payload: { maintenanceId } });
    return { ...result, importedInventoryDevices: imported.length };
  }));
}

// Validate only a newly assigned location. Existing historical references
// remain editable until the user explicitly moves their devices.
async function validateNewDeviceLocation(ctx, existing = null) {
  const requestedMaintenanceId = clean(pick(ctx.payload,
    ['maintenanceId', 'MantenimientoID', 'MantenimientoRef']));
  const originalMaintenanceId = clean(existing?.MantenimientoRef);
  if (originalMaintenanceId && requestedMaintenanceId && requestedMaintenanceId !== originalMaintenanceId) {
    throw badRequest('El dispositivo no pertenece al mantenimiento indicado.');
  }
  const locationId = clean(pick(ctx.payload, ['UbicacionEquipoID', 'ubicacionEquipoId']));
  if (!locationId || (existing && locationId === clean(existing.UbicacionEquipoID))) return;
  const maintenanceId = originalMaintenanceId || requestedMaintenanceId;
  if (!maintenanceId) return;
  const maintenance = await findById('Mantenimiento', maintenanceId);
  let location;
  try {
    location = await findById('ClienteUbicacionesEquipo', locationId);
  } catch {
    throw badRequest('La ubicación del equipo seleccionada no existe. Actualice el catálogo.');
  }
  let parent;
  try {
    parent = await findById('ClienteUbicaciones', clean(location.UbicacionID));
  } catch {
    throw badRequest('La ubicación del equipo no tiene una ubicación principal válida.');
  }
  if (clean(parent.ClienteID) !== clean(maintenance.ClienteID)) {
    throw badRequest('La ubicación del equipo seleccionada pertenece a otro cliente. Elija una ubicación del cliente actual.');
  }
  if (!isActive(location) || !isActive(parent)) {
    throw badRequest('La ubicación del equipo seleccionada está inactiva.');
  }
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
  await validateNewDeviceLocation(ctx);
  const result = await baseMaintenanceHandlers.deviceCreate(ctx);
  await ensureDeviceLocationGroup(ctx, result);
  return result;
}

async function deviceUpdate(ctx) {
  const id = clean(pick(ctx.payload, ['deviceId', 'EvidenciaMantenimientoID']));
  const existing = await findById('Evidencia_Mantenimientos', id);
  await validateNewDeviceLocation(ctx, existing);
  const result = await baseMaintenanceHandlers.deviceUpdate(ctx);
  await ensureDeviceLocationGroup(ctx, result);
  return result;
}

async function deviceAutosave(ctx) {
  const id = clean(pick(ctx.payload, ['deviceId', 'EvidenciaMantenimientoID']));
  const existing = await findById('Evidencia_Mantenimientos', id);
  await validateNewDeviceLocation(ctx, existing);
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
