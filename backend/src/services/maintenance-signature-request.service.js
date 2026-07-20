import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { AppError, badRequest, notFound } from '../core/errors.js';
import { nowIso, pick, uuid } from '../core/utils.js';
import { uploadBase64 } from '../infra/drive.repository.js';
import { sheetsApi } from '../infra/google.js';
import {
  appendRow,
  findById,
  getHeaders,
  invalidateTableCache,
  readTable,
  updateRow,
} from '../infra/sheets.repository.js';
import { getConfig } from '../modules/config.module.js';
import { ensureSheetColumns } from './sheet-columns.service.js';

const SHEET_NAME = 'FirmaMantenimientoSolicitudes';
const MAINTENANCE_SIGNATURE_COLUMNS = [
  'FirmaArchivoID',
  'FirmaURL',
  'FirmaMimeType',
  'FirmaOrigen',
  'FirmaFecha',
];
const HEADERS = [
  'SolicitudFirmaMantenimientoID',
  'Token',
  'MantenimientoID',
  'ClienteID',
  'ClienteNombre',
  'TituloMantenimiento',
  'FirmaURLPublica',
  'Estado',
  'ModoPrueba',
  'FirmaArchivoID',
  'FirmaURL',
  'FechaCreacion',
  'FechaExpiracion',
  'FechaFirma',
  'CreadoPor',
  'ActualizadoPor',
  'FechaActualizacion',
];

const submissionLocks = new Map();
let ensurePromise = null;
let ensured = false;

function clean(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function asBoolean(value) {
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'si', 'sí', 'yes'].includes(clean(value).toLowerCase());
}

function quote(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

function columnLetter(index) {
  let result = '';
  let number = index + 1;
  while (number > 0) {
    const remainder = (number - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    number = Math.floor((number - 1) / 26);
  }
  return result;
}

async function ensureHeaders() {
  const range = `${quote(SHEET_NAME)}!1:1`;
  const { data } = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: env.sheetId,
    range,
  });
  const current = (data.values?.[0] || []).map((value) => clean(value)).filter(Boolean);
  const missing = HEADERS.filter((header) => !current.includes(header));
  const headers = current.length ? [...current, ...missing] : [...HEADERS];

  if (!current.length || missing.length) {
    await sheetsApi.spreadsheets.values.update({
      spreadsheetId: env.sheetId,
      range: `${quote(SHEET_NAME)}!A1:${columnLetter(headers.length - 1)}1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headers] },
    });
  }

  invalidateTableCache(SHEET_NAME);
  await getHeaders(SHEET_NAME, true);
}

export async function ensureMaintenanceSignatureStorage() {
  if (ensured) return;
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    const { data } = await sheetsApi.spreadsheets.get({
      spreadsheetId: env.sheetId,
      fields: 'sheets.properties.title',
    });
    const exists = (data.sheets || []).some((sheet) => sheet.properties?.title === SHEET_NAME);
    if (!exists) {
      await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId: env.sheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: SHEET_NAME } } }] },
      });
    }
    await ensureHeaders();
    await ensureSheetColumns('Mantenimiento', MAINTENANCE_SIGNATURE_COLUMNS);
    ensured = true;
  })().catch((error) => {
    ensured = false;
    throw error;
  }).finally(() => {
    ensurePromise = null;
  });

  return ensurePromise;
}

function publicBaseUrl(origin = '') {
  const candidates = [
    origin,
    process.env.PUBLIC_APP_URL,
    process.env.APP_PUBLIC_URL,
    process.env.RENDER_EXTERNAL_URL,
    process.env.FRONTEND_ORIGIN,
  ];
  const selected = candidates
    .map((value) => clean(value))
    .find((value) => /^https?:\/\//i.test(value) && value !== '*');
  if (!selected) {
    throw new AppError(
      'SIGNATURE_PUBLIC_URL_MISSING',
      'No fue posible determinar la URL pública para firmar el mantenimiento.',
      503,
    );
  }
  return selected.replace(/\/+$/, '');
}

export function maintenanceHasSignature(maintenance = {}) {
  return Boolean(clean(pick(maintenance, [
    'FirmaArchivoID',
    'FirmaFileID',
    'FirmaURL',
    'FirmaUrl',
    'Firma',
  ])));
}

export function maintenanceSignaturePatch(maintenance = {}) {
  if (!maintenanceHasSignature(maintenance)) return {};
  return {
    FirmaArchivoID: clean(pick(maintenance, ['FirmaArchivoID', 'FirmaFileID'])),
    FirmaURL: clean(pick(maintenance, ['FirmaURL', 'FirmaUrl'])),
    FirmaMimeType: clean(maintenance.FirmaMimeType, 'image/png'),
    FirmaOrigen: 'MANTENIMIENTO_GENERAL',
    FirmaFecha: maintenance.FirmaFecha || maintenance.FechaActualizacion || nowIso(),
  };
}

function requestView(row = {}) {
  const testMode = asBoolean(row.ModoPrueba);
  return {
    id: clean(row.SolicitudFirmaMantenimientoID),
    token: clean(row.Token),
    maintenanceId: clean(row.MantenimientoID),
    clientId: clean(row.ClienteID),
    clientName: clean(row.ClienteNombre, 'Cliente'),
    maintenanceTitle: clean(row.TituloMantenimiento, 'Mantenimiento técnico'),
    url: clean(row.FirmaURLPublica),
    status: clean(row.Estado, 'PENDIENTE').toUpperCase(),
    testMode,
    subjectType: 'maintenance',
    createdAt: row.FechaCreacion || '',
    expiresAt: row.FechaExpiracion || '',
    signedAt: row.FechaFirma || '',
  };
}

async function expireIfNeeded(row) {
  if (clean(row.Estado).toUpperCase() !== 'PENDIENTE') return row;
  const expiration = new Date(row.FechaExpiracion || 0).getTime();
  if (expiration && expiration < Date.now()) {
    return updateRow(SHEET_NAME, row.SolicitudFirmaMantenimientoID, {
      Estado: 'EXPIRADA',
      ActualizadoPor: 'SISTEMA',
      FechaActualizacion: nowIso(),
    });
  }
  return row;
}

export async function ensureMaintenanceSignatureRequest({
  maintenanceId,
  origin = '',
  actor = 'SISTEMA',
  testMode = false,
}) {
  await ensureMaintenanceSignatureStorage();
  const maintenance = await findById('Mantenimiento', maintenanceId);

  if (!testMode && maintenanceHasSignature(maintenance)) {
    return {
      id: '',
      token: '',
      maintenanceId: clean(maintenance.MantenimientoID),
      clientId: clean(maintenance.ClienteID),
      clientName: clean(maintenance.Cliente, 'Cliente'),
      maintenanceTitle: clean(maintenance.TituloMantenimiento, 'Mantenimiento técnico'),
      url: '',
      status: 'FIRMADA',
      testMode: false,
      subjectType: 'maintenance',
      signedAt: maintenance.FirmaFecha || maintenance.FechaActualizacion || '',
    };
  }

  const requests = await readTable(SHEET_NAME, { force: true });
  const candidates = requests
    .filter((row) => (
      clean(row.MantenimientoID) === clean(maintenance.MantenimientoID)
      && asBoolean(row.ModoPrueba) === Boolean(testMode)
    ))
    .sort((left, right) => String(right.FechaCreacion || '').localeCompare(String(left.FechaCreacion || '')));

  for (const candidate of candidates) {
    const current = await expireIfNeeded(candidate);
    if (clean(current.Estado).toUpperCase() === 'PENDIENTE') return requestView(current);
  }

  const createdAt = nowIso();
  const token = `mntsig_${crypto.randomBytes(32).toString('base64url')}`;
  const url = `${publicBaseUrl(origin)}/firmar/${encodeURIComponent(token)}`;
  const row = {
    SolicitudFirmaMantenimientoID: uuid(),
    Token: token,
    MantenimientoID: maintenance.MantenimientoID,
    ClienteID: maintenance.ClienteID || '',
    ClienteNombre: maintenance.Cliente || 'Cliente',
    TituloMantenimiento: maintenance.TituloMantenimiento || 'Mantenimiento técnico',
    FirmaURLPublica: url,
    Estado: 'PENDIENTE',
    ModoPrueba: Boolean(testMode),
    FirmaArchivoID: '',
    FirmaURL: '',
    FechaCreacion: createdAt,
    FechaExpiracion: new Date(Date.now() + (testMode ? 24 : 90) * 24 * 60 * 60 * 1000).toISOString(),
    FechaFirma: '',
    CreadoPor: actor,
    ActualizadoPor: actor,
    FechaActualizacion: createdAt,
  };
  await appendRow(SHEET_NAME, row);
  return requestView(row);
}

export async function findMaintenanceSignatureRequestByToken(token) {
  await ensureMaintenanceSignatureStorage();
  const normalized = clean(token);
  if (!normalized || !normalized.startsWith('mntsig_')) {
    throw notFound('El enlace de firma del mantenimiento no existe o ya no es válido.');
  }
  const row = (await readTable(SHEET_NAME, { force: true }))
    .find((item) => clean(item.Token) === normalized);
  if (!row) throw notFound('El enlace de firma del mantenimiento no existe o ya no es válido.');
  return expireIfNeeded(row);
}

function normalizeBase64(value) {
  return String(value || '')
    .replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '')
    .replace(/\s+/g, '');
}

function validateSignaturePayload(base64, mimeType) {
  const normalized = normalizeBase64(base64);
  if (!normalized) throw badRequest('Debe dibujar la firma antes de guardarla.');
  if (!/^image\/(png|jpeg|jpg)$/i.test(clean(mimeType, 'image/png'))) {
    throw badRequest('La firma debe enviarse como una imagen PNG o JPEG.');
  }
  const estimatedBytes = Math.floor(normalized.length * 0.75);
  if (estimatedBytes > 4 * 1024 * 1024) {
    throw badRequest('La firma supera el tamaño máximo permitido de 4 MB.');
  }
  return normalized;
}

export async function synchronizeMaintenanceSignatureToTickets(
  maintenanceId,
  signatureSource,
  actor = 'CLIENTE',
) {
  const patch = maintenanceSignaturePatch(signatureSource);
  if (!Object.keys(patch).length) return { updated: 0, ticketIds: [] };

  const tickets = (await readTable('Boletas', { force: true })).filter((ticket) => (
    clean(ticket.OrigenMantenimientoID) === clean(maintenanceId)
    && ticket.Activo !== false
    && String(ticket.Activo ?? 'true').toLowerCase() !== 'false'
  ));
  const ticketIds = [];

  for (const ticket of tickets) {
    await updateRow('Boletas', ticket.BoletaUID, {
      ...patch,
      Version: Number(ticket.Version || 0) + 1,
      ActualizadoPor: actor,
      FechaActualizacion: nowIso(),
    });
    ticketIds.push(clean(ticket.BoletaUID));
  }

  return { updated: ticketIds.length, ticketIds };
}

export async function applyPublicMaintenanceSignature({
  token,
  base64,
  mimeType = 'image/png',
}) {
  const normalizedToken = clean(token);
  if (submissionLocks.has(normalizedToken)) return submissionLocks.get(normalizedToken);

  const operation = (async () => {
    let request = await findMaintenanceSignatureRequestByToken(normalizedToken);
    const state = clean(request.Estado).toUpperCase();
    const testMode = asBoolean(request.ModoPrueba);

    if (state === 'FIRMADA' || state === 'PRUEBA_COMPLETADA') {
      return {
        alreadySigned: true,
        testMode,
        request: requestView(request),
        maintenance: await findById('Mantenimiento', request.MantenimientoID),
        synchronizedTickets: 0,
      };
    }
    if (state === 'EXPIRADA') {
      throw new AppError('SIGNATURE_LINK_EXPIRED', 'Este enlace de firma ha expirado.', 410);
    }
    if (state !== 'PENDIENTE') {
      throw new AppError('SIGNATURE_LINK_UNAVAILABLE', 'Este enlace de firma ya no está disponible.', 409);
    }

    const normalizedBase64 = validateSignaturePayload(base64, mimeType);
    const maintenance = await findById('Mantenimiento', request.MantenimientoID);

    if (testMode) {
      request = await updateRow(SHEET_NAME, request.SolicitudFirmaMantenimientoID, {
        Estado: 'PRUEBA_COMPLETADA',
        FechaFirma: nowIso(),
        ActualizadoPor: 'ADMIN_PRUEBA',
        FechaActualizacion: nowIso(),
      });
      return {
        alreadySigned: false,
        testMode: true,
        request: requestView(request),
        maintenance,
        synchronizedTickets: 0,
      };
    }

    if (maintenanceHasSignature(maintenance)) {
      const existingPatch = maintenanceSignaturePatch(maintenance);
      request = await updateRow(SHEET_NAME, request.SolicitudFirmaMantenimientoID, {
        Estado: 'FIRMADA',
        FechaFirma: existingPatch.FirmaFecha,
        FirmaArchivoID: existingPatch.FirmaArchivoID,
        FirmaURL: existingPatch.FirmaURL,
        ActualizadoPor: 'CLIENTE',
        FechaActualizacion: nowIso(),
      });
      const synchronization = await synchronizeMaintenanceSignatureToTickets(
        maintenance.MantenimientoID,
        maintenance,
        'CLIENTE',
      );
      return {
        alreadySigned: true,
        testMode: false,
        request: requestView(request),
        maintenance,
        synchronizedTickets: synchronization.updated,
      };
    }

    const config = await getConfig();
    const folderId = clean(config.FIRMAS_FOLDER_ID || process.env.FIRMAS_FOLDER_ID);
    if (!folderId) {
      throw new AppError(
        'SIGNATURE_FOLDER_NOT_CONFIGURED',
        'No está configurada la carpeta de firmas.',
        503,
      );
    }

    const file = await uploadBase64({
      base64: normalizedBase64,
      mimeType,
      fileName: `firma_cliente_mantenimiento_${clean(maintenance.MantenimientoID)}.png`,
      folderId,
    });
    const timestamp = nowIso();
    const updatedMaintenance = await updateRow('Mantenimiento', maintenance.MantenimientoID, {
      FirmaArchivoID: file.id,
      FirmaURL: file.webViewLink,
      FirmaMimeType: mimeType,
      FirmaOrigen: 'ENLACE_CLIENTE_MANTENIMIENTO',
      FirmaFecha: timestamp,
      ActualizadoPor: 'CLIENTE',
      FechaActualizacion: timestamp,
    });
    const synchronization = await synchronizeMaintenanceSignatureToTickets(
      maintenance.MantenimientoID,
      updatedMaintenance,
      'CLIENTE',
    );

    request = await updateRow(SHEET_NAME, request.SolicitudFirmaMantenimientoID, {
      Estado: 'FIRMADA',
      FirmaArchivoID: file.id,
      FirmaURL: file.webViewLink,
      FechaFirma: timestamp,
      ActualizadoPor: 'CLIENTE',
      FechaActualizacion: timestamp,
    });

    return {
      alreadySigned: false,
      testMode: false,
      request: requestView(request),
      maintenance: updatedMaintenance,
      file,
      synchronizedTickets: synchronization.updated,
      synchronizedTicketIds: synchronization.ticketIds,
    };
  })().finally(() => submissionLocks.delete(normalizedToken));

  submissionLocks.set(normalizedToken, operation);
  return operation;
}

export function maintenanceSignatureRequestView(row) {
  return requestView(row);
}
