import { badRequest, notFound } from '../core/errors.js';
import { nowIso } from '../core/utils.js';
import {
  ensureColumns,
  readTable,
  readTables,
  updateRow,
  updateRows,
} from '../infra/sheets.repository.js';
import { ensureIntegrationGatewaySchema } from './integration-gateway.service.js';

const DEVICES_SHEET = 'IntegracionDispositivos';
const DEVICE_ADMIN_COLUMNS = Object.freeze([
  'UbicacionClienteID',
  'UbicacionCliente',
  'UbicacionEquipoID',
  'UbicacionEquipo',
]);
const MAX_BATCH_DEVICES = 500;

function text(value, maxLength = 250) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function active(row = {}) {
  return row.Activo !== false && String(row.Activo ?? 'true').toLowerCase() !== 'false';
}

async function prepareDeviceAdminSchema() {
  await ensureIntegrationGatewaySchema();
  await ensureColumns(DEVICES_SHEET, DEVICE_ADMIN_COLUMNS);
}

async function currentDevice(deviceId) {
  await prepareDeviceAdminSchema();
  const id = text(deviceId, 160);
  if (!id) throw badRequest('El dispositivo es obligatorio.');
  const current = (await readTable(DEVICES_SHEET))
    .find((item) => String(item.DispositivoIntegracionID || '') === id);
  if (!current) throw notFound('No se encontró el dispositivo de integración solicitado.');
  return current;
}

function resolveLocationSelection({
  clientId,
  locationId = '',
  equipmentLocationId = '',
  locations = [],
  equipmentLocations = [],
} = {}) {
  const selectedLocationId = text(locationId, 220);
  const selectedEquipmentId = text(equipmentLocationId, 220);
  let location = null;
  let equipment = null;

  if ((selectedLocationId || selectedEquipmentId) && !clientId) {
    throw badRequest('Primero relacione el gateway con un cliente para asignar ubicaciones.');
  }
  if (selectedEquipmentId && !selectedLocationId) {
    throw badRequest('Seleccione primero la ubicación del cliente.');
  }

  if (selectedLocationId) {
    location = locations.find((row) => (
      active(row)
      && text(row.UbicacionID, 220) === selectedLocationId
      && text(row.ClienteID, 220) === clientId
    ));
    if (!location) throw badRequest('La ubicación seleccionada no pertenece al cliente del gateway.');
  }

  if (selectedEquipmentId) {
    equipment = equipmentLocations.find((row) => (
      active(row)
      && text(row.UbicacionEquipoID, 220) === selectedEquipmentId
      && text(row.UbicacionID, 220) === selectedLocationId
    ));
    if (!equipment) throw badRequest('La ubicación del equipo no pertenece a la ubicación del cliente seleccionada.');
  }

  return {
    locationId: selectedLocationId,
    locationName: text(location?.Nombre, 250),
    equipmentLocationId: selectedEquipmentId,
    equipmentLocationName: text(equipment?.Nombre, 250),
  };
}

export async function updateIntegrationDeviceOperationalName({
  deviceId,
  name,
  actor = 'SYSTEM',
} = {}) {
  const current = await currentDevice(deviceId);
  const operationalName = text(name, 250);
  const updated = await updateRow(DEVICES_SHEET, current.DispositivoIntegracionID, {
    NombreOperativo: operationalName,
    FechaActualizacion: nowIso(),
  });

  return {
    ...updated,
    NombreOperativo: operationalName,
    displayName: operationalName || current.NombreDetectado || '',
    updatedBy: actor,
  };
}

export async function updateIntegrationDeviceProfile({
  deviceId,
  name,
  locationId = '',
  equipmentLocationId = '',
  actor = 'SYSTEM',
} = {}) {
  const current = await currentDevice(deviceId);
  const tables = await readTables([
    'IntegracionGateways',
    'ClienteUbicaciones',
    'ClienteUbicacionesEquipo',
  ]);
  const gateway = (tables.IntegracionGateways || [])
    .find((item) => String(item.GatewayID || '') === String(current.GatewayID || ''));
  if (!gateway) throw notFound('No se encontró el gateway asociado al dispositivo.');

  const clientId = text(gateway.ClienteID || current.ClienteID, 220);
  const selection = resolveLocationSelection({
    clientId,
    locationId,
    equipmentLocationId,
    locations: tables.ClienteUbicaciones || [],
    equipmentLocations: tables.ClienteUbicacionesEquipo || [],
  });
  const operationalName = text(name, 250);
  const updated = await updateRow(DEVICES_SHEET, current.DispositivoIntegracionID, {
    NombreOperativo: operationalName,
    UbicacionClienteID: selection.locationId,
    UbicacionCliente: selection.locationName,
    UbicacionEquipoID: selection.equipmentLocationId,
    UbicacionEquipo: selection.equipmentLocationName,
    FechaActualizacion: nowIso(),
  });

  return {
    ...updated,
    NombreOperativo: operationalName,
    UbicacionClienteID: selection.locationId,
    UbicacionCliente: selection.locationName,
    UbicacionEquipoID: selection.equipmentLocationId,
    UbicacionEquipo: selection.equipmentLocationName,
    displayName: operationalName || current.NombreDetectado || '',
    updatedBy: actor,
  };
}

export async function updateIntegrationDevicesLocation({
  deviceIds = [],
  locationId = '',
  equipmentLocationId = '',
  actor = 'SYSTEM',
} = {}) {
  await prepareDeviceAdminSchema();
  const ids = [...new Set((Array.isArray(deviceIds) ? deviceIds : [])
    .map((value) => text(value, 160))
    .filter(Boolean))];
  if (!ids.length) throw badRequest('Seleccione al menos un dispositivo.');
  if (ids.length > MAX_BATCH_DEVICES) {
    throw badRequest(`Puede mover como máximo ${MAX_BATCH_DEVICES} dispositivos por operación.`);
  }

  const tables = await readTables([
    DEVICES_SHEET,
    'IntegracionGateways',
    'ClienteUbicaciones',
    'ClienteUbicacionesEquipo',
  ]);
  const devicesById = new Map((tables[DEVICES_SHEET] || [])
    .map((item) => [String(item.DispositivoIntegracionID || ''), item]));
  const selectedDevices = ids.map((id) => devicesById.get(id));
  if (selectedDevices.some((item) => !item)) {
    throw notFound('Uno o más dispositivos seleccionados ya no existen. Actualice el inventario e intente de nuevo.');
  }

  const gatewaysById = new Map((tables.IntegracionGateways || [])
    .map((item) => [String(item.GatewayID || ''), item]));
  const clientIds = new Set(selectedDevices.map((device) => {
    const gateway = gatewaysById.get(String(device.GatewayID || '')) || {};
    return text(gateway.ClienteID || device.ClienteID, 220);
  }));
  if (clientIds.size !== 1 || ![...clientIds][0]) {
    throw badRequest('La asignación masiva solo admite dispositivos de un mismo cliente. Filtre primero por cliente.');
  }
  const clientId = [...clientIds][0];
  const selection = resolveLocationSelection({
    clientId,
    locationId,
    equipmentLocationId,
    locations: tables.ClienteUbicaciones || [],
    equipmentLocations: tables.ClienteUbicacionesEquipo || [],
  });
  if (!selection.equipmentLocationId) {
    throw badRequest('Seleccione la Ubicación del equipo donde se agruparán las cámaras.');
  }

  const timestamp = nowIso();
  const updated = await updateRows(DEVICES_SHEET, ids.map((id) => ({
    idValue: id,
    patch: {
      UbicacionClienteID: selection.locationId,
      UbicacionCliente: selection.locationName,
      UbicacionEquipoID: selection.equipmentLocationId,
      UbicacionEquipo: selection.equipmentLocationName,
      FechaActualizacion: timestamp,
    },
  })));

  return {
    updated: updated.length,
    clientId,
    UbicacionClienteID: selection.locationId,
    UbicacionCliente: selection.locationName,
    UbicacionEquipoID: selection.equipmentLocationId,
    UbicacionEquipo: selection.equipmentLocationName,
    updatedBy: actor,
  };
}
