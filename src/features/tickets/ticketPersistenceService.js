import { MODULE_ROUTES, pick, requestAvailable } from '../../services/moduleApi';
import { uploadTicketEvidenceItems } from '../../services/ticketEvidenceBatch';
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
  const signatureTask = form.firma?.startsWith('data:image/')
    ? requestAvailable(MODULE_ROUTES.tickets.signatureUpload, {
      boletaUid: uid,
      base64: form.firma.split(',')[1],
      mimeType: 'image/png',
      fileName: `firma_boleta_${uid}.png`,
    }, sessionToken, options)
    : Promise.resolve(null);

  const evidenceTask = evidences?.length
    ? uploadTicketEvidenceItems({
      boletaUid: uid,
      items: evidences,
      sessionToken,
      signal,
    })
    : Promise.resolve({ uploaded: [], failed: [], failedItems: [], total: 0 });

  const online = typeof navigator === 'undefined' || navigator.onLine !== false;
  let evidenceResult;
  if (online) {
    [, evidenceResult] = await Promise.all([signatureTask, evidenceTask]);
  } else {
    await signatureTask;
    evidenceResult = await evidenceTask;
  }

  if (evidenceResult.failed?.length) {
    const error = new Error(`${evidenceResult.failed.length} evidencia(s) no pudieron cargarse. Puede reintentar el guardado sin duplicar las que ya se almacenaron.`);
    error.code = 'TICKET_EVIDENCE_PARTIAL_UPLOAD';
    error.uploadResult = evidenceResult;
    throw error;
  }

  return (evidenceResult.uploaded || []).map((row) => ({
    evidenceId: String(row.EvidenciaID || row.clientKey || ''),
    result: row,
  }));
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
