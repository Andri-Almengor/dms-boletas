import { badRequest, notFound } from '../core/errors.js';
import { nowIso } from '../core/utils.js';
import {
  ensureColumns,
  readTable,
  readTables,
  updateRow,
} from '../infra/sheets.repository.js';
import { ensureIntegrationGatewaySchema } from './integration-gateway.service.js';

const DEVICES_SHEET = 'IntegracionDispositivos';
const DEVICE_ADMIN_COLUMNS = Object.freeze([
  'UbicacionClienteID',
  'UbicacionCliente',
  'UbicacionEquipoID',
  'UbicacionEquipo',
]);

function text(value, maxLength = 250) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function active(row = {}) {
  return row.Activo !== false && String(row.Activo ?? 'true').toLowerCase() !== 'false';
}

async function currentDevice(deviceId) {
  await ensureIntegrationGatewaySchema();
  await ensureColumns(DEVICES_SHEET, DEVICE_ADMIN_COLUMNS);
  const id = text(deviceId, 160);
  if (!id) throw badRequest('El dispositivo es obligatorio.');
  const current = (await readTable(DEVICES_SHEET))
    .find((item) => String(item.DispositivoIntegracionID || '') === id);
  if (!current) throw notFound('No se encontró el dispositivo de integración solicitado.');
  return current;
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
    location = (tables.ClienteUbicaciones || []).find((row) => (
      active(row)
      && text(row.UbicacionID, 220) === selectedLocationId
      && text(row.ClienteID, 220) === clientId
    ));
    if (!location) throw badRequest('La ubicación seleccionada no pertenece al cliente del gateway.');
  }

  if (selectedEquipmentId) {
    equipment = (tables.ClienteUbicacionesEquipo || []).find((row) => (
      active(row)
      && text(row.UbicacionEquipoID, 220) === selectedEquipmentId
      && text(row.UbicacionID, 220) === selectedLocationId
    ));
    if (!equipment) throw badRequest('La ubicación del equipo no pertenece a la ubicación del cliente seleccionada.');
  }

  const operationalName = text(name, 250);
  const updated = await updateRow(DEVICES_SHEET, current.DispositivoIntegracionID, {
    NombreOperativo: operationalName,
    UbicacionClienteID: selectedLocationId,
    UbicacionCliente: text(location?.Nombre, 250),
    UbicacionEquipoID: selectedEquipmentId,
    UbicacionEquipo: text(equipment?.Nombre, 250),
    FechaActualizacion: nowIso(),
  });

  return {
    ...updated,
    NombreOperativo: operationalName,
    UbicacionClienteID: selectedLocationId,
    UbicacionCliente: text(location?.Nombre, 250),
    UbicacionEquipoID: selectedEquipmentId,
    UbicacionEquipo: text(equipment?.Nombre, 250),
    displayName: operationalName || current.NombreDetectado || '',
    updatedBy: actor,
  };
}
