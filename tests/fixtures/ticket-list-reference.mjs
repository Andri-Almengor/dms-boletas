// Frozen behavior from PR #306 head 8bcaacc, independent reference.
function filterRows(rows, payload = {}, searchFields = []) {
  const search = String(payload.search || payload.q || '').trim().toLowerCase();
  const active = payload.activo === undefined ? null : String(payload.activo).toLowerCase();
  const state = payload.estado ? String(payload.estado).toUpperCase() : '';
  const client = payload.clienteId ? String(payload.clienteId) : '';
  const page = Math.max(1, Number(payload.page || 1));
  const pageSize = Math.min(1000, Math.max(1, Number(payload.pageSize || 100)));
  // Match Array.slice's integer conversion, including historical fractional/NaN inputs.
  const start = Math.trunc((page - 1) * pageSize) || 0;
  const end = Math.trunc(page * pageSize) || 0;
  const result = [];
  let total = 0;
  for (const row of rows) {
    if (active !== null && String(row.Activo).toLowerCase() !== active) continue;
    if (payload.estado && String(row.Estado || '').toUpperCase() !== state) continue;
    if (payload.clienteId && String(row.ClienteID || row.ClienteRef || '') !== client) continue;
    if (search && !searchFields.some((field) => String(row[field] || '').toLowerCase().includes(search))) continue;
    if (payload.sortBy || (total >= start && total < end)) result.push(row);
    total += 1;
  }
  let items = result;
  if (payload.sortBy) {
    const direction = String(payload.sortDir).toLowerCase() === 'desc' ? -1 : 1;
    result.sort((a, b) => String(a[payload.sortBy] || '').localeCompare(String(b[payload.sortBy] || ''), 'es') * direction);
    items = result.slice(start, end);
  }
  return { items: items.map(({ __rowNumber, ...row }) => row), total, page, pageSize };
}

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

function assignedTicketIds(assignments, selectedUserId) {
  const selected = String(selectedUserId || '').trim();
  if (!selected) return new Set();
  return new Set(
    assignments
      .filter((row) => isActive(row) && String(row.UsuarioID || '').trim() === selected)
      .map((row) => String(row.BoletaUID || '').trim())
      .filter(Boolean),
  );
}

function technicianIsAssigned(ticket, assignedIds) {
  return assignedIds.has(String(ticket.BoletaUID || '').trim());
}

function ticketDateKey(row) {
  return String(row.Fecha || row.FechaCreacion || '').slice(0, 10);
}

function ticketNumber(row) {
  const value = Number(row.BoletaID);
  return Number.isFinite(value) ? value : 0;
}

function ticketCreatedAt(row) {
  const value = Date.parse(row.FechaCreacion || row.FechaActualizacion || '');
  return Number.isNaN(value) ? 0 : value;
}

function sortNewestFirst(rows) {
  return [...rows].sort((left, right) => {
    const byDate = ticketDateKey(right).localeCompare(ticketDateKey(left));
    if (byDate) return byDate;
    const byNumber = ticketNumber(right) - ticketNumber(left);
    if (byNumber) return byNumber;
    return ticketCreatedAt(right) - ticketCreatedAt(left);
  });
}

function applyFieldFilters(rows, payload) {
  const filters = [
    ['clienteId', 'ClienteID'],
    ['categoriaId', 'CategoriaID'],
    ['tipoDispositivoId', 'TipoDispositivoID'],
    ['fabricanteId', 'FabricanteID'],
    ['modeloId', 'ModeloID'],
  ];
  return filters.reduce((result, [payloadKey, rowKey]) => {
    const expected = String(payload[payloadKey] || '').trim();
    if (!expected) return result;
    return result.filter((row) => String(row[rowKey] || '').trim() === expected);
  }, rows);
}

export function referenceTicketList(tables, ctx) {
 const { payload } = ctx;
    const requestedStatus = normalizeStatus(payload.status || payload.estado);
    const admin = ctx.admin;
    let rows = tables.Boletas.filter((row) => isActive(row) && normalizeStatus(row.Estado) !== 'ANULADA');

    if (requestedStatus) rows = rows.filter((row) => normalizeStatus(row.Estado) === requestedStatus);

    if (admin) {
      const selectedTechnician = String(payload.asignadoUsuarioId || '').trim();
      if (selectedTechnician) {
        const selectedIds = assignedTicketIds(tables.BoletaAsignados, selectedTechnician);
        rows = rows.filter((row) => technicianIsAssigned(row, selectedIds));
      }
    } else {
      const assignedIds = assignedTicketIds(tables.BoletaAsignados, String(ctx.user?.UsuarioID || '').trim());
      rows = rows.filter((row) => technicianIsAssigned(row, assignedIds));
    }

    if (payload.dateFrom) rows = rows.filter((row) => String(row.Fecha || '').slice(0, 10) >= String(payload.dateFrom));
    if (payload.dateTo) rows = rows.filter((row) => String(row.Fecha || '').slice(0, 10) <= String(payload.dateTo));
    rows = sortNewestFirst(applyFieldFilters(rows, payload));

    return filterRows(rows, {
      ...payload,
      estado: undefined,
      status: undefined,
      sortBy: undefined,
      sortDir: undefined,
      asignadoUsuarioId: undefined,
    }, ['Titulo', 'Cliente', 'Ubicacion', 'Categoria', 'TipoDispositivo', 'Fabricante', 'Modelo', 'BoletaID']);
}
