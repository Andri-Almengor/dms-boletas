import { MODULE_ROUTES, pick, requestAvailable } from '../../services/moduleApi';
import { shouldUseLargeEvidenceUpload, uploadLargeTicketEvidence } from '../../services/largeEvidenceUpload';
import { fileToBase64 } from '../../utils/fileEncoding';
import { createLocalId } from '../../utils/localId';
import { buildTicketPayload, ticketRecordData } from './ticketFormDomain';

function requestOptions(signal) {
  return signal ? { signal } : {};
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

  const uploaded = [];
  for (const item of evidences) {
    const evidenceId = String(item.localId || createLocalId('evidencia'));
    if (shouldUseLargeEvidenceUpload(item)) {
      const result = await uploadLargeTicketEvidence({
        boletaUid: uid,
        evidenceId,
        item,
        sessionToken,
        signal,
      });
      uploaded.push({ evidenceId, result });
      continue;
    }

    let base64 = await fileToBase64(item.file, { signal });
    try {
      const result = await requestAvailable(MODULE_ROUTES.tickets.evidenceUpload, {
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
        base64,
      }, sessionToken, options);
      uploaded.push({ evidenceId, result });
    } finally {
      base64 = '';
    }
  }
  return uploaded;
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
