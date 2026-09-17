import { driveApi } from '../infra/google.js';

export async function uploadDriveStream({ stream, mimeType='application/gzip', fileName, folderId }) {
  const { data } = await driveApi.files.create({
    requestBody: { name: fileName, mimeType, parents: folderId ? [folderId] : undefined },
    media: { mimeType, body: stream },
    fields: 'id,name,mimeType,size,webViewLink,parents',
    supportsAllDrives: true,
  });
  if (!data?.id) throw new Error('Google Drive no devolvió el identificador del respaldo.');
  return data;
}
