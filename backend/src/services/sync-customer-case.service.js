import { readTable } from '../infra/sheets.repository.js';
import {
  customerCaseView,
  normalizeCustomerCaseState,
} from './customer-case-query.service.js';

function clean(value) {
  return String(value ?? '').trim();
}

function active(row = {}) {
  return row.Activo !== false;
}

function buildCounts(rows = []) {
  const counts = { EN_ESPERA: 0, EN_PROCESO: 0, FINALIZADO: 0, TOTAL: 0 };
  for (const row of rows) {
    if (!active(row)) continue;
    const state = normalizeCustomerCaseState(row.Estado);
    counts.TOTAL += 1;
    counts[state] = Number(counts[state] || 0) + 1;
  }
  return counts;
}

export async function materializeCustomerCaseDelta(_ctx, events = []) {
  const rows = await readTable('CasosClientes');
  const byId = new Map(rows.map((row) => [clean(row.CasoID), row]).filter(([id]) => Boolean(id)));
  const upserts = [];
  const removed = [];

  for (const event of events) {
    const id = clean(event.EntityID);
    if (!id) continue;
    const row = byId.get(id);
    const deleted = String(event.Operation || '').toUpperCase() === 'DELETE';
    if (deleted || !row || !active(row)) {
      removed.push(id);
      continue;
    }
    upserts.push(customerCaseView(row));
  }

  return {
    upserts,
    removed,
    invalidated: [],
    counts: buildCounts(rows),
  };
}
