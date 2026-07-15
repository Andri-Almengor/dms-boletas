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

const SHEET_NAME = 'FirmaSolicitudes';
const HEADERS = [
  'SolicitudFirmaID',
  'Token',
  'BoletaUID',
  'BoletaID',
  'ClienteID',
  'ClienteNombre',
  'TituloBoleta',
  'CorreoCliente',
  'FirmaURLPublica',
  'Estado',
  'FirmaArchivoID',
  'FirmaURL',
  'FechaCreacion',
  'FechaExpiracion',
  'FechaFirma',
  'EstadoEntrega',
  'ErrorEntrega',
  'PDFURLFirmado',
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

export async function ensureSignatureStorage() {
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
  const selected = candidates.map(clean).find((value) => /^https?:\/\//i.test(value) && value !== '*');
  if (!selected) {
    throw new AppError('SIGNATURE_PUBLIC_URL_MISSING', 'No fue posible determinar la URL pública para firmar la boleta.', 503);
  }
  return selected.replace(/\/+$/, '');
}

export function ticketHasSignature(ticket = {}) {
  return Boolean(clean(pick(ticket, ['FirmaArchivoID', 'FirmaFileID', 'FirmaURL', 'FirmaUrl', 'Firma'])));
}

function requestView(row = {}) {
  return {
    id: clean(row.SolicitudFirmaID),
    token: clean(row.Token),
    ticketUid: clean(row.BoletaUID),
    ticketNumber: clean(row.BoletaID || row.BoletaUID),
    clientId: clean(row.ClienteID),
    clientName: clean(row.ClienteNombre, 'Cliente'),
    ticketTitle: clean(row.TituloBoleta, 'Boleta de servicio'),
    clientEmail: clean(row.CorreoCliente),
    url: clean(row.FirmaURLPublica),
    status: clean(row.Estado, 'PENDIENTE').toUpperCase(),
    createdAt: row.FechaCreacion || '',
    expiresAt: row.FechaExpiracion || '',
    signedAt: row.FechaFirma || '',
    deliveryState: clean(row.EstadoEntrega),
    deliveryError: clean(row.ErrorEntrega),
    signedPdfUrl: clean(row.PDFURLFirmado),
  };
}

async function expireIfNeeded(row) {
  if (clean(row.Estado).toUpperCase() !== 'PENDIENTE') return row;
  const expiration = new Date(row.FechaExpiracion || 0).getTime();
  if (expiration && expiration < Date.now()) {
    return updateRow(SHEET_NAME, row.SolicitudFirmaID, {
      Estado: 'EXPIRADA',
      ActualizadoPor: 'SISTEMA',
      FechaActualizacion: nowIso(),
    });
  }
  return row;
}

export async function ensureSignatureRequestForTicket({ ticketId, origin = '', actor = 'SISTEMA' }) {
  await ensureSignatureStorage();
  const ticket = await findById('Boletas', ticketId);
  if (ticketHasSignature(ticket)) {
    return {
      id: '',
      token: '',
      ticketUid: clean(ticket.BoletaUID),
      ticketNumber: clean(ticket.BoletaID || ticket.BoletaUID),
      clientId: clean(ticket.ClienteID),
      clientName: clean(ticket.Cliente, 'Cliente'),
      ticketTitle: clean(ticket.Titulo, 'Boleta de servicio'),
      clientEmail: clean(ticket.CorreoCliente),
      url: '',
      status: 'FIRMADA',
      signedAt: ticket.FirmaFecha || ticket.FechaActualizacion || '',
    };
  }

  const requests = await readTable(SHEET_NAME, { force: true });
  const candidates = requests
    .filter((row) => clean(row.BoletaUID) === clean(ticket.BoletaUID))
    .sort((left, right) => String(right.FechaCreacion || '').localeCompare(String(left.FechaCreacion || '')));

  for (const candidate of candidates) {
    const current = await expireIfNeeded(candidate);
    if (clean(current.Estado).toUpperCase() === 'PENDIENTE') return requestView(current);
  }

  const createdAt = nowIso();
  const token = crypto.randomBytes(32).toString('base64url');
  const url = `${publicBaseUrl(origin)}/firmar/${encodeURIComponent(token)}`;
  const row = {
    SolicitudFirmaID: uuid(),
    Token: token,
    BoletaUID: ticket.BoletaUID,
    BoletaID: ticket.BoletaID || ticket.BoletaUID,
    ClienteID: ticket.ClienteID || '',
    ClienteNombre: ticket.Cliente || 'Cliente',
    TituloBoleta: ticket.Titulo || 'Boleta de servicio',
    CorreoCliente: ticket.CorreoCliente || '',
    FirmaURLPublica: url,
    Estado: 'PENDIENTE',
    FirmaArchivoID: '',
    FirmaURL: '',
    FechaCreacion: createdAt,
    FechaExpiracion: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    FechaFirma: '',
    EstadoEntrega: '',
    ErrorEntrega: '',
    PDFURLFirmado: '',
    CreadoPor: actor,
    ActualizadoPor: actor,
    FechaActualizacion: createdAt,
  };
  await appendRow(SHEET_NAME, row);
  return requestView(row);
}

export async function findSignatureRequestByToken(token) {
  await ensureSignatureStorage();
  const normalized = clean(token);
  if (!normalized) throw badRequest('El enlace de firma no es válido.');
  const row = (await readTable(SHEET_NAME, { force: true })).find((item) => clean(item.Token) === normalized);
  if (!row) throw notFound('El enlace de firma no existe o ya no es válido.');
  return expireIfNeeded(row);
}

function normalizeBase64(value) {
  return String(value || '').replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '').replace(/\s+/g, '');
}

function validateSignaturePayload(base64, mimeType) {
  const normalized = normalizeBase64(base64);
  if (!normalized) throw badRequest('Debe dibujar la firma antes de guardarla.');
  if (!/^image\/(png|jpeg|jpg)$/i.test(clean(mimeType, 'image/png'))) {
    throw badRequest('La firma debe enviarse como una imagen PNG o JPEG.');
  }
  const estimatedBytes = Math.floor(normalized.length * 0.75);
  if (estimatedBytes > 4 * 1024 * 1024) throw badRequest('La firma supera el tamaño máximo permitido de 4 MB.');
  return normalized;
}

export async function applyPublicSignature({ token, base64, mimeType = 'image/png' }) {
  const normalizedToken = clean(token);
  if (submissionLocks.has(normalizedToken)) return submissionLocks.get(normalizedToken);

  const operation = (async () => {
    let request = await findSignatureRequestByToken(normalizedToken);
    const state = clean(request.Estado).toUpperCase();
    if (state === 'FIRMADA') {
      return { alreadySigned: true, request: requestView(request), ticket: await findById('Boletas', request.BoletaUID) };
    }
    if (state === 'EXPIRADA') throw new AppError('SIGNATURE_LINK_EXPIRED', 'Este enlace de firma ha expirado.', 410);
    if (state !== 'PENDIENTE') throw new AppError('SIGNATURE_LINK_UNAVAILABLE', 'Este enlace de firma ya no está disponible.', 409);

    const ticket = await findById('Boletas', request.BoletaUID);
    if (ticketHasSignature(ticket)) {
      request = await updateRow(SHEET_NAME, request.SolicitudFirmaID, {
        Estado: 'FIRMADA',
        FechaFirma: ticket.FirmaFecha || ticket.FechaActualizacion || nowIso(),
        FirmaArchivoID: pick(ticket, ['FirmaArchivoID', 'FirmaFileID']),
        FirmaURL: pick(ticket, ['FirmaURL', 'FirmaUrl']),
        ActualizadoPor: 'CLIENTE',
        FechaActualizacion: nowIso(),
      });
      return { alreadySigned: true, request: requestView(request), ticket };
    }

    const normalizedBase64 = validateSignaturePayload(base64, mimeType);
    const config = await getConfig();
    const folderId = clean(config.FIRMAS_FOLDER_ID || process.env.FIRMAS_FOLDER_ID);
    if (!folderId) throw new AppError('SIGNATURE_FOLDER_NOT_CONFIGURED', 'No está configurada la carpeta de firmas.', 503);

    const file = await uploadBase64({
      base64: normalizedBase64,
      mimeType,
      fileName: `firma_cliente_boleta_${clean(ticket.BoletaID || ticket.BoletaUID)}.png`,
      folderId,
    });
    const timestamp = nowIso();
    const updatedTicket = await updateRow('Boletas', ticket.BoletaUID, {
      FirmaArchivoID: file.id,
      FirmaURL: file.webViewLink,
      FirmaMimeType: mimeType,
      FirmaOrigen: 'ENLACE_CLIENTE',
      FirmaFecha: timestamp,
      Version: Number(ticket.Version || 0) + 1,
      ActualizadoPor: 'CLIENTE',
      FechaActualizacion: timestamp,
    });
    request = await updateRow(SHEET_NAME, request.SolicitudFirmaID, {
      Estado: 'FIRMADA',
      FirmaArchivoID: file.id,
      FirmaURL: file.webViewLink,
      FechaFirma: timestamp,
      EstadoEntrega: 'PENDIENTE',
      ErrorEntrega: '',
      ActualizadoPor: 'CLIENTE',
      FechaActualizacion: timestamp,
    });
    return { alreadySigned: false, request: requestView(request), ticket: updatedTicket, file };
  })().finally(() => submissionLocks.delete(normalizedToken));

  submissionLocks.set(normalizedToken, operation);
  return operation;
}

export async function updateSignatureDelivery(requestId, { state = '', error = '', pdfUrl = '' } = {}) {
  await ensureSignatureStorage();
  return updateRow(SHEET_NAME, requestId, {
    EstadoEntrega: clean(state),
    ErrorEntrega: clean(error).slice(0, 1500),
    PDFURLFirmado: clean(pdfUrl),
    ActualizadoPor: 'SISTEMA',
    FechaActualizacion: nowIso(),
  });
}

export function signatureRequestView(row) {
  return requestView(row);
}
