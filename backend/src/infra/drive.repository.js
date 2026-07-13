import { Readable } from 'node:stream';
import { driveApi } from './google.js';
import { asString } from '../core/utils.js';

export async function uploadBase64({ base64, mimeType = 'application/octet-stream', fileName, folderId }) {
  const buffer = Buffer.from(String(base64 || ''), 'base64');
  if (!buffer.length) throw new Error('El archivo no contiene datos.');
  const { data } = await driveApi.files.create({
    requestBody: { name: fileName || `archivo-${Date.now()}`, mimeType, parents: folderId ? [folderId] : undefined },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id,name,mimeType,size,webViewLink,webContentLink,thumbnailLink',
    supportsAllDrives: true,
  });
  return data;
}

export async function downloadAsDataUrl(fileId, fallbackMime = 'application/octet-stream') {
  const meta = await driveApi.files.get({ fileId, fields: 'id,name,mimeType,size,webViewLink', supportsAllDrives: true });
  const response = await driveApi.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
  const mimeType = meta.data.mimeType || fallbackMime;
  return { ...meta.data, dataUrl: `data:${mimeType};base64,${Buffer.from(response.data).toString('base64')}`, url: meta.data.webViewLink };
}

export async function createFolder(name, parentId) {
  const safe = asString(name, 'Sin nombre').replace(/[\\/:*?"<>|#%{}~&]/g, '-').slice(0, 120);
  const q = [`name='${safe.replace(/'/g, "\\'")}'`, "mimeType='application/vnd.google-apps.folder'", 'trashed=false'];
  if (parentId) q.push(`'${parentId}' in parents`);
  const existing = await driveApi.files.list({ q: q.join(' and '), fields: 'files(id,name,webViewLink)', pageSize: 1, supportsAllDrives: true, includeItemsFromAllDrives: true });
  if (existing.data.files?.[0]) return existing.data.files[0];
  const { data } = await driveApi.files.create({ requestBody: { name: safe, mimeType: 'application/vnd.google-apps.folder', parents: parentId ? [parentId] : undefined }, fields: 'id,name,webViewLink', supportsAllDrives: true });
  return data;
}

export async function trashFile(fileId) {
  if (!fileId) return;
  await driveApi.files.update({ fileId, requestBody: { trashed: true }, supportsAllDrives: true });
}
