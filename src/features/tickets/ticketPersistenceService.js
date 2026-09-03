import { MODULE_ROUTES, pick, requestAvailable } from '../../services/moduleApi';
import { binaryUploadRequest, canUseBinaryUpload, isBinaryUploadUnavailable } from '../../services/binaryUploadApi';
import { shouldUseLargeEvidenceUpload, uploadLargeTicketEvidence } from '../../services/largeEvidenceUpload';
import { mapWithConcurrency } from '../../utils/asyncPool';
import { fileToBase64 } from '../../utils/fileEncoding';
import { createLocalId } from '../../utils/localId';
import { buildTicketPayload, ticketRecordData } from './ticketFormDomain';

const EVIDENCE_UPLOAD_CONCURRENCY = 3;

function requestOptions(signal) {
  return signal ? { signal } : {};
}

function evidencePayload(uid, evidenceId, item) {
  return {
    boletaUid: uid,
    evidenciaId: evidenceId,
    EvidenciaID: evidenceId,
    nombre: item.name || item.file.name,
    nota: item.note,
    fileName: item.file.name,
    mimeType: item.mimeType,
    mediaType: item.mediaType,
    durationSeconds: Number(item.durationSeconds || 0),
    size: Number(item.size || item.file.size || 0),
  };
}

async function uploadRegularEvidence({ uid, evidenceId, item, sessionToken, signal, binary }) {
  const payload = evidencePayload(uid, evidenceId, item);
  if (binary) {
    return binaryUploadRequest(
      MODULE_ROUTES.tickets.evidenceUpload[0],
      payload,
      item.file,
      sessionToken,
      requestOptions(signal),
    );
  }

  let base64 = await fileToBase64(item.file, { signal });
  try {
    return await requestAvailable(
      MODULE_ROUTES.tickets.evidenceUpload,
      { ...payload, base64 },
      sessionToken,
      requestOptions(signal),
    );
  } finally {
    base64 = '';
  }
}

async function uploadEvidenceEntry({ uid, entry, sessionToken, signal, binary }) {
  const { item, evidenceId } = entry;
  const result = shouldUseLargeEvidenceUpload(item)
    ? await uploadLargeTicketEvidence({
      boletaUid: uid,
      evidenceId,
      item,
      sessionToken,
      signal,
    })
    : await uploadRegularEvidence({ uid, evidenceId, item, sessionToken, signal, binary });
  return { evidenceId, result };
}

export async function autosaveTicket({ form, boletaUid, sessionToken, signal }) {
  return requestAvailable(
    MODULE_ROUTES.tickets.autosave,
    buildTicketPayload(form, boletaUid),
    sessionToken,
    requestOptions(signal),
  );
}

export async function uploadTicketAssets({ uid, form, evidences, sessionToken, signal }) {
  const options = requestOptions(signal);
  if (form.firma?.startsWith('data:image/')) {
    await requestAvailable(MODULE_ROUTES.tickets.signatureUpload, {
      boletaUid: uid,
      base64: form.firma.split(',')[1],
      mimeType: 'image/png',
      fileName: `firma_boleta_${uid}.png`,
    }, sessionToken, options);
  }

  const entries = evidences.map((item) => ({
    item,
    evidenceId: String(item.localId || createLocalId('evidencia')),
  }));
  if (!entries.length) return [];

  let binary = canUseBinaryUpload();
  const uploadedById = new Map();

  // Confirma el endpoint con una única evidencia normal antes de paralelizar.
  // Si el backend todavía no soporta binario, se conserva el flujo Base64
  // secuencial para no multiplicar memoria ni cambiar compatibilidad offline.
  if (binary) {
    const probe = entries.find((entry) => !shouldUseLargeEvidenceUpload(entry.item));
    if (probe) {
      try {
        const uploaded = await uploadEvidenceEntry({ uid, entry: probe, sessionToken, signal, binary: true });
        uploadedById.set(probe.evidenceId, uploaded);
      } catch (error) {
        if (!isBinaryUploadUnavailable(error)) throw error;
        binary = false;
      }
    }
  }

  const pending = entries.filter((entry) => !uploadedById.has(entry.evidenceId));
  if (binary) {
    const results = await mapWithConcurrency(
      pending,
      EVIDENCE_UPLOAD_CONCURRENCY,
      (entry) => uploadEvidenceEntry({ uid, entry, sessionToken, signal, binary: true }),
      { signal },
    );
    results.forEach((result) => uploadedById.set(result.evidenceId, result));
  } else {
    for (const entry of pending) {
      const result = await uploadEvidenceEntry({ uid, entry, sessionToken, signal, binary: false });
      uploadedById.set(result.evidenceId, result);
    }
  }

  return entries.map((entry) => uploadedById.get(entry.evidenceId));
}

export async function saveTicketBase({
  editing,
  boletaUid,
  form,
  evidences,
  sessionToken,
  signal,
  actionType = '',
}) {
  const payload = buildTicketPayload(form, boletaUid);
  if (!editing && (form.agendaId || form.AgendaID)) {
    payload.workflowAction = String(actionType || 'save').trim().toLowerCase();
  }

  const result = await requestAvailable(
    editing ? MODULE_ROUTES.tickets.update : MODULE_ROUTES.tickets.create,
    payload,
    sessionToken,
    requestOptions(signal),
  );
  const uid = pick(ticketRecordData(result), ['BoletaUID', 'boletaUid', 'TicketUID', 'id'], boletaUid);
  if (!uid) throw new Error('El backend no devolvió BoletaUID.');
  await uploadTicketAssets({ uid, form, evidences, sessionToken, signal });
  return uid;
}

export async function runTicketPostSaveAction({ type, uid, form, sessionToken, signal }) {
  const options = requestOptions(signal);
  if (type === 'finalize') {
    return requestAvailable(MODULE_ROUTES.tickets.finalize, {
      boletaUid: uid,
      sendClientCopy: form.enviarCorreoCliente,
      cc: form.correosCC,
    }, sessionToken, options);
  }
  if (type === 'test') {
    return requestAvailable(MODULE_ROUTES.tickets.testFinalize, {
      boletaUid: uid,
      testMode: true,
    }, sessionToken, options);
  }
  if (type === 'pdf') {
    return requestAvailable(MODULE_ROUTES.tickets.generatePdf, { boletaUid: uid }, sessionToken, options);
  }
  return null;
}
