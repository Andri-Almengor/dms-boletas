import { badRequest, notFound } from '../core/errors.js';
import { nowIso } from '../core/utils.js';
import { readTable, updateRow } from '../infra/sheets.repository.js';
import { ensureIntegrationGatewaySchema } from './integration-gateway.service.js';

const DEVICES_SHEET = 'IntegracionDispositivos';

function text(value, maxLength = 250) {
  return String(value ?? '').trim().slice(0, maxLength);
}

export async function updateIntegrationDeviceOperationalName({
  deviceId,
  name,
  actor = 'SYSTEM',
} = {}) {
  await ensureIntegrationGatewaySchema();
  const id = text(deviceId, 160);
  if (!id) throw badRequest('El dispositivo es obligatorio.');

  const current = (await readTable(DEVICES_SHEET))
    .find((item) => String(item.DispositivoIntegracionID || '') === id);
  if (!current) throw notFound('No se encontró el dispositivo de integración solicitado.');

  const operationalName = text(name, 250);
  const updated = await updateRow(DEVICES_SHEET, id, {
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
