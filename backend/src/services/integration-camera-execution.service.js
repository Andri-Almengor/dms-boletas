import { AppError, badRequest, notFound } from '../core/errors.js';
import { readTables } from '../infra/sheets.repository.js';
import { decryptVaultSecret } from './password-vault-crypto.service.js';
import { CAMERA_INTEGRATION_COMMAND_TYPES } from './integration-gateway.domain.js';

const CAMERA_COMMANDS = new Set(CAMERA_INTEGRATION_COMMAND_TYPES);

function text(value, maxLength = 500) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function active(row = {}) {
  return row.Activo !== false
    && String(row.Activo ?? 'true').toLowerCase() !== 'false'
    && String(row.Estado || 'ACTIVO').toUpperCase() !== 'INACTIVO';
}

function json(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function isCameraIntegrationCommand(type) {
  return CAMERA_COMMANDS.has(String(type || '').toUpperCase());
}

export async function buildCameraExecutionEnvelope(gateway, command = {}) {
  if (!isCameraIntegrationCommand(command.Tipo || command.type)) return null;

  const payload = command.payload && typeof command.payload === 'object'
    ? command.payload
    : json(command.PayloadJSON, {});
  const deviceId = text(payload.deviceId || payload.DispositivoIntegracionID, 180);
  if (!deviceId) throw badRequest('El comando de cámara no indica un dispositivo.');

  const tables = await readTables(['IntegracionDispositivos', 'CredencialesClientes']);
  const device = (tables.IntegracionDispositivos || []).find((row) => (
    active(row)
    && text(row.DispositivoIntegracionID, 180) === deviceId
    && text(row.GatewayID, 180) === text(gateway.GatewayID, 180)
  ));
  if (!device) throw notFound('La cámara ya no pertenece a este gateway.');
  if (String(device.Tipo || '').toUpperCase() !== 'CAMERA') {
    throw badRequest('El dispositivo seleccionado no es una cámara.');
  }

  const credentialId = text(device.CredencialCamaraID, 180);
  if (!credentialId) {
    throw new AppError(
      'CAMERA_CREDENTIAL_NOT_ASSIGNED',
      'La cámara no tiene una credencial asignada. Seleccione una credencial en Gateways e inventario.',
      409,
    );
  }

  const gatewayClientId = text(gateway.ClienteID, 180);
  const credential = (tables.CredencialesClientes || []).find((row) => (
    active(row)
    && text(row.CredencialID, 180) === credentialId
    && text(row.ClienteID, 180) === gatewayClientId
  ));
  if (!credential) {
    throw new AppError(
      'CAMERA_CREDENTIAL_UNAVAILABLE',
      'La credencial asignada ya no existe, está inactiva o pertenece a otro cliente.',
      409,
    );
  }

  const metadata = json(device.MetadataJSON, {});
  const capabilities = json(device.CapabilitiesJSON, {});
  const ipAddress = text(device.DireccionIP, 100);
  if (!ipAddress) throw badRequest('La cámara no tiene una dirección IP utilizable.');

  // La contraseña se descifra únicamente al entregar el comando al gateway.
  // Este objeto nunca se escribe en IntegracionComandos, AuditLog ni Sheets.
  return {
    device: {
      deviceId,
      ipAddress,
      name: text(device.NombreOperativo || device.NombreDetectado, 250),
      detectedName: text(device.NombreDetectado, 250),
      manufacturer: text(device.Fabricante, 160),
      model: text(device.Modelo, 160),
      onvifEndpoint: text(metadata.onvifEndpoint, 700),
      openPorts: Array.isArray(metadata.openPorts) ? metadata.openPorts.slice(0, 16) : [],
      onvifConfirmed: Boolean(metadata.onvifConfirmed || capabilities.onvifIdentified || capabilities.onvifDiscovered),
    },
    authentication: {
      username: text(credential.Usuario, 250),
      password: decryptVaultSecret(credential),
    },
  };
}
