function clean(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function normalized(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sameText(left, right) {
  return normalized(left) === normalized(right);
}

function active(row = {}) {
  return row.Activo !== false
    && String(row.Activo ?? 'true').toLowerCase() !== 'false'
    && normalized(row.Estado || 'ACTIVO') !== 'inactivo';
}

function dateOnly(value) {
  const text = clean(value);
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text.slice(0, 10) : parsed.toISOString().slice(0, 10);
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function uniqueSorted(values) {
  return [...new Set(values.map((value) => clean(value)).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'es'));
}

function increment(map, key, amount = 1) {
  const label = clean(key, 'Sin dato');
  map.set(label, (map.get(label) || 0) + amount);
}

function mapRows(map, limit = 0) {
  const rows = [...map.entries()]
    .sort((left, right) => right[1] - left[1] || clean(left[0]).localeCompare(clean(right[0]), 'es'))
    .map(([label, value]) => [clean(label, 'Sin dato'), round(value)]);
  return limit > 0 ? rows.slice(0, limit) : rows;
}

function chronologicalRows(map) {
  return [...map.entries()]
    .sort((left, right) => clean(left[0]).localeCompare(clean(right[0]), 'es'))
    .map(([label, value]) => [clean(label, 'Sin dato'), round(value)]);
}

function ticketStatusBucket(value) {
  const status = normalized(value);
  if (status.includes('pend')) return 'pendiente';
  if (status.includes('final')) return 'finalizado';
  return 'otro';
}

function ticketStatusLabel(bucket) {
  if (bucket === 'pendiente') return 'Pendiente';
  if (bucket === 'finalizado') return 'Finalizado';
  return 'En proceso / otros';
}

function matchesRequestedStatus(row, requested) {
  const expected = normalized(requested);
  if (!expected) return true;
  if (['pendiente', 'finalizado', 'otro'].includes(expected)) return ticketStatusBucket(row.Estado) === expected;
  return normalized(row.Estado) === expected;
}

export function buildTicketAssigneeIndex(assignments = [], users = []) {
  const usersById = new Map(users.map((row) => [clean(row.UsuarioID), row]));
  const pending = new Map();

  for (const row of assignments) {
    if (!active(row)) continue;
    const ticketId = clean(row.BoletaUID);
    const user = usersById.get(clean(row.UsuarioID));
    const name = clean(
      user?.NombreCompleto
        || user?.Nombre
        || user?.NombreUsuario
        || row.NombreUsuarioSnapshot
        || row.UsuarioID,
    );
    if (!name) continue;
    const names = pending.get(ticketId);
    if (names) names.push(name);
    else pending.set(ticketId, [name]);
  }

  const result = new Map();
  pending.forEach((names, ticketId) => result.set(ticketId, uniqueSorted(names)));
  return result;
}

export function ticketAssigneesFromIndex(ticket = {}, assigneesByTicketId = new Map()) {
  const assigned = assigneesByTicketId.get(clean(ticket.BoletaUID));
  if (assigned?.length) return assigned;
  return uniqueSorted(
    clean(ticket.AsignadoA || ticket.Asignado || ticket.Responsable)
      .split(/[;,]/)
      .map((value) => value.trim()),
  );
}

function ticketFilters(payload = {}) {
  return {
    client: clean(payload.cliente || payload.Cliente),
    date: dateOnly(payload.fecha || payload.Fecha),
    failureType: clean(payload.tipoFalla || payload.TipoFalla),
    status: clean(payload.estado || payload.Estado),
    category: clean(payload.categoria || payload.Categoria),
    technician: clean(payload.tecnico || payload.Tecnico || payload.asignadoA),
  };
}

function matchesTicketWithoutTechnician(row, filters) {
  if (filters.date && dateOnly(row.Fecha) !== filters.date) return false;
  if (filters.failureType && !sameText(row.TipoFalla, filters.failureType)) return false;
  if (!matchesRequestedStatus(row, filters.status)) return false;
  if (filters.category && !sameText(row.Categoria || 'Sin categoría', filters.category)) return false;
  return true;
}

function matchesTechnician(assignees, technician) {
  if (!technician) return true;
  if (sameText(technician, 'Sin asignar')) return assignees.length === 0;
  return assignees.some((name) => sameText(name, technician));
}

export function buildTicketMetrics({ tickets = [], assignments = [], users = [], payload = {} } = {}) {
  const filters = ticketFilters(payload);
  const assigneesByTicketId = buildTicketAssigneeIndex(assignments, users);
  const clients = new Set();
  const dates = new Set();
  const failureOptions = new Set();
  const categoryOptions = new Set();
  const technicianOptions = new Set();
  const statusCounts = { pendiente: 0, finalizado: 0, otro: 0 };
  const byDate = new Map();
  const byFailureType = new Map();
  const byCategory = new Map();
  const assignedHours = new Map();
  const details = [];
  let totalHours = 0;
  let matchedCount = 0;

  for (const row of tickets) {
    if (!active(row) || normalized(row.Estado) === 'anulada') continue;
    const clientName = clean(row.Cliente);
    if (clientName) clients.add(clientName);
    if (filters.client && !sameText(row.Cliente, filters.client)) continue;

    const rowDate = dateOnly(row.Fecha);
    if (rowDate) dates.add(rowDate);
    const failure = clean(row.TipoFalla);
    if (failure) failureOptions.add(failure);
    categoryOptions.add(clean(row.Categoria || 'Sin categoría'));

    const assignees = ticketAssigneesFromIndex(row, assigneesByTicketId);
    if (assignees.length) assignees.forEach((name) => technicianOptions.add(clean(name)));
    else technicianOptions.add('Sin asignar');

    if (!matchesTicketWithoutTechnician(row, filters)) continue;
    if (!matchesTechnician(assignees, filters.technician)) continue;

    matchedCount += 1;
    const hours = number(row.HorasTotales);
    totalHours += hours;
    const bucket = ticketStatusBucket(row.Estado);
    statusCounts[bucket] += 1;
    increment(byDate, rowDate || 'Sin fecha');
    increment(byFailureType, row.TipoFalla || 'Sin tipo de falla');
    increment(byCategory, row.Categoria || 'Sin categoría');

    const share = assignees.length ? hours / assignees.length : 0;
    if (assignees.length) assignees.forEach((name) => increment(assignedHours, name, share));
    else increment(assignedHours, 'Sin asignar', hours);

    details.push({
      id: row.BoletaID || row.BoletaUID,
      boletaUid: row.BoletaUID,
      titulo: row.Titulo || 'Sin título',
      estado: row.Estado || 'Sin estado',
      estadoFiltro: bucket,
      fecha: rowDate,
      cliente: row.Cliente || 'Sin cliente',
      categoria: row.Categoria || 'Sin categoría',
      tipoFalla: row.TipoFalla || 'Sin tipo de falla',
      asignadoA: assignees.join(', ') || 'Sin asignar',
      asignados: assignees.length ? assignees : ['Sin asignar'],
      horasTotales: round(row.HorasTotales),
      horaInicio: row.HoraInicio || '',
      horaFinalizacion: row.HoraFinal || '',
      ubicacion: row.Ubicacion || '',
      esMantenimiento: Boolean(row.EsBoletaMantenimiento || row.OrigenMantenimientoID),
    });
  }

  details.sort((left, right) => (
    clean(right.fecha).localeCompare(clean(left.fecha), 'es')
      || String(right.id).localeCompare(String(left.id), 'es')
  ));

  return {
    filtersApplied: {
      cliente: filters.client,
      fecha: filters.date,
      tipoFalla: filters.failureType,
      estado: normalized(filters.status),
      categoria: filters.category,
      tecnico: filters.technician,
    },
    options: {
      clientes: uniqueSorted([...clients]),
      fechas: uniqueSorted([...dates]).reverse(),
      tiposFalla: uniqueSorted([...failureOptions]),
      categorias: uniqueSorted([...categoryOptions]),
      tecnicos: uniqueSorted([...technicianOptions]),
      estados: [
        { value: 'pendiente', label: 'Pendiente' },
        { value: 'finalizado', label: 'Finalizado' },
        { value: 'otro', label: 'En proceso / otros' },
      ],
    },
    totals: {
      total: matchedCount,
      pendientes: statusCounts.pendiente,
      finalizadas: statusCounts.finalizado,
      enProceso: statusCounts.otro,
      horasTotales: round(totalHours),
      promedioHoras: matchedCount ? round(totalHours / matchedCount) : 0,
    },
    charts: {
      porFecha: chronologicalRows(byDate),
      porTipoFalla: mapRows(byFailureType, 12),
      porEstado: [
        [ticketStatusLabel('pendiente'), statusCounts.pendiente],
        [ticketStatusLabel('finalizado'), statusCounts.finalizado],
        [ticketStatusLabel('otro'), statusCounts.otro],
      ],
      porCategoria: mapRows(byCategory, 12),
    },
    tableAsignadoHoras: [...assignedHours.entries()]
      .sort((left, right) => right[1] - left[1] || clean(left[0]).localeCompare(clean(right[0]), 'es'))
      .map(([asignadoA, horasTotales], index) => ({
        index: index + 1,
        asignadoA: clean(asignadoA, 'Sin asignar'),
        horasTotales: round(horasTotales),
      })),
    detailRows: details.slice(0, 300),
  };
}

export function buildFullAssignedHours({ tickets = [], assignments = [], users = [], payload = {} } = {}) {
  const filters = ticketFilters(payload);
  const assigneesByTicketId = buildTicketAssigneeIndex(assignments, users);
  const totals = new Map();

  for (const row of tickets) {
    if (!active(row) || normalized(row.Estado) === 'anulada') continue;
    if (filters.client && !sameText(row.Cliente, filters.client)) continue;
    if (!matchesTicketWithoutTechnician(row, filters)) continue;

    const assignees = ticketAssigneesFromIndex(row, assigneesByTicketId);
    if (!matchesTechnician(assignees, filters.technician)) continue;
    const hours = number(row.HorasTotales);
    const recipients = assignees.length ? assignees : ['Sin asignar'];
    recipients.forEach((name) => totals.set(name, number(totals.get(name)) + hours));
  }

  return [...totals.entries()]
    .sort((left, right) => right[1] - left[1] || clean(left[0]).localeCompare(clean(right[0]), 'es'))
    .map(([asignadoA, horasTotales], index) => ({
      index: index + 1,
      asignadoA: clean(asignadoA, 'Sin asignar'),
      horasTotales: round(horasTotales),
    }));
}
