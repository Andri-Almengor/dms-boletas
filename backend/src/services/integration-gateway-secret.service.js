import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { AppError, badRequest, notFound } from '../core/errors.js';
import { nowIso } from '../core/utils.js';
import { sheetsApi } from '../infra/google.js';
import {
  appendRow,
  ensureColumns,
  invalidateTableCache,
  readTable,
  updateRow,
} from '../infra/sheets.repository.js';

const SHEET = 'IntegracionGatewaySecrets';
const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const HEADERS = Object.freeze([
  'GatewayID',
  'TokenCiphertext',
  'TokenIV',
  'TokenTag',
  'TokenVersion',
  'FechaCreacion',
  'FechaActualizacion',
  'ActualizadoPor',
]);

let schemaPromise = null;
const knownSecretIds = new Set();

function text(value, maxLength = 500) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function quote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function encryptionKey() {
  const raw = String(
    process.env.INTEGRATION_GATEWAY_ENCRYPTION_KEY
    || process.env.PASSWORD_VAULT_ENCRYPTION_KEY
    || '',
  ).trim();
  if (!raw) {
    throw new AppError(
      'INTEGRATION_GATEWAY_ENCRYPTION_NOT_CONFIGURED',
      'Configure INTEGRATION_GATEWAY_ENCRYPTION_KEY o PASSWORD_VAULT_ENCRYPTION_KEY para revelar tokens de gateways.',
      503,
    );
  }
  let key;
  if (/^[a-f0-9]{64}$/i.test(raw)) key = Buffer.from(raw, 'hex');
  else key = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (key.length !== 32) {
    throw new AppError(
      'INTEGRATION_GATEWAY_ENCRYPTION_INVALID_KEY',
      'La llave de cifrado de gateways debe representar exactamente 32 bytes.',
      503,
    );
  }
  return key;
}

function aad(gatewayId) {
  const id = text(gatewayId, 160);
  if (!id) throw badRequest('El gateway es obligatorio.');
  return Buffer.from(`${VERSION}|integration-gateway-token|${id}`, 'utf8');
}

function encryptToken(gatewayId, token) {
  const value = text(token, 2_000);
  if (!value) throw badRequest('El token del gateway está vacío.');
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey(), iv);
  cipher.setAAD(aad(gatewayId));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return {
    TokenCiphertext: encrypted.toString('base64'),
    TokenIV: iv.toString('base64'),
    TokenTag: cipher.getAuthTag().toString('base64'),
    TokenVersion: VERSION,
  };
}

function decryptToken(row = {}) {
  try {
    if (String(row.TokenVersion || '') !== VERSION) throw new Error('Versión no compatible.');
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      encryptionKey(),
      Buffer.from(String(row.TokenIV || ''), 'base64'),
    );
    decipher.setAAD(aad(row.GatewayID));
    decipher.setAuthTag(Buffer.from(String(row.TokenTag || ''), 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(String(row.TokenCiphertext || ''), 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      'INTEGRATION_GATEWAY_TOKEN_DECRYPTION_FAILED',
      'No fue posible descifrar el token del gateway. Revise que la llave del servidor no haya cambiado.',
      500,
    );
  }
}

async function ensureSchemaInternal() {
  const { data } = await sheetsApi.spreadsheets.get({
    spreadsheetId: env.sheetId,
    fields: 'sheets(properties(title))',
  });
  const exists = (data.sheets || []).some((sheet) => sheet.properties?.title === SHEET);
  if (!exists) {
    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: env.sheetId,
      requestBody: {
        requests: [{
          addSheet: {
            properties: {
              title: SHEET,
              gridProperties: { rowCount: 1_000, columnCount: Math.max(26, HEADERS.length), frozenRowCount: 1 },
            },
          },
        }],
      },
    });
    await sheetsApi.spreadsheets.values.update({
      spreadsheetId: env.sheetId,
      range: `${quote(SHEET)}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [HEADERS] },
    });
    invalidateTableCache(SHEET);
  } else {
    await ensureColumns(SHEET, HEADERS);
  }
  return { ready: true };
}

export async function ensureIntegrationGatewaySecretSchema() {
  if (!schemaPromise) {
    schemaPromise = ensureSchemaInternal().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

export async function storeIntegrationGatewayToken({ gatewayId, token, actor = 'SYSTEM' } = {}) {
  await ensureIntegrationGatewaySecretSchema();
  const id = text(gatewayId, 160);
  const encrypted = encryptToken(id, token);
  const current = (await readTable(SHEET)).find((row) => String(row.GatewayID || '') === id);
  const timestamp = nowIso();
  if (current) {
    await updateRow(SHEET, id, {
      ...encrypted,
      FechaActualizacion: timestamp,
      ActualizadoPor: actor,
    });
  } else {
    await appendRow(SHEET, {
      GatewayID: id,
      ...encrypted,
      FechaCreacion: timestamp,
      FechaActualizacion: timestamp,
      ActualizadoPor: actor,
    });
  }
  knownSecretIds.add(id);
  return { stored: true, gatewayId: id };
}

export async function backfillIntegrationGatewayToken(gateway, token) {
  const gatewayId = text(gateway?.GatewayID, 160);
  if (!gatewayId || !token) return { stored: false };
  if (!integrationGatewayTokenEncryptionConfigured()) {
    return { stored: false, encryptionConfigured: false };
  }
  if (knownSecretIds.has(gatewayId)) return { stored: false, alreadyStored: true };
  await ensureIntegrationGatewaySecretSchema();
  const exists = (await readTable(SHEET)).some((row) => (
    String(row.GatewayID || '') === gatewayId && Boolean(String(row.TokenCiphertext || '').trim())
  ));
  if (exists) {
    knownSecretIds.add(gatewayId);
    return { stored: false, alreadyStored: true };
  }
  return storeIntegrationGatewayToken({ gatewayId, token, actor: gatewayId });
}

export async function revealIntegrationGatewayToken(gatewayId) {
  await ensureIntegrationGatewaySecretSchema();
  const id = text(gatewayId, 160);
  if (!id) throw badRequest('El gateway es obligatorio.');
  const row = (await readTable(SHEET)).find((item) => String(item.GatewayID || '') === id);
  if (!row?.TokenCiphertext) {
    throw notFound('El token todavía no está disponible para revelado. Mantenga el agente conectado unos segundos para registrarlo de forma cifrada.');
  }
  knownSecretIds.add(id);
  return {
    gatewayId: id,
    token: decryptToken(row),
    revealedAt: nowIso(),
    expiresInSeconds: 30,
  };
}

export function integrationGatewayTokenEncryptionConfigured() {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}
