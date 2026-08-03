import { nowIso } from '../core/utils.js';
import { readTables, updateRow, updateRows } from '../infra/sheets.repository.js';
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
  const { CasosClientes: cases, Boletas: tickets } = await readTables(['CasosClientes', 'Boletas'], { force: true });
  const ticket = tickets.find((row) => clean(row.BoletaUID) === id);
  const originCaseId = clean(ticket?.OrigenCasoID);
  const match = cases.find((row) => activeCase(row) && (
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
  const { CasosClientes: cases, Boletas: tickets } = await readTables(['CasosClientes', 'Boletas'], { force: true });
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
