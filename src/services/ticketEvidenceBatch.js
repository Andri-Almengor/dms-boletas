import { apiRequest } from '../api';
import { fileToBase64, mapFilesSequentially } from '../utils/fileEncoding';
import { createLocalId } from '../utils/localId';
import {
  shouldUseLargeEvidenceUpload,
  uploadLargeTicketEvidence,
} from './largeEvidenceUpload';
import { MODULE_ROUTES, requestAvailable } from './moduleApi';
import { isAbortError, isNetworkError } from './requestErrors';

const BATCH_ROUTES = ['boletas.evidence.uploadBatch', 'tickets.evidence.uploadBatch'];
const MAX_FILES_PER_REQUEST = 10;
const MAX_RAW_BYTES_PER_REQUEST = 10 * 1024 * 1024;
export const TICKET_BATCH_RESUMABLE_THRESHOLD_BYTES = 10 * 1024 * 1024;

let batchAvailable = null;

function clean(value) {
  return String(value ?? '').trim();
}

function requestOptions(signal) {
  return signal ? { signal } : {};
}

function browserIsOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function missingRoute(error) {
  const text = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
  return text.includes('route_not_found') || text.includes('ruta no encontrada') || text.includes('unknown action');
}

function ensureEvidenceId(item = {}) {
  const existing = clean(item.evidenceId || item.evidenciaId || item.localId);
  if (existing) return existing;
  const generated = createLocalId('evidencia');
  item.localId = generated;
  return generated;
}

function chunkByWeight(items = []) {
  const chunks = [];
  let current = [];
  let bytes = 0;

  for (const item of items) {
    const size = Math.max(0, Number(item?.size || item?.file?.size || 0));
    const mustStartNew = current.length > 0
      && (current.length >= MAX_FILES_PER_REQUEST || bytes + size > MAX_RAW_BYTES_PER_REQUEST);
    if (mustStartNew) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(item);
    bytes += size;
  }

  if (current.length) chunks.push(current);
  return chunks;
}

async function requestOnlineAliases(routes, payload, sessionToken, signal) {
  let lastError;
  for (const route of routes) {
    try {
      return await apiRequest(route, payload, sessionToken, requestOptions(signal));
    } catch (error) {
      lastError = error;
      if (isAbortError(error) || !missingRoute(error)) throw error;
    }
  }
  throw lastError || new Error('La carga por lote no está disponible.');
}

function payloadFor(item, base64) {
  const evidenceId = ensureEvidenceId(item);
  const file = item.file;
  return {
    clientKey: evidenceId,
    localId: evidenceId,
    evidenceId,
    evidenciaId: evidenceId,
    EvidenciaID: evidenceId,
    nombre: item.name || file.name,
    nota: item.note || '',
    fileName: file.name,
    mimeType: item.mimeType || file.type || 'application/octet-stream',
    mediaType: item.mediaType,
    durationSeconds: Number(item.durationSeconds || 0),
    size: Number(item.size || file.size || 0),
    base64,
  };
}

async function prepareChunk(items, signal) {
  return mapFilesSequentially(items, async (item) => payloadFor(
    item,
    await fileToBase64(item.file, { signal }),
  ), { signal });
}

function clearPayloads(items = []) {
  for (const item of items) item.base64 = '';
  items.length = 0;
}

async function uploadOne({
  boletaUid,
  item,
  preparedBase64 = '',
  sessionToken,
  signal,
}) {
  const evidenceId = ensureEvidenceId(item);
  if (shouldUseLargeEvidenceUpload(item)) {
    return uploadLargeTicketEvidence({
      boletaUid,
      evidenceId,
      item,
      sessionToken,
      signal,
    });
  }

  let base64 = preparedBase64;
  try {
    if (!base64) base64 = await fileToBase64(item.file, { signal });
    return await requestAvailable(MODULE_ROUTES.tickets.evidenceUpload, {
      boletaUid,
      evidenciaId: evidenceId,
      EvidenciaID: evidenceId,
      nombre: item.name || item.file.name,
      nota: item.note || '',
      fileName: item.file.name,
      mimeType: item.mimeType || item.file.type,
      mediaType: item.mediaType,
      durationSeconds: Number(item.durationSeconds || 0),
      size: Number(item.size || item.file.size || 0),
      base64,
    }, sessionToken, requestOptions(signal));
  } finally {
    base64 = '';
  }
}

async function uploadFallback({
  boletaUid,
  items,
  prepared = [],
  sessionToken,
  signal,
  onUploaded,
  onProgress,
  progressState,
}) {
  const uploaded = [];
  const failed = [];
  const preparedByKey = new Map(prepared.map((item) => [clean(item.clientKey), item]));

  for (const item of items) {
    const evidenceId = ensureEvidenceId(item);
    const payload = preparedByKey.get(evidenceId);
    try {
      const row = await uploadOne({
        boletaUid,
        item,
        preparedBase64: payload?.base64 || '',
        sessionToken,
        signal,
      });
      const normalized = { ...row, clientKey: evidenceId };
      uploaded.push(normalized);
      onUploaded?.(normalized, item);
    } catch (error) {
      if (isAbortError(error)) throw error;
      failed.push({
        clientKey: evidenceId,
        fileName: item.file?.name,
        message: error.message || 'No se pudo cargar la evidencia.',
      });
    } finally {
      if (payload) payload.base64 = '';
      progressState.completed += 1;
      onProgress?.({
        completed: progressState.completed,
        total: progressState.total,
        failed: progressState.failed + failed.length,
      });
    }
  }

  progressState.failed += failed.length;
  return { uploaded, failed };
}

export async function uploadTicketEvidenceItems({
  boletaUid,
  items = [],
  sessionToken,
  signal,
  onUploaded,
  onProgress,
}) {
  const source = items.filter((item) => item?.file);
  source.forEach(ensureEvidenceId);

  const uploaded = [];
  const failed = [];
  const progressState = { completed: 0, failed: 0, total: source.length };

  const resumable = source.filter((item) => shouldUseLargeEvidenceUpload(item, {
    thresholdBytes: TICKET_BATCH_RESUMABLE_THRESHOLD_BYTES,
  }));
  const regular = source.filter((item) => !shouldUseLargeEvidenceUpload(item, {
    thresholdBytes: TICKET_BATCH_RESUMABLE_THRESHOLD_BYTES,
  }));

  let useFallbackForRemaining = batchAvailable === false || browserIsOffline();

  for (const chunk of chunkByWeight(regular)) {
    if (useFallbackForRemaining) {
      const fallback = await uploadFallback({
        boletaUid,
        items: chunk,
        sessionToken,
        signal,
        onUploaded,
        onProgress,
        progressState,
      });
      uploaded.push(...fallback.uploaded);
      failed.push(...fallback.failed);
      continue;
    }

    const evidences = await prepareChunk(chunk, signal);
    try {
      const result = await requestOnlineAliases(BATCH_ROUTES, {
        boletaUid,
        evidences,
      }, sessionToken, signal);
      batchAvailable = true;

      const rows = Array.isArray(result?.uploaded) ? result.uploaded : [];
      const failures = Array.isArray(result?.failed) ? result.failed : [];
      const byKey = new Map(chunk.map((item) => [ensureEvidenceId(item), item]));

      for (const row of rows) {
        const key = clean(row.clientKey || row.EvidenciaID);
        uploaded.push(row);
        onUploaded?.(row, byKey.get(key));
      }
      failed.push(...failures);
      progressState.completed += chunk.length;
      progressState.failed += failures.length;
      onProgress?.({
        completed: progressState.completed,
        total: progressState.total,
        failed: progressState.failed,
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (!missingRoute(error) && !isNetworkError(error)) throw error;
      if (missingRoute(error)) batchAvailable = false;
      useFallbackForRemaining = true;

      const fallback = await uploadFallback({
        boletaUid,
        items: chunk,
        prepared: evidences,
        sessionToken,
        signal,
        onUploaded,
        onProgress,
        progressState,
      });
      uploaded.push(...fallback.uploaded);
      failed.push(...fallback.failed);
    } finally {
      clearPayloads(evidences);
    }
  }

  for (const item of resumable) {
    const evidenceId = ensureEvidenceId(item);
    try {
      const row = await uploadLargeTicketEvidence({
        boletaUid,
        evidenceId,
        item,
        sessionToken,
        signal,
      });
      const normalized = { ...row, clientKey: evidenceId };
      uploaded.push(normalized);
      onUploaded?.(normalized, item);
    } catch (error) {
      if (isAbortError(error)) throw error;
      failed.push({
        clientKey: evidenceId,
        fileName: item.file?.name,
        message: error.message || 'No se pudo cargar la evidencia.',
      });
      progressState.failed += 1;
    } finally {
      progressState.completed += 1;
      onProgress?.({
        completed: progressState.completed,
        total: progressState.total,
        failed: progressState.failed,
      });
    }
  }

  const failedKeys = new Set(failed.map((item) => clean(item.clientKey)));
  return {
    uploaded,
    failed,
    failedItems: source.filter((item) => failedKeys.has(ensureEvidenceId(item))),
    total: source.length,
  };
}
