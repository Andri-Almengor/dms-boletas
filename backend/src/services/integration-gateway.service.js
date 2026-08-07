import { AppError, badRequest, notFound, unauthorized } from '../core/errors.js';
import { nowIso, uuid } from '../core/utils.js';
import { sheetsApi } from '../infra/google.js';
import {
  appendRow,
  appendRows,
  ensureColumns,
  readTable,
  readTables,
  updateRow,
  updateRows,
} from '../infra/sheets.repository.js';
import {
  createGatewayToken,
  createGatewayTokenRecord,
  integrationCommandDedupeKey,
  isGatewayOnline,
  normalizeIntegrationCommandType,
  normalizeInventoryItem,
  sanitizeIntegrationMetadata,
  verifyGatewayToken,
} from './integration-gateway.domain.js';

const GATEWAYS_SHEET = 'IntegracionGateways';
const DEVICES_SHEET = 'IntegracionDispositivos';
const COMMANDS_SHEET = 'IntegracionComandos';
const ONLINE_TIMEOUT_MS = 90_000;
const COMMAND_REDELIVERY_MS = 60_000;
const MAX_INVENTORY_ITEMS = 2_500;
const MAX_COMMANDS_PER_POLL = 5;

const SCHEMA = Object.freeze({
  [GATEWAYS_SHEET]: [
    'GatewayID', 'ClienteID', 'Cliente', 'Nombre', 'Estado', 'TokenHash', 'TokenSalt',
    'UltimoContacto', 'UltimaSincronizacionInventario', 'CantidadDispositivos',
    'VersionAgente', 'Hostname', 'Plataforma', 'Adaptador', 'CapabilitiesJSON',
    'FechaCreacion', 'FechaActualizacion', 'CreadoPor', 'ActualizadoPor', 'UltimoError',
  ],
  [DEVICES_SHEET]: [
    'DispositivoIntegracionID', 'GatewayID', 'ClienteID', 'SourceSystem', 'ExternalID',
    'Tipo', 'NombreDetectado', 'NombreOperativo', 'DireccionIP', 'DireccionMAC',
    'Fabricante', 'Modelo', 'EstadoConexion', 'UltimaConexion', 'UltimaVerificacion',
    'CapabilitiesJSON', 'MetadataJSON', 'Fingerprint', 'DetectadoEnUltimaSincronizacion',
    'Activo', 'FechaCreacion', 'FechaActualizacion',
  ],
  [COMMANDS_SHEET]: [
    'ComandoID', 'GatewayID', 'Tipo', 'PayloadJSON', 'Estado', 'IdempotencyKey',
    'Intentos', 'FechaCreacion', 'FechaEntrega', 'FechaFinalizacion', 'ExpiraEn',
    'ResultadoJSON', 'ErrorCodigo', 'ErrorMensaje', 'CreadoPor',
  ],
});

let schemaPromise = null;
let commandTail = Promise.resolve();
const inventoryTails = new Map();

function quote(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

function text(value, maxLength = 250) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function serialize(previous, operation, setTail) {
  const current = previous.then(operation, operation);
  setTail(current.catch(() => {}));
  return current;
}

function withCommandLock(operation) {
  return serialize(commandTail, operation, (next) => { commandTail = next; });
}

function withInventoryLock(gatewayId, operation) {
  const key = String(gatewayId || '');
  const previous = inventoryTails.get(key) || Promise.resolve();
  return serialize(previous, operation, (next) => {
    inventoryTails.set(key, next);
    next.finally(() => {
      if (inventoryTails.get(key) === next) inventoryTails.delete(key);
    });
  });
}

async function createMissingSheets() {
  const { data } = await sheetsApi.spreadsheets.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    fields: 'sheets(properties(sheetId,title))',
  });
  const existing = new Set((data.sheets || []).map((sheet) => sheet.properties?.title));
  const missing = Object.keys(SCHEMA).filter((name) => !existing.has(name));

  if (missing.length) {
    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      requestBody: {
        requests: missing.map((title) => ({
          addSheet: {
            properties: {
              title,
              gridProperties: {
                rowCount: 1_000,
                columnCount: Math.max(26, SCHEMA[title].length),
              },
            },
          },
        })),
      },
    });

    await sheetsApi.spreadsheets.values.batchUpdate({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      requestBody: {
        valueInputOption: 'RAW',
        data: missing.map((title) => ({
          range: `${quote(title)}!A1`,
          values: [SCHEMA[title]],
        })),
      },
    });
  }

  for (const [sheetName, headers] of Object.entries(SCHEMA)) {
    await ensureColumns(sheetName, headers);
  }
}

export async function ensureIntegrationGatewaySchema() {
  if (!schemaPromise) {
    schemaPromise = createMissingSheets().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
  return { ready: true };
}

function publicGateway(row = {}) {
  const {
    TokenHash: _tokenHash,
    TokenSalt: _tokenSalt,
    __rowNumber: _rowNumber,
    ...safe
  } = row;
  return {
    ...safe,
    online: isGatewayOnline(row.UltimoContacto, Date.now(), ONLINE_TIMEOUT_MS),
    capabilities: parseJson(row.CapabilitiesJSON, {}),
  };
}

function publicDevice(row = {}) {
  const { __rowNumber: _rowNumber, ...safe } = row;
  return {
    ...safe,
    capabilities: parseJson(row.CapabilitiesJSON, {}),
    metadata: parseJson(row.MetadataJSON, {}),
  };
}

function publicCommand(row = {}) {
  const { __rowNumber: _rowNumber, ...safe } = row;
  return {
    ...safe,
    payload: parseJson(row.PayloadJSON, {}),
    result: parseJson(row.ResultadoJSON, {}),
  };
}

export async function provisionIntegrationGateway({
  name,
  clientId = '',
  clientName = '',
  actor = 'SYSTEM',
} = {}) {
  await ensureIntegrationGatewaySchema();
  const normalizedName = text(name, 160);
  if (!normalizedName) throw badRequest('El nombre del gateway es obligatorio.');

  const existing = (await readTable(GATEWAYS_SHEET)).find((item) => (
    String(item.Estado || '').toUpperCase() === 'ACTIVO'
    && text(item.Nombre, 160).toLowerCase() === normalizedName.toLowerCase()
    && text(item.ClienteID, 160) === text(clientId, 160)
  ));
  if (existing) throw badRequest('Ya existe un gateway activo con ese nombre para el cliente seleccionado.');

  const token = createGatewayToken();
  const tokenRecord = createGatewayTokenRecord(token);
  const now = nowIso();
  const row = {
    GatewayID: `gateway-${uuid()}`,
    ClienteID: text(clientId, 160),
    Cliente: text(clientName, 250),
    Nombre: normalizedName,
    Estado: 'ACTIVO',
    TokenHash: tokenRecord.hash,
    TokenSalt: tokenRecord.salt,
    UltimoContacto: '',
    UltimaSincronizacionInventario: '',
    CantidadDispositivos: 0,
    VersionAgente: '',
    Hostname: '',
    Plataforma: '',
    Adaptador: 'SIMULATED',
    CapabilitiesJSON: '{}',
    FechaCreacion: now,
    FechaActualizacion: now,
    CreadoPor: actor,
    ActualizadoPor: actor,
    UltimoError: '',
  };
  await appendRow(GATEWAYS_SHEET, row);
  return { gateway: publicGateway(row), token };
}

export async function revokeIntegrationGateway(gatewayId, actor = 'SYSTEM') {
  await ensureIntegrationGatewaySchema();
  const id = text(gatewayId, 160);
  const before = (await readTable(GATEWAYS_SHEET)).find((item) => String(item.GatewayID) === id);
  if (!before) throw notFound('No se encontró el gateway solicitado.');
  if (String(before.Estado || '').toUpperCase() === 'REVOCADO') return publicGateway(before);

  const after = await updateRow(GATEWAYS_SHEET, id, {
    Estado: 'REVOCADO',
    FechaActualizacion: nowIso(),
    ActualizadoPor: actor,
  });

  const commands = (await readTable(COMMANDS_SHEET)).filter((item) => (
    String(item.GatewayID) === id
    && ['PENDIENTE', 'ENTREGADO'].includes(String(item.Estado || '').toUpperCase())
  ));
  if (commands.length) {
    await updateRows(COMMANDS_SHEET, commands.map((item) => ({
      idValue: item.ComandoID,
      patch: {
        Estado: 'CANCELADO',
        FechaFinalizacion: nowIso(),
        ErrorCodigo: 'GATEWAY_REVOKED',
        ErrorMensaje: 'El gateway fue revocado por un administrador.',
      },
    })));
  }
  return publicGateway(after);
}

export async function integrationGatewayOverview() {
  await ensureIntegrationGatewaySchema();
  const tables = await readTables([GATEWAYS_SHEET, DEVICES_SHEET, COMMANDS_SHEET]);
  const gateways = tables[GATEWAYS_SHEET]
    .map(publicGateway)
    .sort((a, b) => String(a.Nombre || '').localeCompare(String(b.Nombre || ''), 'es'));
  const devices = tables[DEVICES_SHEET]
    .filter((item) => item.Activo !== false && String(item.Activo).toLowerCase() !== 'false')
    .map(publicDevice)
    .sort((a, b) => String(a.NombreDetectado || '').localeCompare(String(b.NombreDetectado || ''), 'es'));
  const commands = tables[COMMANDS_SHEET]
    .map(publicCommand)
    .sort((a, b) => String(b.FechaCreacion || '').localeCompare(String(a.FechaCreacion || '')))
    .slice(0, 100);

  return {
    gateways,
    devices,
    commands,
    summary: {
      gateways: gateways.length,
      online: gateways.filter((item) => item.online).length,
      devices: devices.length,
      pendingCommands: commands.filter((item) => ['PENDIENTE', 'ENTREGADO'].includes(String(item.Estado || '').toUpperCase())).length,
    },
  };
}

export async function authenticateIntegrationGateway({ gatewayId, token }) {
  await ensureIntegrationGatewaySchema();
  const id = text(gatewayId, 160);
  if (!id || !token) throw unauthorized('Las credenciales del gateway no son válidas.');
  const gateway = (await readTable(GATEWAYS_SHEET)).find((item) => String(item.GatewayID) === id);
  if (!gateway || String(gateway.Estado || '').toUpperCase() !== 'ACTIVO') {
    throw unauthorized('El gateway no existe, está inactivo o fue revocado.');
  }
  if (!verifyGatewayToken(token, gateway.TokenSalt, gateway.TokenHash)) {
    throw unauthorized('Las credenciales del gateway no son válidas.');
  }
  return gateway;
}

export async function recordIntegrationGatewayHeartbeat(gateway, payload = {}) {
  const now = nowIso();
  const capabilities = sanitizeIntegrationMetadata(payload.capabilities || {});
  const after = await updateRow(GATEWAYS_SHEET, gateway.GatewayID, {
    UltimoContacto: now,
    VersionAgente: text(payload.version, 80),
    Hostname: text(payload.hostname, 160),
    Plataforma: text(payload.platform, 160),
    Adaptador: text(payload.adapter || 'SIMULATED', 100).toUpperCase(),
    CapabilitiesJSON: JSON.stringify(capabilities),
    FechaActualizacion: now,
    ActualizadoPor: gateway.GatewayID,
    UltimoError: text(payload.lastError, 500),
  });
  return publicGateway(after);
}

export async function syncIntegrationInventory(gateway, rawItems = []) {
  return withInventoryLock(gateway.GatewayID, async () => {
    await ensureIntegrationGatewaySchema();
    if (!Array.isArray(rawItems)) throw badRequest('El inventario debe enviarse como una lista.');
    if (rawItems.length > MAX_INVENTORY_ITEMS) {
      throw new AppError(
        'INTEGRATION_INVENTORY_TOO_LARGE',
        `El inventario supera el máximo de ${MAX_INVENTORY_ITEMS} dispositivos por sincronización.`,
        413,
      );
    }

    const normalizedMap = new Map();
    rawItems.forEach((item) => {
      const normalized = normalizeInventoryItem(item, gateway);
      if (normalized) normalizedMap.set(normalized.DispositivoIntegracionID, normalized);
    });
    const normalized = [...normalizedMap.values()];
    const currentRows = (await readTable(DEVICES_SHEET))
      .filter((item) => String(item.GatewayID) === String(gateway.GatewayID));
    const currentById = new Map(currentRows.map((item) => [String(item.DispositivoIntegracionID), item]));
    const now = nowIso();
    const additions = [];
    const updates = [];

    normalized.forEach((item) => {
      const current = currentById.get(item.DispositivoIntegracionID);
      if (!current) {
        additions.push({
          ...item,
          NombreOperativo: '',
          DetectadoEnUltimaSincronizacion: true,
          FechaCreacion: now,
          FechaActualizacion: now,
        });
        return;
      }
      const becameVisible = String(current.DetectadoEnUltimaSincronizacion).toLowerCase() === 'false';
      if (String(current.Fingerprint || '') !== String(item.Fingerprint) || becameVisible) {
        updates.push({
          idValue: item.DispositivoIntegracionID,
          patch: {
            ...item,
            NombreOperativo: current.NombreOperativo || '',
            DetectadoEnUltimaSincronizacion: true,
            FechaActualizacion: now,
          },
        });
      }
    });

    currentRows.forEach((current) => {
      if (normalizedMap.has(String(current.DispositivoIntegracionID))) return;
      if (String(current.DetectadoEnUltimaSincronizacion).toLowerCase() === 'false') return;
      updates.push({
        idValue: current.DispositivoIntegracionID,
        patch: {
          DetectadoEnUltimaSincronizacion: false,
          FechaActualizacion: now,
        },
      });
    });

    if (additions.length) await appendRows(DEVICES_SHEET, additions, { chunkSize: 250 });
    if (updates.length) await updateRows(DEVICES_SHEET, updates);
    await updateRow(GATEWAYS_SHEET, gateway.GatewayID, {
      UltimoContacto: now,
      UltimaSincronizacionInventario: now,
      CantidadDispositivos: normalized.length,
      FechaActualizacion: now,
      ActualizadoPor: gateway.GatewayID,
      UltimoError: '',
    });

    return {
      received: rawItems.length,
      accepted: normalized.length,
      added: additions.length,
      updated: updates.length,
      missing: currentRows.filter((item) => !normalizedMap.has(String(item.DispositivoIntegracionID))).length,
    };
  });
}

export async function createIntegrationCommand({
  gatewayId,
  type,
  payload = {},
  actor = 'SYSTEM',
} = {}) {
  return withCommandLock(async () => {
    await ensureIntegrationGatewaySchema();
    const gateway = (await readTable(GATEWAYS_SHEET)).find((item) => String(item.GatewayID) === String(gatewayId));
    if (!gateway || String(gateway.Estado || '').toUpperCase() !== 'ACTIVO') {
      throw notFound('No se encontró un gateway activo para recibir el comando.');
    }
    const normalizedType = normalizeIntegrationCommandType(type);
    if (!normalizedType) throw badRequest('El tipo de comando no está permitido.');
    const safePayload = sanitizeIntegrationMetadata(payload);
    const idempotencyKey = integrationCommandDedupeKey({ gatewayId, type: normalizedType, payload: safePayload });
    const commands = await readTable(COMMANDS_SHEET);
    const existing = commands.find((item) => (
      String(item.GatewayID) === String(gatewayId)
      && String(item.IdempotencyKey) === idempotencyKey
      && ['PENDIENTE', 'ENTREGADO'].includes(String(item.Estado || '').toUpperCase())
      && new Date(item.ExpiraEn || 0).getTime() > Date.now()
    ));
    if (existing) return publicCommand(existing);

    const now = nowIso();
    const row = {
      ComandoID: `cmd-${uuid()}`,
      GatewayID: gatewayId,
      Tipo: normalizedType,
      PayloadJSON: JSON.stringify(safePayload),
      Estado: 'PENDIENTE',
      IdempotencyKey: idempotencyKey,
      Intentos: 0,
      FechaCreacion: now,
      FechaEntrega: '',
      FechaFinalizacion: '',
      ExpiraEn: new Date(Date.now() + 10 * 60_000).toISOString(),
      ResultadoJSON: '',
      ErrorCodigo: '',
      ErrorMensaje: '',
      CreadoPor: actor,
    };
    await appendRow(COMMANDS_SHEET, row);
    return publicCommand(row);
  });
}

export async function pollIntegrationCommands(gateway) {
  return withCommandLock(async () => {
    await ensureIntegrationGatewaySchema();
    const commands = (await readTable(COMMANDS_SHEET))
      .filter((item) => String(item.GatewayID) === String(gateway.GatewayID));
    const now = Date.now();
    const expired = commands.filter((item) => (
      ['PENDIENTE', 'ENTREGADO'].includes(String(item.Estado || '').toUpperCase())
      && new Date(item.ExpiraEn || 0).getTime() <= now
    ));
    if (expired.length) {
      await updateRows(COMMANDS_SHEET, expired.map((item) => ({
        idValue: item.ComandoID,
        patch: {
          Estado: 'EXPIRADO',
          FechaFinalizacion: nowIso(),
          ErrorCodigo: 'COMMAND_EXPIRED',
          ErrorMensaje: 'El agente no confirmó el comando antes de su vencimiento.',
        },
      })));
    }

    const ready = commands
      .filter((item) => {
        const status = String(item.Estado || '').toUpperCase();
        if (status === 'PENDIENTE') return new Date(item.ExpiraEn || 0).getTime() > now;
        if (status !== 'ENTREGADO') return false;
        const deliveredAt = new Date(item.FechaEntrega || 0).getTime();
        return new Date(item.ExpiraEn || 0).getTime() > now
          && (!Number.isFinite(deliveredAt) || now - deliveredAt >= COMMAND_REDELIVERY_MS);
      })
      .sort((a, b) => String(a.FechaCreacion || '').localeCompare(String(b.FechaCreacion || '')))
      .slice(0, MAX_COMMANDS_PER_POLL);

    if (!ready.length) return [];
    const deliveryTime = nowIso();
    const delivered = await updateRows(COMMANDS_SHEET, ready.map((item) => ({
      idValue: item.ComandoID,
      patch: {
        Estado: 'ENTREGADO',
        FechaEntrega: deliveryTime,
        Intentos: Number(item.Intentos || 0) + 1,
      },
    })));
    return delivered.map(publicCommand);
  });
}

export async function completeIntegrationCommand(gateway, payload = {}) {
  return withCommandLock(async () => {
    await ensureIntegrationGatewaySchema();
    const commandId = text(payload.commandId ?? payload.ComandoID, 160);
    if (!commandId) throw badRequest('Debe indicar el identificador del comando.');
    const command = (await readTable(COMMANDS_SHEET)).find((item) => String(item.ComandoID) === commandId);
    if (!command || String(command.GatewayID) !== String(gateway.GatewayID)) {
      throw notFound('No se encontró el comando para este gateway.');
    }
    if (['COMPLETADO', 'ERROR'].includes(String(command.Estado || '').toUpperCase())) {
      return publicCommand(command);
    }

    const success = payload.success !== false;
    const after = await updateRow(COMMANDS_SHEET, commandId, {
      Estado: success ? 'COMPLETADO' : 'ERROR',
      FechaFinalizacion: nowIso(),
      ResultadoJSON: JSON.stringify(sanitizeIntegrationMetadata(payload.result || {})),
      ErrorCodigo: success ? '' : text(payload.errorCode || 'AGENT_COMMAND_ERROR', 120),
      ErrorMensaje: success ? '' : text(payload.errorMessage || 'El agente no pudo completar el comando.', 500),
    });
    return publicCommand(after);
  });
}
