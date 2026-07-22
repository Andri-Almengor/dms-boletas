import { readTables } from '../infra/sheets.repository.js';
import { metricsHandlers } from '../modules/metrics.module.js';

const INSTALL_FLAG = Symbol.for('dms.metricsFullAssignedHoursPolicy');

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

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(number(value) * factor) / factor;
}

function uniqueSorted(values) {
  return [...new Set(values.map((value) => clean(value)).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'es'));
}

function ticketStatusBucket(value) {
  const status = normalized(value);
  if (status.includes('pend')) return 'pendiente';
  if (status.includes('final')) return 'finalizado';
  return 'otro';
}

function matchesRequestedStatus(row, requested) {
  const expected = normalized(requested);
  if (!expected) return true;
  if (['pendiente', 'finalizado', 'otro'].includes(expected)) return ticketStatusBucket(row.Estado) === expected;
  return normalized(row.Estado) === expected;
}

function ticketAssignees(ticketId, assignments, usersById, ticket = {}) {
  const names = assignments
    .filter((row) => clean(row.BoletaUID) === clean(ticketId) && active(row))
    .map((row) => {
      const user = usersById.get(clean(row.UsuarioID));
      return clean(
        user?.NombreCompleto
          || user?.Nombre
          || user?.NombreUsuario
          || row.NombreUsuarioSnapshot
          || row.UsuarioID,
      );
    })
    .filter(Boolean);
  if (names.length) return uniqueSorted(names);
  return uniqueSorted(
    clean(ticket.AsignadoA || ticket.Asignado || ticket.Responsable)
      .split(/[;,]/)
      .map((value) => value.trim()),
  );
}

async function fullAssignedHours(payload = {}) {
  const tables = await readTables(['Boletas', 'BoletaAsignados', 'Usuarios']);
  const assignments = tables.BoletaAsignados || [];
  const usersById = new Map((tables.Usuarios || []).map((row) => [clean(row.UsuarioID), row]));

  const client = clean(payload.cliente || payload.Cliente);
  const date = dateOnly(payload.fecha || payload.Fecha);
  const failureType = clean(payload.tipoFalla || payload.TipoFalla);
  const status = clean(payload.estado || payload.Estado);
  const category = clean(payload.categoria || payload.Categoria);
  const technician = clean(payload.tecnico || payload.Tecnico || payload.asignadoA);

  const rows = (tables.Boletas || [])
    .filter((row) => active(row) && normalized(row.Estado) !== 'anulada')
    .map((row) => ({ row, assignees: ticketAssignees(row.BoletaUID, assignments, usersById, row) }))
    .filter(({ row }) => !client || sameText(row.Cliente, client))
    .filter(({ row }) => !date || dateOnly(row.Fecha) === date)
    .filter(({ row }) => !failureType || sameText(row.TipoFalla, failureType))
    .filter(({ row }) => matchesRequestedStatus(row, status))
    .filter(({ row }) => !category || sameText(row.Categoria || 'Sin categoría', category))
    .filter(({ assignees }) => {
      if (!technician) return true;
      if (sameText(technician, 'Sin asignar')) return assignees.length === 0;
      return assignees.some((name) => sameText(name, technician));
    });

  const totals = new Map();
  for (const { row, assignees } of rows) {
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

if (!metricsHandlers[INSTALL_FLAG]) {
  const ticketMetrics = metricsHandlers.tickets;
  metricsHandlers.tickets = async (ctx) => {
    const result = await ticketMetrics(ctx);
    return {
      ...result,
      tableAsignadoHoras: await fullAssignedHours(ctx.payload || {}),
    };
  };
  metricsHandlers[INSTALL_FLAG] = true;
}
