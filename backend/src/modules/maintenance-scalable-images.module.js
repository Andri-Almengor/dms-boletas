import { badRequest } from '../core/errors.js';
import { nowIso, pick, uuid } from '../core/utils.js';
import { env } from '../config/env.js';
import {
  appendRows,
  findById,
  getHeaders,
  invalidateTableCache,
  readTable,
} from '../infra/sheets.repository.js';
import { uploadBase64, trashFile } from '../infra/drive.repository.js';
import { sheetsApi } from '../infra/google.js';
import { getConfig } from './config.module.js';

function clean(value) {
  return String(value ?? '').trim();
}

function validClientGeneratedId(value) {
  return /^[A-Za-z0-9._:-]{8,160}$/.test(clean(value));
}

function normalizeEvidenceType(value) {
  return clean(value).toLowerCase().includes('desp') ? 'Despues' : 'Antes';
}

function previewUrl(row = {}) {
  if (row.PreviewURL) return row.PreviewURL;
  if (row.DriveFileID) return `https://drive.google.com/thumbnail?id=${encodeURIComponent(row.DriveFileID)}&sz=w1200`;
  return row.DriveURL || '';
}

function quote(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

function columnLetter(index) {
  let result = '';
  let value = Number(index) + 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = { status: 'fulfilled', value: await worker(items[index], index) };
      } catch (error) {
        results[index] = { status: 'rejected', reason: error };
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), Math.max(1, items.length)) },
    () => run(),
  );
  await Promise.all(workers);
  return results;
}

function imageInput(value = {}, index = 0) {
  const imageId = clean(pick(value, ['imageId', 'FotoDispositivoID', 'localId']));
  if (imageId && !validClientGeneratedId(imageId)) {
    throw badRequest(`El identificador local de la fotografía ${index + 1} no es válido.`);
  }
  const base64 = clean(value.base64);
  if (!base64) throw badRequest(`La fotografía ${index + 1} no contiene datos para cargar.`);
  return {
    imageId: imageId || `foto-${uuid()}`,
    base64,
    fileName: clean(value.fileName, `evidencia-${index + 1}.jpg`),
    mimeType: clean(value.mimeType, 'image/jpeg'),
    type: normalizeEvidenceType(pick(value, ['Tipo', 'tipo', 'type'], 'Antes')),
    note: clean(pick(value, ['Nota', 'nota', 'note'])),
    clientKey: clean(pick(value, ['localId', 'imageId', 'FotoDispositivoID'], imageId || String(index))),
  };
}

async function uploadBatch(ctx) {
  const deviceId = clean(pick(ctx.payload, ['deviceId', 'DispositivoMantenimientoRef']));
  const maintenanceId = clean(pick(ctx.payload, ['maintenanceId', 'MantenimientoID']));
  if (!deviceId) throw badRequest('Falta el dispositivo al que pertenecen las evidencias.');
  await findById('Evidencia_Mantenimientos', deviceId);

  const rawImages = Array.isArray(ctx.payload?.images) ? ctx.payload.images : [];
  if (!rawImages.length) return { uploaded: [], failed: [], skipped: [], total: 0 };
  if (rawImages.length > env.maintenanceImageBatchMaxFiles) {
    throw badRequest(`El lote contiene ${rawImages.length} fotografías. Envíe lotes de hasta ${env.maintenanceImageBatchMaxFiles}; el total del dispositivo no tiene límite.`);
  }

  const totalBase64Chars = rawImages.reduce((sum, item) => sum + clean(item?.base64).length, 0);
  if (totalBase64Chars > env.maintenanceImageBatchMaxBase64Chars) {
    throw badRequest('El lote de evidencias es demasiado pesado. Divídalo en lotes más pequeños; puede continuar enviando todos los lotes necesarios.');
  }

  const inputs = rawImages.map(imageInput);
  const currentRows = (await readTable('Mantenimiento imagenes')).filter((row) => row.Activo !== false);
  const existingById = new Map(currentRows.map((row) => [clean(row.FotoDispositivoID), row]));
  const skipped = [];
  const pending = [];

  for (const input of inputs) {
    const existing = existingById.get(input.imageId);
    if (!existing) {
      pending.push(input);
      continue;
    }
    if (clean(existing.DispositivoMantenimientoRef) !== deviceId) {
      throw badRequest(`La fotografía ${input.imageId} ya pertenece a otro dispositivo.`);
    }
    skipped.push({ ...existing, PreviewURL: previewUrl(existing), clientKey: input.clientKey, skipped: true });
  }

  if (!pending.length) {
    return { uploaded: skipped, failed: [], skipped, total: inputs.length };
  }

  const config = await getConfig();
  const folderId = config.EVIDENCIAS_FOLDER_ID || config.ROOT_FOLDER_ID;
  const uploadedDriveFiles = [];
  const results = await mapWithConcurrency(
    pending,
    env.maintenanceImageUploadConcurrency,
    async (input) => {
      const file = await uploadBase64({
        base64: input.base64,
        mimeType: input.mimeType,
        fileName: input.fileName,
        folderId,
      });
      uploadedDriveFiles.push(file);
      return {
        input,
        file,
        row: {
          FotoDispositivoID: input.imageId,
          DispositivoMantenimientoRef: deviceId,
          Tipo: input.type,
          Nombre: file.name,
          Nota: input.note,
          MimeType: file.mimeType,
          Size: file.size || '',
          DriveFileID: file.id,
          DriveURL: file.webViewLink,
          Activo: true,
          CreadoPor: ctx.user.UsuarioID,
          FechaCreacion: nowIso(),
          ActualizadoPor: ctx.user.UsuarioID,
          FechaActualizacion: nowIso(),
        },
      };
    },
  );

  const successful = results.filter((result) => result?.status === 'fulfilled').map((result) => result.value);
  const failed = results
    .map((result, index) => ({ result, input: pending[index] }))
    .filter(({ result }) => result?.status === 'rejected')
    .map(({ result, input }) => ({
      clientKey: input.clientKey,
      imageId: input.imageId,
      fileName: input.fileName,
      message: clean(result.reason?.message, 'No se pudo cargar la evidencia.'),
    }));

  if (successful.length) {
    try {
      await appendRows('Mantenimiento imagenes', successful.map((item) => item.row), {
        chunkSize: Math.min(successful.length, env.maintenanceImageBatchMaxFiles),
      });
    } catch (error) {
      await Promise.allSettled(successful.map((item) => trashFile(item.file.id)));
      throw error;
    }
  }

  const uploaded = [
    ...skipped,
    ...successful.map(({ input, file, row }) => ({
      ...row,
      PreviewURL: file.thumbnailLink || previewUrl(row),
      clientKey: input.clientKey,
      skipped: false,
    })),
  ];

  return {
    maintenanceId,
    deviceId,
    uploaded,
    failed,
    skipped,
    total: inputs.length,
    uploadedCount: uploaded.length,
    failedCount: failed.length,
  };
}

async function updateBatch(ctx) {
  const deviceId = clean(pick(ctx.payload, ['deviceId', 'DispositivoMantenimientoRef']));
  const updates = Array.isArray(ctx.payload?.updates) ? ctx.payload.updates : [];
  if (!updates.length) return { updated: [], failed: [], total: 0 };
  if (updates.length > env.maintenanceImageMetadataBatchMaxItems) {
    throw badRequest(`Envíe las actualizaciones de evidencias en lotes de hasta ${env.maintenanceImageMetadataBatchMaxItems}.`);
  }

  const [rows, headers] = await Promise.all([
    readTable('Mantenimiento imagenes'),
    getHeaders('Mantenimiento imagenes'),
  ]);
  const byId = new Map(rows.map((row) => [clean(row.FotoDispositivoID), row]));
  const data = [];
  const updated = [];
  const failed = [];
  const timestamp = nowIso();

  for (const input of updates) {
    const imageId = clean(pick(input, ['imageId', 'FotoDispositivoID']));
    const row = byId.get(imageId);
    if (!row) {
      failed.push({ imageId, message: 'No se encontró la evidencia.' });
      continue;
    }
    if (deviceId && clean(row.DispositivoMantenimientoRef) !== deviceId) {
      failed.push({ imageId, message: 'La evidencia pertenece a otro dispositivo.' });
      continue;
    }

    const patch = {
      Tipo: normalizeEvidenceType(pick(input, ['Tipo', 'tipo'], row.Tipo)),
      Nota: clean(pick(input, ['Nota', 'nota'], row.Nota)),
      ActualizadoPor: ctx.user.UsuarioID,
      FechaActualizacion: timestamp,
    };

    for (const [field, value] of Object.entries(patch)) {
      const index = headers.indexOf(field);
      if (index < 0) continue;
      data.push({
        range: `${quote('Mantenimiento imagenes')}!${columnLetter(index)}${row.__rowNumber}`,
        values: [[value]],
      });
    }
    updated.push({ ...row, ...patch, __rowNumber: undefined });
  }

  if (data.length) {
    await sheetsApi.spreadsheets.values.batchUpdate({
      spreadsheetId: env.sheetId,
      requestBody: { valueInputOption: 'USER_ENTERED', data },
    });
    invalidateTableCache('Mantenimiento imagenes');
  }

  return { updated, failed, total: updates.length, updatedCount: updated.length, failedCount: failed.length };
}

export const maintenanceScalableImageHandlers = {
  uploadBatch,
  updateBatch,
};
