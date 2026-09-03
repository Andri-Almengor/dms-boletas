import { Readable } from 'node:stream';
import { driveApi } from './google.js';
import { asString } from '../core/utils.js';

const DRIVE_UPLOAD_RETRY_DELAYS_MS = Object.freeze([650, 1500, 3200]);

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function driveErrorStatus(error) {
  return Number(
    error?.response?.status
    || error?.status
    || error?.code
    || 0,
  );
}

function retryableDriveError(error) {
  const status = driveErrorStatus(error);
  if ([408, 409, 429, 500, 502, 503, 504].includes(status)) return true;
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '').toLowerCase();
  return ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH'].includes(code)
    || message.includes('socket hang up')
    || message.includes('rate limit')
    || message.includes('backend error')
    || message.includes('temporarily unavailable');
}

async function withDriveUploadRetry(operation) {
  let lastError;
  for (let attempt = 0; attempt <= DRIVE_UPLOAD_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (!retryableDriveError(error) || attempt === DRIVE_UPLOAD_RETRY_DELAYS_MS.length) throw error;
      await wait(DRIVE_UPLOAD_RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastError;
}

export function extractDriveFileId(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const patterns = [
    /\/d\/([a-zA-Z0-9_-]{20,})/,
    /[?&]id=([a-zA-Z0-9_-]{20,})/,
    /^([a-zA-Z0-9_-]{20,})$/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return '';
}

export async function uploadBuffer({ buffer, mimeType = 'application/octet-stream', fileName, folderId }) {
  const content = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
  if (!content.length) throw new Error('El archivo no contiene datos.');

  return withDriveUploadRetry(async () => {
    const { data } = await driveApi.files.create({
      requestBody: {
        name: fileName || `archivo-${Date.now()}`,
        mimeType,
        parents: folderId ? [folderId] : undefined,
      },
      // Se crea un stream nuevo en cada intento; un stream consumido no puede
      // reutilizarse después de una respuesta transitoria de Google Drive.
      media: { mimeType, body: Readable.from(Buffer.from(content)) },
      fields: 'id,name,mimeType,size,webViewLink,webContentLink,thumbnailLink',
      supportsAllDrives: true,
    });
    if (!data?.id) throw new Error('Google Drive no devolvió el identificador del archivo cargado.');
    return data;
  });
}

export async function uploadBase64({ base64, mimeType = 'application/octet-stream', fileName, folderId }) {
  if (Buffer.isBuffer(base64) || ArrayBuffer.isView(base64)) {
    return uploadBuffer({
      buffer: Buffer.from(base64),
      mimeType,
      fileName,
      folderId,
    });
  }

  const normalized = String(base64 || '').replace(/[\r\n\s]/g, '');
  if (!normalized) throw new Error('El archivo no contiene datos Base64.');
  return uploadBuffer({
    buffer: Buffer.from(normalized, 'base64'),
    mimeType,
    fileName,
    folderId,
  });
}

export async function getDriveFile(fileId) {
  const { data } = await driveApi.files.get({
    fileId,
    fields: 'id,name,mimeType,size,webViewLink,webContentLink,thumbnailLink,parents,trashed',
    supportsAllDrives: true,
  });
  return data;
}

export async function downloadFileBuffer(fileId, fallbackMime = 'application/octet-stream') {
  const meta = await getDriveFile(fileId);
  const response = await driveApi.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' },
  );
  return {
    ...meta,
    mimeType: meta.mimeType || fallbackMime,
    buffer: Buffer.from(response.data),
  };
}

export async function downloadAsDataUrl(fileId, fallbackMime = 'application/octet-stream') {
  const file = await downloadFileBuffer(fileId, fallbackMime);
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    size: file.size,
    webViewLink: file.webViewLink,
    dataUrl: `data:${file.mimeType};base64,${file.buffer.toString('base64')}`,
    url: file.webViewLink,
  };
}

export async function copyDriveFile({ fileId, name, folderId }) {
  const { data } = await driveApi.files.copy({
    fileId,
    requestBody: { name, parents: folderId ? [folderId] : undefined },
    fields: 'id,name,mimeType,size,webViewLink,parents',
    supportsAllDrives: true,
  });
  return data;
}

export async function exportGoogleFile(fileId, mimeType = 'application/pdf') {
  const response = await driveApi.files.export(
    { fileId, mimeType },
    { responseType: 'arraybuffer' },
  );
  return Buffer.from(response.data);
}

export async function createTemporaryPublicImageUrl(fileId) {
  const { data } = await driveApi.permissions.create({
    fileId,
    requestBody: { type: 'anyone', role: 'reader', allowFileDiscovery: false },
    fields: 'id',
    supportsAllDrives: true,
  });
  return {
    permissionId: data.id,
    url: `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`,
  };
}

export async function removeDrivePermission(fileId, permissionId) {
  if (!fileId || !permissionId) return;
  await driveApi.permissions.delete({ fileId, permissionId, supportsAllDrives: true });
}

export async function createFolder(name, parentId) {
  const safe = asString(name, 'Sin nombre').replace(/[\\/:*?"<>|#%{}~&]/g, '-').slice(0, 120);
  const q = [`name='${safe.replace(/'/g, "\\'")}'`, "mimeType='application/vnd.google-apps.folder'", 'trashed=false'];
  if (parentId) q.push(`'${parentId}' in parents`);
  const existing = await driveApi.files.list({
    q: q.join(' and '),
    fields: 'files(id,name,webViewLink)',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  if (existing.data.files?.[0]) return existing.data.files[0];
  const { data } = await driveApi.files.create({
    requestBody: { name: safe, mimeType: 'application/vnd.google-apps.folder', parents: parentId ? [parentId] : undefined },
    fields: 'id,name,webViewLink',
    supportsAllDrives: true,
  });
  return data;
}

export async function trashFile(fileId) {
  if (!fileId) return;
  await driveApi.files.update({ fileId, requestBody: { trashed: true }, supportsAllDrives: true });
}
