import { readTables } from '../infra/sheets.repository.js';
import { materializeTicketDeltaFromRows } from '../core/sync-ticket-delta.js';

export async function materializeTicketDelta(ctx = {}, events = []) {
  const tables = await readTables(['Boletas', 'BoletaAsignados']);
  return materializeTicketDeltaFromRows({
    ctx,
    events,
    tickets: tables.Boletas || [],
    assignments: tables.BoletaAsignados || [],
  });
}
