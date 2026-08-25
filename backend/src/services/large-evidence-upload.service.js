import crypto from 'node:crypto';
import { badRequest } from '../core/errors.js';
import { nowIso, pick, uuid } from '../core/utils.js';
import { env } from '../config/env.js';
import { googleAuth } from '../infra/google.js';
import { appendRow, findById, readTable } from '../infra/sheets.repository.js';
import { getConfig } from '../modules/config.module.js';
import { ensureSheetColumns } from './sheet-columns.service.js';
import { validateEvidenceMediaPayload } from './evidence-media-policy.service.js';

export const LARGE_VIDEO_THRESHOLD_BYTES = 30 * 1024 * 1024;
export const LARGE_VIDEO_MAX_BYTES = 300 * 1024 * 1024;
export const LARGE_VIDEO_CHUNK_BYTES = 8 * 1024 * 1024;
const UPLOAD_TOKEN_TTL_MS = 4 * 60 * 60 * 1000;
const DRIVE_RESUMABLE_PREFIX = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable';
const TICKET_MEDIA_COLUMNS = ['TipoMedio', 'DuracionSegundos', 'TamanoBytes'];
const MAINTENANCE_MEDIA_COLUMNS = ['TipoMedio', 'DuracionSegundos'];

function clean(value) {
  return String(value ?? '').trim();
}

function validClientGeneratedId(value) {
  return /^[A-Za-z0-9._:-]{8,160}$/.test(String(value || ''));
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signingKey() {
  return crypto.createHash('sha256').update(String(env.googlePrivateKey || '')).digest();
}

function sign(encodedPayload) {
  return crypto.createHmac('sha256', signingKey()).update(encodedPayload).digest('base64url');
}

function createUploadToken(payload) {
  const encoded = encode({ ...payload, exp: Date.now() + UPLOAD_TOKEN_TTL_MS });
  return `${encoded}.${sign(encoded)}`;
}

function parseUploadToken(token, expectedKind) {
  const [encoded, signature] = clean(token).split('.');
  if (!encoded || !signature) throw badRequest('La sesión de carga del video no es válida. Inicie la carga nuevamente.');
  const expected = sign(encoded);
  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    throw badRequest('La sesión de carga del video no es válida. Inicie la carga nuevamente.');
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw badRequest('La sesión de carga del video no se pudo leer. Inicie la carga nuevamente.');
  }
  if (Number(payload.exp || 0) <= Date.now()) throw badRequest('La sesión de carga del video expiró. Inicie la carga nuevamente.');
  if (payload.kind !== expectedKind) throw badRequest('La sesión de carga no corresponde a este tipo de evidencia.');
  if (!clean(payload.sessionUrl).startsWith(DRIVE_RESUMABLE_PREFIX)) throw badRequest('La sesión de Drive recibida no es válida.');
  return payload;
}

async function accessToken() {
  const result = await googleAuth.getAccessToken();
  const token = typeof result === 'string' ? result : result?.token;
  if (!token) throw new Error('No fue posible obtener una credencial temporal para Google Drive.');
  return token;
}

async function startDriveResumableSession({ fileName, mimeType, size, folderId }) {
  const token = await accessToken();
  const url = `${DRIVE_RESUMABLE_PREFIX}&supportsAllDrives=true&fields=id,name,mimeType,size,webViewLink,webContentLink,thumbnailLink,parents`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mimeType,
      'X-Upload-Content-Length': String(size),
    },
    body: JSON.stringify({
      name: fileName || `video-${Date.now()}.mp4`,
      mimeType,
      parents: folderId ? [folderId] : undefined,
    }),
  });
  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(`Google Drive no pudo iniciar la carga reanudable (${response.status}). ${message.slice(0, 300)}`.trim());
  }
  const sessionUrl = response.headers.get('location');
  if (!sessionUrl) throw new Error('Google Drive no devolvió la sesión reanudable del video.');
  return sessionUrl;
}

function existingTicketEvidence(rows, evidenceId, boletaUid) {
  const existing = rows.find((row) => clean(row.EvidenciaID) === evidenceId);
  if (!existing) return null;
  if (clean(existing.BoletaUID) !== clean(boletaUid)) throw badRequest('La evidencia local ya pertenece a otra boleta.');
  return existing;
}

function existingMaintenanceEvidence(rows, imageId, deviceId) {
  const existing = rows.find((row) => clean(row.FotoDispositivoID) === imageId);
  if (!existing) return null;
  if (clean(existing.DispositivoMantenimientoRef) !== clean(deviceId)) throw badRequest('La evidencia local ya pertenece a otro dispositivo.');
  return existing;
}

function validatedVideoMetadata(payload) {
  const metadata = validateEvidenceMediaPayload(payload, { allowDocuments: false, requireData: false });
  if (metadata.mediaType !== 'VIDEO') throw badRequest('La carga reanudable está disponible únicamente para videos.');
  if (metadata.size <= LARGE_VIDEO_THRESHOLD_BYTES) {
    throw badRequest('Este video puede utilizar la carga normal. La carga reanudable se reserva para archivos mayores de 30 MB.');
  }
  if (metadata.size > LARGE_VIDEO_MAX_BYTES) throw badRequest('El video supera el límite de 300 MB.');
  return metadata;
}

async function initTicket(ctx) {
  const boletaUid = clean(pick(ctx.payload, ['boletaUid', 'BoletaUID']));
  const evidenceId = clean(pick(ctx.payload, ['evidenciaId', 'EvidenciaID'], uuid()));
  if (!boletaUid) throw badRequest('No se indicó la boleta de la evidencia.');
  if (!validClientGeneratedId(evidenceId)) throw badRequest('El identificador local de la evidencia no es válido.');
  await findById('Boletas', boletaUid);
  const existing = existingTicketEvidence(await readTable('EvidenciasBoleta', { force: true }), evidenceId, boletaUid);
  if (existing) return { complete: true, evidence: existing };

  const metadata = validatedVideoMetadata(ctx.payload);
  const cfg = await getConfig();
  const sessionUrl = await startDriveResumableSession({
    fileName: clean(ctx.payload.fileName, `video-${Date.now()}.mp4`),
    mimeType: metadata.mimeType,
    size: metadata.size,
    folderId: cfg.EVIDENCIAS_FOLDER_ID,
  });

  return {
    complete: false,
    chunkBytes: LARGE_VIDEO_CHUNK_BYTES,
    uploadToken: createUploadToken({
      kind: 'ticket',
      sessionUrl,
      boletaUid,
      evidenceId,
      fileName: clean(ctx.payload.fileName),
      name: clean(pick(ctx.payload, ['nombre', 'Nombre'], ctx.payload.fileName)),
      note: clean(pick(ctx.payload, ['nota', 'Nota'])),
      mimeType: metadata.mimeType,
      mediaType: metadata.mediaType,
      durationSeconds: metadata.durationSeconds,
      size: metadata.size,
      order: Number(ctx.payload.orden || 0),
      actor: ctx.user.UsuarioID,
    }),
  };
}

async function initMaintenance(ctx) {
  const deviceId = clean(pick(ctx.payload, ['deviceId', 'DispositivoMantenimientoRef']));
  const imageId = clean(pick(ctx.payload, ['imageId', 'FotoDispositivoID'], uuid()));
  if (!deviceId) throw badRequest('No se indicó el dispositivo de la evidencia.');
  if (!validClientGeneratedId(imageId)) throw badRequest('El identificador local de la evidencia no es válido.');
  await findById('Evidencia_Mantenimientos', deviceId);
  const existing = existingMaintenanceEvidence(await readTable('Mantenimiento imagenes', { force: true }), imageId, deviceId);
  if (existing) return { complete: true, evidence: existing };

  const metadata = validatedVideoMetadata(ctx.payload);
  const cfg = await getConfig();
  const sessionUrl = await startDriveResumableSession({
    fileName: clean(ctx.payload.fileName, `video-${Date.now()}.mp4`),
    mimeType: metadata.mimeType,
    size: metadata.size,
    folderId: cfg.EVIDENCIAS_FOLDER_ID || cfg.ROOT_FOLDER_ID,
  });

  return {
    complete: false,
    chunkBytes: LARGE_VIDEO_CHUNK_BYTES,
    uploadToken: createUploadToken({
      kind: 'maintenance',
      sessionUrl,
      deviceId,
      imageId,
      fileName: clean(ctx.payload.fileName),
      note: clean(pick(ctx.payload, ['Nota', 'nota'])),
      evidenceType: String(pick(ctx.payload, ['Tipo', 'tipo'], 'Antes')).toLowerCase().includes('desp') ? 'Despues' : 'Antes',
      mimeType: metadata.mimeType,
      mediaType: metadata.mediaType,
      durationSeconds: metadata.durationSeconds,
      size: metadata.size,
      actor: ctx.user.UsuarioID,
    }),
  };
}

async function appendTicketEvidence(token, file) {
  const existing = existingTicketEvidence(await readTable('EvidenciasBoleta', { force: true }), token.evidenceId, token.boletaUid);
  if (existing) return existing;
  await ensureSheetColumns('EvidenciasBoleta', TICKET_MEDIA_COLUMNS);
  const timestamp = nowIso();
  const row = {
    EvidenciaID: token.evidenceId,
    BoletaUID: token.boletaUid,
    Nombre: token.name || file.name,
    Nota: token.note,
    ArchivoID: file.id,
    ArchivoURL: file.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view`,
    NombreArchivo: file.name || token.fileName,
    MimeType: file.mimeType || token.mimeType,
    TipoMedio: 'VIDEO',
    DuracionSegundos: token.durationSeconds,
    TamanoBytes: token.size,
    Orden: Number(token.order || 0),
    Activo: true,
    CreadoPor: token.actor,
    FechaCreacion: timestamp,
    ActualizadoPor: token.actor,
    FechaActualizacion: timestamp,
  };
  await appendRow('EvidenciasBoleta', row);
  return row;
}

async function appendMaintenanceEvidence(token, file) {
  const existing = existingMaintenanceEvidence(await readTable('Mantenimiento imagenes', { force: true }), token.imageId, token.deviceId);
  if (existing) return existing;
  await ensureSheetColumns('Mantenimiento imagenes', MAINTENANCE_MEDIA_COLUMNS);
  const timestamp = nowIso();
  const row = {
    FotoDispositivoID: token.imageId,
    DispositivoMantenimientoRef: token.deviceId,
    Tipo: token.evidenceType,
    Nombre: file.name || token.fileName,
    Nota: token.note,
    MimeType: file.mimeType || token.mimeType,
    Size: file.size || token.size,
    TipoMedio: 'VIDEO',
    DuracionSegundos: token.durationSeconds,
    DriveFileID: file.id,
    DriveURL: file.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view`,
    Activo: true,
    CreadoPor: token.actor,
    FechaCreacion: timestamp,
    ActualizadoPor: token.actor,
    FechaActualizacion: timestamp,
  };
  await appendRow('Mantenimiento imagenes', row);
  return {
    ...row,
    PreviewURL: row.DriveURL,
  };
}

async function uploadChunk(ctx, kind) {
  const token = parseUploadToken(ctx.payload.uploadToken, kind);
  const existingRows = await readTable(kind === 'ticket' ? 'EvidenciasBoleta' : 'Mantenimiento imagenes', { force: true });
  const existing = kind === 'ticket'
    ? existingTicketEvidence(existingRows, token.evidenceId, token.boletaUid)
    : existingMaintenanceEvidence(existingRows, token.imageId, token.deviceId);
  if (existing) return { complete: true, evidence: existing, nextOffset: token.size };

  const offset = Number(ctx.payload.offset);
  if (!Number.isInteger(offset) || offset < 0 || offset >= token.size) throw badRequest('La posición del bloque del video no es válida.');
  const normalized = clean(ctx.payload.base64).replace(/\s+/g, '');
  if (!normalized) throw badRequest('El bloque del video no contiene datos.');
  const buffer = Buffer.from(normalized, 'base64');
  if (!buffer.length || buffer.length > LARGE_VIDEO_CHUNK_BYTES) throw badRequest('El bloque del video supera el tamaño permitido.');
  const end = offset + buffer.length - 1;
  if (end >= token.size) throw badRequest('El bloque del video excede el tamaño total declarado.');

  const bearer = await accessToken();
  const response = await fetch(token.sessionUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': token.mimeType,
      'Content-Length': String(buffer.length),
      'Content-Range': `bytes ${offset}-${end}/${token.size}`,
    },
    body: buffer,
  });

  if (response.status === 308) {
    const range = response.headers.get('range') || '';
    const match = range.match(/bytes=0-(\d+)/i);
    const nextOffset = match ? Number(match[1]) + 1 : end + 1;
    return { complete: false, nextOffset };
  }
  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(`Google Drive no pudo recibir un bloque del video (${response.status}). ${message.slice(0, 300)}`.trim());
  }

  const file = await response.json();
  if (!file?.id) throw new Error('Google Drive no devolvió el archivo al completar el video.');
  const evidence = kind === 'ticket'
    ? await appendTicketEvidence(token, file)
    : await appendMaintenanceEvidence(token, file);
  return { complete: true, nextOffset: token.size, evidence };
}

export const largeEvidenceUploadHandlers = {
  ticketInit: initTicket,
  ticketChunk: (ctx) => uploadChunk(ctx, 'ticket'),
  maintenanceInit: initMaintenance,
  maintenanceChunk: (ctx) => uploadChunk(ctx, 'maintenance'),
};
