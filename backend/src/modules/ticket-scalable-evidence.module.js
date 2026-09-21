import { badRequest } from '../core/errors.js';
import { nowIso, pick, uuid } from '../core/utils.js';
import { env } from '../config/env.js';
import { appendRows, findById, findRows } from '../infra/sheets.repository.js';
import { trashFile, uploadBase64 } from '../infra/drive.repository.js';
import { ticketAccessHandlers } from './ticket-access.module.js';
import { getConfig } from './config.module.js';
import {
  EVIDENCE_VIDEO_INLINE_MAX_BYTES,
  validateEvidenceMediaPayload,
} from '../services/evidence-media-policy.service.js';

function clean(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function validClientGeneratedId(value) {
  return /^[A-Za-z0-9._:-]{8,160}$/.test(clean(value));
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

  await Promise.all(Array.from(
    { length: Math.min(Math.max(1, concurrency), Math.max(1, items.length)) },
    () => run(),
  ));
  return results;
}

function evidenceInput(value = {}, index = 0) {
  const evidenceId = clean(pick(value, ['evidenceId', 'evidenciaId', 'EvidenciaID', 'localId']));
  if (evidenceId && !validClientGeneratedId(evidenceId)) {
    throw badRequest(`El identificador local de la evidencia ${index + 1} no es válido.`);
  }

  const base64 = clean(value.base64);
  if (!base64) throw badRequest(`La evidencia ${index + 1} no contiene datos para cargar.`);

  const metadata = validateEvidenceMediaPayload(value, {
    allowDocuments: true,
    maxVideoBytes: EVIDENCE_VIDEO_INLINE_MAX_BYTES,
  });

  return {
    evidenceId: evidenceId || `evidencia-${uuid()}`,
    clientKey: clean(pick(value, ['clientKey', 'localId', 'evidenceId', 'evidenciaId', 'EvidenciaID'], evidenceId || String(index))),
    base64,
    name: clean(pick(value, ['nombre', 'Nombre', 'name'], value.fileName)),
    note: clean(pick(value, ['nota', 'Nota', 'note'])),
    fileName: clean(value.fileName, `evidencia-${index + 1}`),
    mimeType: metadata.mimeType,
    mediaType: metadata.mediaType,
    durationSeconds: metadata.durationSeconds,
    size: metadata.size,
    order: Number(value.orden || value.order || 0),
  };
}

async function uploadBatch(ctx) {
  const boletaUid = clean(pick(ctx.payload, ['boletaUid', 'BoletaUID']));
  if (!boletaUid) throw badRequest('No se indicó la boleta de las evidencias.');

  const ticket = await findById('Boletas', boletaUid);
  await ticketAccessHandlers.assertTicketAccess(ctx, ticket, 'agregar evidencias a');

  const raw = Array.isArray(ctx.payload?.evidences)
    ? ctx.payload.evidences
    : (Array.isArray(ctx.payload?.evidencias) ? ctx.payload.evidencias : []);

  if (!raw.length) return { uploaded: [], failed: [], skipped: [], total: 0 };
  if (raw.length > env.ticketEvidenceBatchMaxFiles) {
    throw badRequest(`El lote contiene ${raw.length} evidencias. Envíe lotes de hasta ${env.ticketEvidenceBatchMaxFiles}.`);
  }

  const totalBase64Chars = raw.reduce((sum, item) => sum + clean(item?.base64).length, 0);
  if (totalBase64Chars > env.ticketEvidenceBatchMaxBase64Chars) {
    throw badRequest('El lote de evidencias es demasiado pesado. Divídalo en lotes más pequeños.');
  }

  const inputs = raw.map(evidenceInput);
  const existingRows = await findRows(
    'EvidenciasBoleta',
    { EvidenciaID: inputs.map((item) => item.evidenceId) },
    { limit: Math.max(inputs.length, 1) },
  );
  const existingById = new Map(existingRows.map((row) => [clean(row.EvidenciaID), row]));
  const skipped = [];
  const pending = [];

  for (const input of inputs) {
    const existing = existingById.get(input.evidenceId);
    if (!existing) {
      pending.push(input);
      continue;
    }
    if (clean(existing.BoletaUID) !== boletaUid) {
      throw badRequest(`La evidencia ${input.evidenceId} ya pertenece a otra boleta.`);
    }
    skipped.push({ ...existing, clientKey: input.clientKey, skipped: true });
  }

  if (!pending.length) {
    return {
      boletaUid,
      uploaded: skipped,
      failed: [],
      skipped,
      total: inputs.length,
      uploadedCount: skipped.length,
      failedCount: 0,
    };
  }

  const config = await getConfig();
  const folderId = config.EVIDENCIAS_FOLDER_ID || config.ROOT_FOLDER_ID;
  const timestamp = nowIso();

  const results = await mapWithConcurrency(
    pending,
    env.ticketEvidenceUploadConcurrency,
    async (input) => {
      const file = await uploadBase64({
        base64: input.base64,
        mimeType: input.mimeType,
        fileName: input.fileName,
        folderId,
      });
      return {
        input,
        file,
        row: {
          EvidenciaID: input.evidenceId,
          BoletaUID: boletaUid,
          Nombre: input.name || file.name,
          Nota: input.note,
          ArchivoID: file.id,
          ArchivoURL: file.webViewLink,
          NombreArchivo: file.name,
          MimeType: file.mimeType || input.mimeType,
          TipoMedio: input.mediaType,
          DuracionSegundos: input.durationSeconds,
          TamanoBytes: input.size,
          Orden: input.order,
          Activo: true,
          CreadoPor: ctx.user.UsuarioID,
          FechaCreacion: timestamp,
          ActualizadoPor: ctx.user.UsuarioID,
          FechaActualizacion: timestamp,
        },
      };
    },
  );

  const successful = results
    .filter((result) => result?.status === 'fulfilled')
    .map((result) => result.value);

  const failed = results
    .map((result, index) => ({ result, input: pending[index] }))
    .filter(({ result }) => result?.status === 'rejected')
    .map(({ result, input }) => ({
      clientKey: input.clientKey,
      evidenceId: input.evidenceId,
      fileName: input.fileName,
      message: clean(result.reason?.message, 'No se pudo cargar la evidencia.'),
    }));

  if (successful.length) {
    try {
      await appendRows('EvidenciasBoleta', successful.map((item) => item.row), {
        chunkSize: Math.min(successful.length, env.ticketEvidenceBatchMaxFiles),
      });
    } catch (error) {
      await Promise.allSettled(successful.map((item) => trashFile(item.file.id)));
      throw error;
    }
  }

  const uploaded = [
    ...skipped,
    ...successful.map(({ input, row }) => ({
      ...row,
      clientKey: input.clientKey,
      skipped: false,
    })),
  ];

  return {
    boletaUid,
    uploaded,
    failed,
    skipped,
    total: inputs.length,
    uploadedCount: uploaded.length,
    failedCount: failed.length,
  };
}

export const ticketScalableEvidenceHandlers = {
  uploadBatch,
};
