import { AppError, notFound } from '../core/errors.js';
import { nowIso } from '../core/utils.js';
import { readTable, updateRows } from '../infra/sheets.repository.js';
import {
  ensureVisitGroupForTicket,
  synchronizeVisitGroupSignature,
  ticketGroupId,
  ticketHasStoredSignature,
  ticketRootId,
  ticketVisitNumber,
} from './ticket-visit-group.service.js';

const SHEET_NAME = 'Boletas';
const linkLocks = new Map();

function clean(value) {
  return String(value ?? '').trim();
}

function normalizedStatus(value) {
  const text = clean(value).toUpperCase();
  if (text.includes('FINAL')) return 'FINALIZADA';
  if (text.includes('PEND')) return 'PENDIENTE';
  if (text.includes('ANUL')) return 'ANULADA';
  return text;
}

function active(ticket = {}) {
  return ticket.Activo !== false && clean(ticket.Activo || 'true').toLowerCase() !== 'false';
}

function rowsForGroup(rows, ticket) {
  const groupId = ticketGroupId(ticket);
  const rootId = ticketRootId(ticket);
  return rows.filter((row) => (
    ticketGroupId(row) === groupId
    || clean(row.BoletaUID) === rootId
    || clean(row.BoletaPrincipalUID) === rootId
  ));
}

function signatureIdentity(ticket = {}) {
  if (!ticketHasStoredSignature(ticket)) return '';
  return clean(ticket.FirmaArchivoID || ticket.FirmaFileID || ticket.FirmaURL || ticket.FirmaUrl || ticket.Firma);
}

function sortTargets(rows) {
  return [...rows].sort((left, right) => {
    const date = clean(left.Fecha || left.FechaCreacion).localeCompare(clean(right.Fecha || right.FechaCreacion));
    if (date) return date;
    const leftNumber = Number(left.BoletaID || 0);
    const rightNumber = Number(right.BoletaID || 0);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) return leftNumber - rightNumber;
    return clean(left.BoletaUID).localeCompare(clean(right.BoletaUID));
  });
}

export function isManualVisitLinkCandidate({ sourceGroup, candidate, allTickets = [] }) {
  if (!candidate?.BoletaUID || !sourceGroup?.root) return false;
  if (!active(candidate) || normalizedStatus(candidate.Estado) !== 'PENDIENTE') return false;
  if (clean(candidate.ClienteID) !== clean(sourceGroup.root.ClienteID)) return false;
  if (sourceGroup.visits.some((visit) => clean(visit.BoletaUID) === clean(candidate.BoletaUID))) return false;
  return rowsForGroup(allTickets, candidate).length === 1;
}

function validateSourceGroup(group) {
  if (!clean(group.root?.ClienteID)) {
    throw new AppError('VISIT_GROUP_CLIENT_REQUIRED', 'La boleta principal no tiene un cliente válido para relacionar visitas.', 400);
  }
  if (group.visits.some((visit) => !active(visit) || normalizedStatus(visit.Estado) !== 'PENDIENTE')) {
    throw new AppError('VISIT_GROUP_NOT_PENDING', 'Solo se pueden agregar boletas a un seguimiento que se encuentre pendiente.', 409);
  }
}

function validateTarget(rows, sourceGroup, target) {
  if (!target) throw notFound('No se encontró una de las boletas seleccionadas.');
  if (!active(target) || normalizedStatus(target.Estado) !== 'PENDIENTE') {
    throw new AppError('VISIT_LINK_TARGET_NOT_PENDING', `La boleta #${target.BoletaID || target.BoletaUID} ya no está pendiente.`, 409);
  }
  if (clean(target.ClienteID) !== clean(sourceGroup.root.ClienteID)) {
    throw new AppError('VISIT_LINK_CLIENT_MISMATCH', 'Solo se pueden relacionar boletas del mismo cliente.', 400);
  }
  const targetGroup = rowsForGroup(rows, target);
  if (targetGroup.length > 1) {
    throw new AppError('VISIT_LINK_TARGET_ALREADY_GROUPED', `La boleta #${target.BoletaID || target.BoletaUID} ya pertenece a otro seguimiento.`, 409);
  }
}

export async function linkTicketsToVisitGroup({ sourceTicketId, targetTicketIds = [], actor = 'SISTEMA' }) {
  const sourceId = clean(sourceTicketId);
  const uniqueTargetIds = [...new Set((targetTicketIds || []).map(clean).filter(Boolean))].filter((id) => id !== sourceId);
  if (!sourceId) throw new AppError('VISIT_LINK_SOURCE_REQUIRED', 'No se indicó la boleta base del seguimiento.', 400);
  if (!uniqueTargetIds.length) throw new AppError('VISIT_LINK_TARGET_REQUIRED', 'Seleccione al menos una boleta para relacionar.', 400);
  if (uniqueTargetIds.length > 100) throw new AppError('VISIT_LINK_TOO_MANY_TARGETS', 'Seleccione un máximo de 100 boletas por operación.', 400);

  const initialGroup = await ensureVisitGroupForTicket(sourceId, actor);
  const lockKey = clean(initialGroup.rootId || sourceId);
  if (linkLocks.has(lockKey)) return linkLocks.get(lockKey);

  const operation = (async () => {
    const rows = await readTable(SHEET_NAME, { force: true });
    const source = rows.find((row) => clean(row.BoletaUID) === sourceId);
    if (!source) throw notFound('No se encontró la boleta base del seguimiento.');
    const sourceGroupRows = rowsForGroup(rows, source);
    const sourceGroup = {
      ...initialGroup,
      id: ticketGroupId(source),
      rootId: ticketRootId(source),
      root: sourceGroupRows.find((row) => clean(row.BoletaUID) === ticketRootId(source)) || sourceGroupRows[0] || source,
      visits: sourceGroupRows.length ? sourceGroupRows : [source],
    };
    validateSourceGroup(sourceGroup);

    const sourceIds = new Set(sourceGroup.visits.map((visit) => clean(visit.BoletaUID)));
    const targets = [];
    for (const targetId of uniqueTargetIds) {
      if (sourceIds.has(targetId)) continue;
      const target = rows.find((row) => clean(row.BoletaUID) === targetId);
      validateTarget(rows, sourceGroup, target);
      targets.push(target);
    }

    if (!targets.length) {
      return { group: await ensureVisitGroupForTicket(sourceGroup.rootId, actor), linkedIds: [] };
    }

    const signatureIds = new Set(
      [...sourceGroup.visits, ...targets]
        .map(signatureIdentity)
        .filter(Boolean),
    );
    if (signatureIds.size > 1) {
      throw new AppError(
        'VISIT_LINK_SIGNATURE_CONFLICT',
        'Las boletas seleccionadas contienen firmas diferentes. Revise las firmas antes de relacionarlas para evitar reemplazar una firma existente.',
        409,
      );
    }

    const orderedTargets = sortTargets(targets);
    let nextVisitNumber = sourceGroup.visits.reduce(
      (maximum, visit) => Math.max(maximum, ticketVisitNumber(visit)),
      0,
    ) + 1;
    const timestamp = nowIso();
    const updates = orderedTargets.map((target) => ({
      idValue: target.BoletaUID,
      patch: {
        GrupoVisitaID: sourceGroup.id,
        BoletaPrincipalUID: sourceGroup.rootId,
        NumeroVisita: nextVisitNumber++,
        EsVisitaPrincipal: false,
        Version: Number(target.Version || 0) + 1,
        ActualizadoPor: actor,
        FechaActualizacion: timestamp,
      },
    }));

    const root = sourceGroup.root;
    updates.push({
      idValue: root.BoletaUID,
      patch: {
        Version: Number(root.Version || 0) + 1,
        ActualizadoPor: actor,
        FechaActualizacion: timestamp,
      },
    });

    await updateRows(SHEET_NAME, updates);
    const group = await synchronizeVisitGroupSignature(sourceGroup.rootId, actor);
    return { group, linkedIds: orderedTargets.map((target) => clean(target.BoletaUID)) };
  })().finally(() => linkLocks.delete(lockKey));

  linkLocks.set(lockKey, operation);
  return operation;
}
