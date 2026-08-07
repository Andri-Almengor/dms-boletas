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

function credentialUrlHost(row = {}) {
  const raw = text(row.URL, 2_000);
  if (!raw) return '';
  try {
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
    return new URL(candidate).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    return '';
  }
}

function resolveCredential({ device, gateway, credentials = [] }) {
  const clientId = text(gateway.ClienteID, 180);
  const explicitId = text(device.CredencialCamaraID, 180);
  const available = credentials.filter((row) => active(row) && text(row.ClienteID, 180) === clientId);

  if (explicitId) {
    const selected = available.find((row) => text(row.CredencialID, 180) === explicitId);
    if (!selected) {
      throw new AppError(
        'CAMERA_CREDENTIAL_UNAVAILABLE',
        'La credencial asignada ya no existe, está inactiva o pertenece a otro cliente.',
        409,
      );
    }
    return { credential: selected, selection: 'EXPLICIT' };
  }

  const ip = text(device.DireccionIP, 100).toLowerCase();
  const exactIpMatches = available.filter((row) => credentialUrlHost(row) === ip);
  if (exactIpMatches.length === 1) {
    // Coincidencia determinista por URL/IP. Se elige una sola credencial antes
    // de contactar la cámara; nunca se prueban las demás si esta falla.
    return { credential: exactIpMatches[0], selection: 'UNIQUE_IP_MATCH' };
  }
  if (exactIpMatches.length > 1) {
    throw new AppError(
      'CAMERA_CREDENTIAL_AMBIGUOUS',
      'Hay varias credenciales del cliente asociadas a esta IP. Asigne una credencial específica a la cámara antes de conectarse.',
      409,
    );
  }
  throw new AppError(
    'CAMERA_CREDENTIAL_NOT_ASSIGNED',
    'La cámara no tiene una credencial asignada ni existe una única credencial del cliente cuya URL coincida con su IP.',
    409,
  );
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

  const metadata = json(device.MetadataJSON, {});
  const capabilities = json(device.CapabilitiesJSON, {});
  const ipAddress = text(device.DireccionIP, 100);
  if (!ipAddress) throw badRequest('La cámara no tiene una dirección IP utilizable.');
  const resolvedCredential = resolveCredential({
    device,
    gateway,
    credentials: tables.CredencialesClientes || [],
  });
  const credential = resolvedCredential.credential;

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
      selection: resolvedCredential.selection,
    },
  };
}
