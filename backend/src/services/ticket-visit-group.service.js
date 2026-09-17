import { AppError, notFound } from '../core/errors.js';
import { nowIso } from '../core/utils.js';
import {
  ensureColumns,
  findById,
  findRows,
  updateRow,
  updateRows,
} from '../infra/sheets.repository.js';

const TABLE = 'Boletas';
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

export async function ensureTicketVisitColumns() {
  if (ensured) return;
  if (ensurePromise) return ensurePromise;
  ensurePromise = ensureColumns(TABLE, GROUP_HEADERS)
    .then(() => { ensured = true; })
    .catch((error) => { ensured = false; throw error; })
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
  const updated = await updateRow(TABLE, ticketId, patch);
  return { ...ticket, ...updated, ...patch };
}

async function groupRows(ticket) {
  const groupId = ticketGroupId(ticket);
  const rootId = ticketRootId(ticket);
  const batches = await Promise.all([
    groupId ? findRows(TABLE, { GrupoVisitaID: groupId }, { limit: 5000 }) : Promise.resolve([]),
    rootId ? findRows(TABLE, { BoletaPrincipalUID: rootId }, { limit: 5000 }) : Promise.resolve([]),
    rootId ? findRows(TABLE, { BoletaUID: rootId }, { limit: 2 }) : Promise.resolve([]),
  ]);
  const rows = new Map();
  for (const row of [ticket, ...batches.flat()]) {
    const id = clean(row?.BoletaUID);
    if (id) rows.set(id, row);
  }
  return [...rows.values()];
}

export async function ensureVisitGroupForTicket(ticketId, actor = 'SISTEMA', snapshot = null) {
  await ensureTicketVisitColumns();
  const id = clean(ticketId);
  if (!id) throw notFound('No se indicó la boleta para consultar sus visitas.');
  const lockKey = `group:${id}`;
  if (groupLocks.has(lockKey)) return groupLocks.get(lockKey);

  const operation = (async () => {
    let ticket;
    if (snapshot) {
      // Detail snapshots still preserve their historical contract. Their Boletas
      // source is narrowed by the detail patch; fallback to the indexed lookup.
      const rows = await snapshot.read(TABLE, { force: true });
      ticket = snapshot.locate(rows, id);
    }
    if (!ticket) ticket = await findById(TABLE, id).catch(() => null);
    if (!ticket) throw notFound('No se encontró la boleta solicitada.');
    if (!clean(ticket.GrupoVisitaID) || !clean(ticket.BoletaPrincipalUID)) ticket = await initializeGroup(ticket, actor);
    return groupFromRows(await groupRows(ticket), ticket);
  })().finally(() => groupLocks.delete(lockKey));

  groupLocks.set(lockKey, operation);
  return operation;
}

export async function prepareRelatedVisit(parentTicketId, actor = 'SISTEMA') {
  const group = await ensureVisitGroupForTicket(parentTicketId, actor);
  const parent = group.visits.find((ticket) => clean(ticket.BoletaUID) === clean(parentTicketId));
  if (!parent) throw notFound('No se encontró la boleta solicitada.');
  const nextVisitNumber = group.visits.reduce((maximum, ticket) => Math.max(maximum, ticketVisitNumber(ticket)), 0) + 1;
  return {
    group,
    parent,
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
  const updates = group.visits
    .filter((visit) => clean(visit.FirmaArchivoID || visit.FirmaFileID) !== clean(patch.FirmaArchivoID) || !ticketHasStoredSignature(visit))
    .map((visit) => ({
      idValue: visit.BoletaUID,
      patch: { ...patch, Version: Number(visit.Version || 0) + 1, ActualizadoPor: actor, FechaActualizacion: nowIso() },
    }));
  if (updates.length) await updateRows(TABLE, updates);
  return ensureVisitGroupForTicket(group.rootId, actor);
}

export async function applySignatureToVisitGroup(ticketId, signature, actor = 'SISTEMA') {
  const group = await ensureVisitGroupForTicket(ticketId, actor);
  if (!signature?.fileId && !signature?.url) throw new AppError('SIGNATURE_FILE_MISSING', 'No fue posible identificar el archivo de la firma.', 500);
  const timestamp = signature.signedAt || nowIso();
  await updateRows(TABLE, group.visits.map((visit) => ({
    idValue: visit.BoletaUID,
    patch: {
      FirmaArchivoID: signature.fileId || '',
      FirmaURL: signature.url || '',
      FirmaMimeType: signature.mimeType || 'image/png',
      FirmaOrigen: signature.origin || 'FIRMA_COMPARTIDA_GRUPO',
      FirmaFecha: timestamp,
      Version: Number(visit.Version || 0) + 1,
      ActualizadoPor: actor,
      FechaActualizacion: timestamp,
    },
  })));
  return ensureVisitGroupForTicket(group.rootId, actor);
}

export async function updateVisitGroup(ticketId, patch, actor = 'SISTEMA') {
  const group = await ensureVisitGroupForTicket(ticketId, actor);
  const updated = await updateRows(TABLE, group.visits.map((visit) => ({
    idValue: visit.BoletaUID,
    patch: {
      ...((typeof patch === 'function' ? patch(visit, group) : patch) || {}),
      ActualizadoPor: actor,
      FechaActualizacion: nowIso(),
    },
  })));
  return {
    ...group,
    visits: sortVisits(updated),
    root: updated.find((row) => clean(row.BoletaUID) === group.rootId) || updated[0],
  };
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
