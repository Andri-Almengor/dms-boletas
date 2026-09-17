import { nowIso } from '../core/utils.js';
import { readTable, updateRow } from '../infra/sheets.repository.js';
import {
  ensureSignatureRequestForTicket,
  ensureSignatureStorage,
  signatureRequestView,
} from './ticket-signature-request.service.js';
import {
  ensureVisitGroupForTicket,
  ticketHasStoredSignature,
  updateVisitGroup,
} from './ticket-visit-group.service.js';

const SIGNATURE_REQUESTS_SHEET = 'FirmaSolicitudes';
const LINK_TTL_MS = 90 * 24 * 60 * 60 * 1000;

function clean(value) {
  return String(value ?? '').trim();
}

function requestState(row = {}) {
  return clean(row.Estado).toUpperCase();
}

function requestTimestamp(row = {}) {
  return clean(row.FechaFirma || row.FechaActualizacion || row.FechaCreacion);
}

function reusableRequest(rows = [], rootId = '') {
  const candidates = rows
    .filter((row) => clean(row.BoletaUID) === clean(rootId) && clean(row.Token) && clean(row.FirmaURLPublica))
    .sort((left, right) => requestTimestamp(right).localeCompare(requestTimestamp(left)));
  return candidates.find((row) => requestState(row) === 'FIRMADA') || candidates[0] || null;
}

export async function resetTicketSignatureForReuse({ ticketId, origin = '', actor = 'SISTEMA' }) {
  const group = await ensureVisitGroupForTicket(ticketId, actor);
  const hadSignature = group.visits.some(ticketHasStoredSignature);
  const timestamp = nowIso();

  const clearedGroup = await updateVisitGroup(group.rootId, (visit) => ({
    FirmaArchivoID: '',
    FirmaFileID: '',
    FirmaURL: '',
    FirmaMimeType: '',
    FirmaOrigen: '',
    FirmaFecha: '',
    EstadoEntregaFirma: '',
    UltimoErrorEntregaFirma: '',
    FirmaReenviadaEn: '',
    Version: Number(visit.Version || 0) + 1,
  }), actor);

  await ensureSignatureStorage();
  const rows = await readTable(SIGNATURE_REQUESTS_SHEET, { force: true });
  const previous = reusableRequest(rows, clearedGroup.rootId);

  if (previous) {
    const updated = await updateRow(SIGNATURE_REQUESTS_SHEET, previous.SolicitudFirmaID, {
      Estado: 'PENDIENTE',
      FirmaArchivoID: '',
      FirmaURL: '',
      FechaFirma: '',
      FechaExpiracion: new Date(Date.now() + LINK_TTL_MS).toISOString(),
      EstadoEntrega: '',
      ErrorEntrega: '',
      PDFURLFirmado: '',
      ActualizadoPor: actor,
      FechaActualizacion: timestamp,
    });
    return {
      group: clearedGroup,
      request: signatureRequestView(updated),
      hadSignature,
      reusedLink: true,
    };
  }

  const created = await ensureSignatureRequestForTicket({
    ticketId: clearedGroup.rootId,
    origin,
    actor,
  });
  return {
    group: clearedGroup,
    request: created,
    hadSignature,
    reusedLink: false,
  };
}
