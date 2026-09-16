import { boundedSelection } from '../core/bounded-selection.js';

function normalizeStatus(value) {
  const text = String(value || '').trim().toUpperCase();
  if (text.includes('FINAL')) return 'FINALIZADA';
  if (text.includes('PEND')) return 'PENDIENTE';
  if (text.includes('ANUL')) return 'ANULADA';
  return text;
}
function isActive(row) {
  return row?.Activo !== false && String(row?.Activo ?? 'true').toLowerCase() !== 'false';
}
function ticketDateKey(row) { return String(row.Fecha || row.FechaCreacion || '').slice(0, 10); }
function ticketNumber(row) { const value = Number(row.BoletaID); return Number.isFinite(value) ? value : 0; }
function ticketCreatedAt(row) { const value = Date.parse(row.FechaCreacion || row.FechaActualizacion || ''); return Number.isNaN(value) ? 0 : value; }
function compare(left, right) {
  return ticketDateKey(right.row).localeCompare(ticketDateKey(left.row))
    || ticketNumber(right.row) - ticketNumber(left.row)
    || ticketCreatedAt(right.row) - ticketCreatedAt(left.row)
    || left.index - right.index;
}
const FIELDS = [['clienteId', 'ClienteID'], ['categoriaId', 'CategoriaID'], ['tipoDispositivoId', 'TipoDispositivoID'], ['fabricanteId', 'FabricanteID'], ['modeloId', 'ModeloID']];
const SEARCH = ['Titulo', 'Cliente', 'Ubicacion', 'Categoria', 'TipoDispositivo', 'Fabricante', 'Modelo', 'BoletaID'];

// allowedIds comes from the existing authorization policy, never from payload.
export function selectTicketPage(rows, payload = {}, allowedIds = null) {
  const page = Math.max(1, Number(payload.page || 1));
  const pageSize = Math.min(1000, Math.max(1, Number(payload.pageSize || 100)));
  const start = Math.trunc((page - 1) * pageSize) || 0;
  const end = Math.trunc(page * pageSize) || 0;
  const selection = boundedSelection(start < end ? Math.min(end, rows.length) : 0, compare);
  const requestedStatus = normalizeStatus(payload.status || payload.estado);
  const fields = FIELDS.map(([key, field]) => [field, String(payload[key] || '').trim()]).filter(([, value]) => value);
  const search = String(payload.search || payload.q || '').trim().toLowerCase();
  const active = payload.activo === undefined ? null : String(payload.activo).toLowerCase();
  const dateFrom = payload.dateFrom ? String(payload.dateFrom) : '';
  const dateTo = payload.dateTo ? String(payload.dateTo) : '';
  const homeSummary = { pending: 0, finished: 0 };
  let total = 0;
  let index = 0;
  for (const row of rows) {
    const position = index++;
    if (!isActive(row)) continue;
    const status = normalizeStatus(row.Estado);
    if (status === 'ANULADA') continue;
    if (allowedIds && !allowedIds.has(String(row.BoletaUID || '').trim())) continue;
    if (dateFrom && String(row.Fecha || '').slice(0, 10) < dateFrom) continue;
    if (dateTo && String(row.Fecha || '').slice(0, 10) > dateTo) continue;
    if (fields.some(([field, expected]) => String(row[field] || '').trim() !== expected)) continue;
    // Keep filterRows' additional untrimmed client/active semantics exactly.
    if (payload.clienteId && String(row.ClienteID || row.ClienteRef || '') !== String(payload.clienteId)) continue;
    if (active !== null && String(row.Activo).toLowerCase() !== active) continue;
    if (search && !SEARCH.some(field => String(row[field] || '').toLowerCase().includes(search))) continue;
    if (payload.homeSummary) {
      if (status === 'PENDIENTE') homeSummary.pending++;
      else if (status === 'FINALIZADA') homeSummary.finished++;
    }
    if (requestedStatus && status !== requestedStatus) continue;
    total++;
    selection.add({ row, index: position });
  }
  const items = selection.sorted().slice(start, end).map(({ row: { __rowNumber, ...row } }) => row);
  const result = { items, total, page, pageSize };
  return payload.homeSummary ? { ...result, homeSummary } : result;
}
