import { Readable } from 'node:stream';
import { driveApi } from './google.js';
import { asString } from '../core/utils.js';

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
  const { data } = await driveApi.files.create({
    requestBody: { name: fileName || `archivo-${Date.now()}`, mimeType, parents: folderId ? [folderId] : undefined },
    media: { mimeType, body: Readable.from(content) },
    fields: 'id,name,mimeType,size,webViewLink,webContentLink,thumbnailLink',
    supportsAllDrives: true,
  });
  return data;
}

export async function uploadBase64({ base64, mimeType = 'application/octet-stream', fileName, folderId }) {
  return uploadBuffer({
    buffer: Buffer.from(String(base64 || ''), 'base64'),
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
