import { env } from '../config/env.js';
import { AppError, notFound } from '../core/errors.js';
import { nowIso } from '../core/utils.js';
import { sheetsApi } from '../infra/google.js';
import {
  findById,
  getHeaders,
  invalidateTableCache,
  readTable,
  updateRow,
} from '../infra/sheets.repository.js';

const SHEET_NAME = 'Boletas';
const GROUP_HEADERS = [
  'GrupoVisitaID',
  'BoletaPrincipalUID',
  'NumeroVisita',
  'EsVisitaPrincipal',
  'FirmaOrigen',
  'FirmaFecha',
  'EstadoEntregaFirma',
  'UltimoErrorEntregaFirma',
  'FirmaReenviadaEn',
];

let ensurePromise = null;
let ensured = false;
const groupLocks = new Map();

function clean(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function quote(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

function columnLetter(index) {
  let result = '';
  let number = index + 1;
  while (number > 0) {
    const remainder = (number - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    number = Math.floor((number - 1) / 26);
  }
  return result;
}

async function ensureHeaders() {
  const range = `${quote(SHEET_NAME)}!1:1`;
  const { data } = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: env.sheetId,
    range,
  });
  const current = (data.values?.[0] || []).map((value) => clean(value)).filter(Boolean);
  const missing = GROUP_HEADERS.filter((header) => !current.includes(header));
  if (!missing.length) return;
  const headers = [...current, ...missing];
  await sheetsApi.spreadsheets.values.update({
    spreadsheetId: env.sheetId,
    range: `${quote(SHEET_NAME)}!A1:${columnLetter(headers.length - 1)}1`,
    valueInputOption: 'RAW',
    requestBody: { values: [headers] },
  });
  invalidateTableCache(SHEET_NAME);
  await getHeaders(SHEET_NAME, true);
}

export async function ensureTicketVisitColumns() {
  if (ensured) return;
  if (ensurePromise) return ensurePromise;
  ensurePromise = ensureHeaders()
    .then(() => { ensured = true; })
    .catch((error) => {
      ensured = false;
      throw error;
    })
    .finally(() => { ensurePromise = null; });
  return ensurePromise;
}

export function ticketGroupId(ticket = {}) {
  return clean(ticket.GrupoVisitaID || ticket.BoletaPrincipalUID || ticket.BoletaUID);
}

export function ticketRootId(ticket = {}) {
  return clean(ticket.BoletaPrincipalUID || ticket.BoletaUID);
}

export function ticketVisitNumber(ticket = {}) {
  const number = Number(ticket.NumeroVisita || 0);
  return Number.isFinite(number) && number > 0 ? number : 1;
}

export function ticketHasStoredSignature(ticket = {}) {
  return Boolean(clean(ticket.FirmaArchivoID || ticket.FirmaFileID || ticket.FirmaURL || ticket.FirmaUrl || ticket.Firma));
}

function sortVisits(visits = []) {
  return [...visits].sort((left, right) => {
    const byVisit = ticketVisitNumber(left) - ticketVisitNumber(right);
    if (byVisit) return byVisit;
    const byDate = clean(left.Fecha).localeCompare(clean(right.Fecha));
    if (byDate) return byDate;
    return Number(left.BoletaID || 0) - Number(right.BoletaID || 0);
  });
}

function groupFromRows(rows, ticket) {
  const groupId = ticketGroupId(ticket);
  const rootId = ticketRootId(ticket);
  const visits = rows.filter((row) => {
    const rowGroup = ticketGroupId(row);
    return rowGroup === groupId
      || clean(row.BoletaUID) === rootId
      || clean(row.BoletaPrincipalUID) === rootId;
  });
  const ordered = sortVisits(visits.length ? visits : [ticket]);
  const root = ordered.find((row) => clean(row.BoletaUID) === rootId) || ordered[0];
  return {
    id: groupId,
    rootId: clean(root.BoletaUID),
    root,
    visits: ordered,
    count: ordered.length,
    signedVisit: ordered.find(ticketHasStoredSignature) || null,
  };
}

async function initializeGroup(ticket, actor = 'SISTEMA') {
  const ticketId = clean(ticket.BoletaUID);
  const patch = {
    GrupoVisitaID: ticketId,
    BoletaPrincipalUID: ticketId,
    NumeroVisita: 1,
    EsVisitaPrincipal: true,
    ActualizadoPor: actor,
    FechaActualizacion: nowIso(),
  };
  const updated = await updateRow(SHEET_NAME, ticketId, patch);
  return { ...ticket, ...updated, ...patch };
}

export async function ensureVisitGroupForTicket(ticketId, actor = 'SISTEMA') {
  await ensureTicketVisitColumns();
  const id = clean(ticketId);
  if (!id) throw notFound('No se indicó la boleta para consultar sus visitas.');

  const lockKey = `group:${id}`;
  if (groupLocks.has(lockKey)) return groupLocks.get(lockKey);

  const operation = (async () => {
    let rows = await readTable(SHEET_NAME, { force: true });
    let ticket = rows.find((row) => clean(row.BoletaUID) === id);
    if (!ticket) throw notFound('No se encontró la boleta solicitada.');
    if (!clean(ticket.GrupoVisitaID) || !clean(ticket.BoletaPrincipalUID)) {
      ticket = await initializeGroup(ticket, actor);
      rows = rows.map((row) => clean(row.BoletaUID) === id ? ticket : row);
    }
    return groupFromRows(rows, ticket);
  })().finally(() => groupLocks.delete(lockKey));

  groupLocks.set(lockKey, operation);
  return operation;
}

export async function prepareRelatedVisit(parentTicketId, actor = 'SISTEMA') {
  const group = await ensureVisitGroupForTicket(parentTicketId, actor);
  const nextVisitNumber = group.visits.reduce(
    (maximum, ticket) => Math.max(maximum, ticketVisitNumber(ticket)),
    0,
  ) + 1;
  return {
    group,
    parent: await findById(SHEET_NAME, parentTicketId),
    groupFields: {
      GrupoVisitaID: group.id,
      BoletaPrincipalUID: group.rootId,
      NumeroVisita: nextVisitNumber,
      EsVisitaPrincipal: false,
    },
  };
}

export async function visitGroupVersionKey(ticketId) {
  const group = await ensureVisitGroupForTicket(ticketId);
  return group.visits
    .map((ticket) => `${clean(ticket.BoletaUID)}:${clean(ticket.Version || ticket.FechaActualizacion || ticket.Fecha || '1')}`)
    .join('|');
}

export async function synchronizeVisitGroupSignature(ticketId, actor = 'SISTEMA') {
  const group = await ensureVisitGroupForTicket(ticketId, actor);
  const signed = group.signedVisit;
  if (!signed) return group;

  const patch = {
    FirmaArchivoID: signed.FirmaArchivoID || signed.FirmaFileID || '',
    FirmaURL: signed.FirmaURL || signed.FirmaUrl || signed.Firma || '',
    FirmaMimeType: signed.FirmaMimeType || 'image/png',
    FirmaOrigen: signed.FirmaOrigen || 'FIRMA_COMPARTIDA_GRUPO',
    FirmaFecha: signed.FirmaFecha || signed.FechaActualizacion || nowIso(),
  };

  for (const visit of group.visits) {
    const sameFile = clean(visit.FirmaArchivoID || visit.FirmaFileID) === clean(patch.FirmaArchivoID);
    if (sameFile && ticketHasStoredSignature(visit)) continue;
    await updateRow(SHEET_NAME, visit.BoletaUID, {
      ...patch,
      Version: Number(visit.Version || 0) + 1,
      ActualizadoPor: actor,
      FechaActualizacion: nowIso(),
    });
  }
  return ensureVisitGroupForTicket(group.rootId, actor);
}

export async function applySignatureToVisitGroup(ticketId, signature, actor = 'SISTEMA') {
  const group = await ensureVisitGroupForTicket(ticketId, actor);
  if (!signature?.fileId && !signature?.url) {
    throw new AppError('SIGNATURE_FILE_MISSING', 'No fue posible identificar el archivo de la firma.', 500);
  }
  const timestamp = signature.signedAt || nowIso();
  for (const visit of group.visits) {
    await updateRow(SHEET_NAME, visit.BoletaUID, {
      FirmaArchivoID: signature.fileId || '',
      FirmaURL: signature.url || '',
      FirmaMimeType: signature.mimeType || 'image/png',
      FirmaOrigen: signature.origin || 'FIRMA_COMPARTIDA_GRUPO',
      FirmaFecha: timestamp,
      Version: Number(visit.Version || 0) + 1,
      ActualizadoPor: actor,
      FechaActualizacion: timestamp,
    });
  }
  return ensureVisitGroupForTicket(group.rootId, actor);
}

export async function updateVisitGroup(ticketId, patch, actor = 'SISTEMA') {
  const group = await ensureVisitGroupForTicket(ticketId, actor);
  const updated = [];
  for (const visit of group.visits) {
    const resolvedPatch = typeof patch === 'function' ? patch(visit, group) : patch;
    updated.push(await updateRow(SHEET_NAME, visit.BoletaUID, {
      ...(resolvedPatch || {}),
      ActualizadoPor: actor,
      FechaActualizacion: nowIso(),
    }));
  }
  return { ...group, visits: sortVisits(updated), root: updated.find((row) => clean(row.BoletaUID) === group.rootId) || updated[0] };
}

export function groupSummary(group) {
  return {
    id: group.id,
    rootId: group.rootId,
    count: group.count,
    signed: Boolean(group.signedVisit),
    visits: group.visits.map((ticket) => ({
      BoletaUID: ticket.BoletaUID,
      BoletaID: ticket.BoletaID,
      GrupoVisitaID: ticketGroupId(ticket),
      BoletaPrincipalUID: ticketRootId(ticket),
      NumeroVisita: ticketVisitNumber(ticket),
      EsVisitaPrincipal: clean(ticket.BoletaUID) === group.rootId,
      Titulo: ticket.Titulo,
      Fecha: ticket.Fecha,
      Estado: ticket.Estado,
      HoraInicio: ticket.HoraInicio,
      HoraFinal: ticket.HoraFinal,
      HorasTotales: ticket.HorasTotales,
      Resultado: ticket.Resultado,
      FirmaArchivoID: ticket.FirmaArchivoID || ticket.FirmaFileID || '',
      FirmaURL: ticket.FirmaURL || ticket.FirmaUrl || ticket.Firma || '',
      OfflinePendiente: Boolean(ticket.OfflinePendiente),
    })),
  };
}
