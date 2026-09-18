import { nowIso } from '../core/utils.js';
import {
  findById,
  findRows,
  queryCustomerCaseReconciliationCandidates,
  updateRow,
  updateRows,
} from '../infra/sheets.repository.js';
import { ensureCustomerCaseSchema } from './customer-case-schema.service.js';

function clean(value) {
  return String(value ?? '').trim();
}

function finalized(value) {
  return clean(value).toUpperCase().includes('FINAL');
}

function activeCase(row) {
  return row?.Activo !== false && clean(row?.Estado).toUpperCase() !== 'INACTIVO';
}

export async function finalizeCustomerCaseForTicket(ticketId, actor = 'SISTEMA') {
  const id = clean(ticketId);
  if (!id) return null;
  await ensureCustomerCaseSchema();

  // Preserve the old source-order match (first matching case) while narrowing
  // both lookups to the affected ticket/case instead of reading both tables.
  const ticket = await findById('Boletas', id).catch(() => null);
  const originCaseId = clean(ticket?.OrigenCasoID);
  const [directMatches, originMatches] = await Promise.all([
    findRows('CasosClientes', { BoletaUID: id }, { limit: 50_000 }),
    originCaseId
      ? findRows('CasosClientes', { CasoID: originCaseId }, { limit: 50_000 })
      : Promise.resolve([]),
  ]);
  const matches = [...directMatches, ...originMatches]
    .sort((left, right) => Number(left?.__rowNumber || 0) - Number(right?.__rowNumber || 0));
  const match = matches.find((row) => activeCase(row) && (
    clean(row.BoletaUID) === id
    || (originCaseId && clean(row.CasoID) === originCaseId)
  ));
  if (!match || clean(match.Estado).toUpperCase() === 'FINALIZADO') return match || null;
  return updateRow('CasosClientes', match.CasoID, {
    Estado: 'FINALIZADO',
    FechaFinalizacion: nowIso(),
    FechaActualizacion: nowIso(),
    ActualizadoPor: actor,
  });
}

export async function reconcileCustomerCases(actor = 'SISTEMA') {
  await ensureCustomerCaseSchema();
  const { cases, tickets } = await queryCustomerCaseReconciliationCandidates();
  if (!cases.length || !tickets.length) return 0;

  // The query helper returns both collections in historical source order.
  // Keeping the same Map/loop mechanics preserves the previous duplicate and
  // "last ticket by BoletaUID" behavior while eliminating global table reads.
  const ticketById = new Map(tickets.map((ticket) => [clean(ticket.BoletaUID), ticket]));
  const caseByOrigin = new Map(cases.map((item) => [clean(item.CasoID), item]));
  const updates = [];

  for (const item of cases) {
    if (!activeCase(item) || clean(item.Estado).toUpperCase() !== 'EN_PROCESO') continue;
    const ticket = ticketById.get(clean(item.BoletaUID));
    if (ticket && finalized(ticket.Estado)) {
      updates.push({
        idValue: item.CasoID,
        patch: {
          Estado: 'FINALIZADO',
          FechaFinalizacion: clean(ticket.FinalizadaEn) || nowIso(),
          FechaActualizacion: nowIso(),
          ActualizadoPor: actor,
        },
      });
    }
  }

  for (const ticket of tickets) {
    const originCaseId = clean(ticket.OrigenCasoID);
    if (!originCaseId || !finalized(ticket.Estado)) continue;
    const item = caseByOrigin.get(originCaseId);
    if (!item || clean(item.Estado).toUpperCase() === 'FINALIZADO') continue;
    if (!updates.some((update) => clean(update.idValue) === originCaseId)) {
      updates.push({
        idValue: originCaseId,
        patch: {
          Estado: 'FINALIZADO',
          BoletaUID: clean(item.BoletaUID || ticket.BoletaUID),
          BoletaID: clean(item.BoletaID || ticket.BoletaID),
          FechaFinalizacion: clean(ticket.FinalizadaEn) || nowIso(),
          FechaActualizacion: nowIso(),
          ActualizadoPor: actor,
        },
      });
    }
  }

  if (updates.length) await updateRows('CasosClientes', updates);
  return updates.length;
}
