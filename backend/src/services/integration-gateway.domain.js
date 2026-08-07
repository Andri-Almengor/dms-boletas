import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

export const INTEGRATION_COMMAND_TYPES = Object.freeze([
  'PING',
  'INVENTORY_SYNC',
]);

const COMMAND_TYPES = new Set(INTEGRATION_COMMAND_TYPES);
const SENSITIVE_KEY = /(password|contrasena|contraseña|token|secret|credential|credencial|private.?key|authorization|cookie)/i;

function text(value, maxLength = 250) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stable(value[key]);
      return result;
    }, {});
  }
  return value;
}

function sanitizeValue(value, depth = 0) {
  if (depth > 4 || value === undefined || value === null) return null;
  if (typeof value === 'string') return value.slice(0, 1_000);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value !== 'object') return String(value).slice(0, 1_000);

  return Object.entries(value).slice(0, 100).reduce((result, [key, child]) => {
    if (SENSITIVE_KEY.test(key)) return result;
    result[text(key, 100)] = sanitizeValue(child, depth + 1);
    return result;
  }, {});
}

export function sanitizeIntegrationMetadata(value = {}) {
  const sanitized = sanitizeValue(value, 0);
  return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
    ? sanitized
    : {};
}

export function createGatewayToken() {
  return randomBytes(32).toString('base64url');
}

export function createGatewayTokenRecord(token) {
  const salt = randomBytes(16).toString('base64url');
  const hash = scryptSync(String(token), salt, 32).toString('base64url');
  return { salt, hash };
}

export function verifyGatewayToken(token, salt, expectedHash) {
  if (!token || !salt || !expectedHash) return false;
  try {
    const actual = scryptSync(String(token), String(salt), 32);
    const expected = Buffer.from(String(expectedHash), 'base64url');
    return expected.length === actual.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function normalizeIntegrationCommandType(value) {
  const type = text(value, 80).toUpperCase();
  return COMMAND_TYPES.has(type) ? type : '';
}

export function integrationDeviceId({ gatewayId, sourceSystem, externalId }) {
  const identity = [gatewayId, sourceSystem, externalId]
    .map((value) => text(value, 250).toLowerCase())
    .join('|');
  const digest = createHash('sha256').update(identity).digest('hex').slice(0, 32);
  return `idev-${digest}`;
}

export function integrationCommandDedupeKey({ gatewayId, type, payload = {} }) {
  const normalizedType = normalizeIntegrationCommandType(type);
  const digest = createHash('sha256')
    .update(`${text(gatewayId, 160)}|${normalizedType}|${JSON.stringify(stable(sanitizeIntegrationMetadata(payload)))}`)
    .digest('hex');
  return `integration-command:${digest}`;
}

export function normalizeInventoryItem(item = {}, gateway = {}) {
  const externalId = text(item.externalId ?? item.ExternalID ?? item.id, 250);
  const name = text(item.name ?? item.Nombre ?? item.nombre, 250);
  const type = text(item.type ?? item.Tipo ?? item.deviceType, 100).toUpperCase();
  const sourceSystem = text(item.sourceSystem ?? item.SourceSystem ?? 'SIMULATED', 100).toUpperCase();
  if (!externalId || !name || !type) return null;

  const gatewayId = text(gateway.GatewayID ?? gateway.gatewayId, 160);
  const now = new Date().toISOString();
  const metadata = sanitizeIntegrationMetadata(item.metadata ?? item.Metadata ?? {});
  const capabilities = sanitizeIntegrationMetadata(item.capabilities ?? item.Capabilities ?? {});
  const fingerprintSource = {
    GatewayID: gatewayId,
    ClienteID: text(gateway.ClienteID ?? gateway.clientId, 160),
    SourceSystem: sourceSystem,
    ExternalID: externalId,
    Tipo: type,
    NombreDetectado: name,
    DireccionIP: text(item.ipAddress ?? item.DireccionIP, 100),
    DireccionMAC: text(item.macAddress ?? item.DireccionMAC, 100).toUpperCase(),
    Fabricante: text(item.manufacturer ?? item.Fabricante, 160),
    Modelo: text(item.model ?? item.Modelo, 160),
    EstadoConexion: text(item.status ?? item.EstadoConexion ?? 'UNKNOWN', 80).toUpperCase(),
    CapabilitiesJSON: JSON.stringify(capabilities),
    MetadataJSON: JSON.stringify(metadata),
  };

  return {
    DispositivoIntegracionID: integrationDeviceId({ gatewayId, sourceSystem, externalId }),
    ...fingerprintSource,
    UltimaConexion: text(item.lastSeenAt ?? item.UltimaConexion ?? now, 80),
    UltimaVerificacion: now,
    Activo: true,
    Fingerprint: createHash('sha256')
      .update(JSON.stringify(stable(fingerprintSource)))
      .digest('hex'),
  };
}

export function isGatewayOnline(lastSeenAt, now = Date.now(), timeoutMs = 90_000) {
  const timestamp = new Date(lastSeenAt || 0).getTime();
  return Number.isFinite(timestamp) && timestamp > 0 && now - timestamp <= timeoutMs;
}
