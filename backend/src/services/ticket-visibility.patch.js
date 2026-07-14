import { ticketHandlers } from '../modules/tickets.module.js';
import { ticketDeliveryHandlers } from '../modules/ticket-delivery.module.js';
import { filterRows, readTable } from '../infra/sheets.repository.js';
import { assertTicketPayloadAccess, canViewAllTickets } from './ticket-access.service.js';

function equals(row, field, expected) {
  return !expected || String(row[field] || '') === String(expected);
}

function ticketIdsAssignedTo(rows, userId) {
  return new Set(rows
    .filter((row) => row.Activo !== false && String(row.UsuarioID) === String(userId))
    .map((row) => String(row.BoletaUID)));
}

ticketHandlers.list = async (ctx) => {
  const { payload } = ctx;
  let rows = (await readTable('Boletas'))
    .filter((row) => row.Activo !== false && String(row.Estado || '').toUpperCase() !== 'ANULADA');

  const requestedAssignedUser = String(payload.asignadoUsuarioId || payload.UsuarioID || '').trim();
  const needsAssignments = !canViewAllTickets(ctx) || Boolean(requestedAssignedUser);
  const assignments = needsAssignments ? await readTable('BoletaAsignados') : [];

  if (!canViewAllTickets(ctx)) {
    const allowedIds = ticketIdsAssignedTo(assignments, ctx.user.UsuarioID);
    rows = rows.filter((row) => allowedIds.has(String(row.BoletaUID)));
  }
  if (requestedAssignedUser) {
    const assignedIds = ticketIdsAssignedTo(assignments, requestedAssignedUser);
    rows = rows.filter((row) => assignedIds.has(String(row.BoletaUID)));
  }

  if (payload.status || payload.estado) {
    rows = rows.filter((row) => String(row.Estado || '').toUpperCase() === String(payload.status || payload.estado).toUpperCase());
  }
  if (payload.dateFrom) rows = rows.filter((row) => String(row.Fecha || '').slice(0, 10) >= String(payload.dateFrom));
  if (payload.dateTo) rows = rows.filter((row) => String(row.Fecha || '').slice(0, 10) <= String(payload.dateTo));
  if (payload.clienteId) rows = rows.filter((row) => equals(row, 'ClienteID', payload.clienteId));
  if (payload.categoriaId) rows = rows.filter((row) => equals(row, 'CategoriaID', payload.categoriaId));
  if (payload.tipoDispositivoId) rows = rows.filter((row) => equals(row, 'TipoDispositivoID', payload.tipoDispositivoId));
  if (payload.fabricanteId) rows = rows.filter((row) => equals(row, 'FabricanteID', payload.fabricanteId));
  if (payload.modeloId) rows = rows.filter((row) => equals(row, 'ModeloID', payload.modeloId));

  return filterRows(rows, payload, ['Titulo', 'Cliente', 'Ubicacion', 'Categoria', 'TipoDispositivo', 'Modelo', 'BoletaID']);
};

for (const key of [
  'get',
  'update',
  'autosave',
  'returnPending',
  'annul',
  'evidenceUpload',
  'evidenceUpdate',
  'evidenceDelete',
  'mediaGet',
  'signatureUpload',
]) {
  const original = ticketHandlers[key];
  if (!original) continue;
  ticketHandlers[key] = async (ctx) => {
    await assertTicketPayloadAccess(ctx, ctx.payload);
    return original(ctx);
  };
}

for (const key of ['finalize', 'testFinalize', 'generatePdf']) {
  const original = ticketDeliveryHandlers[key];
  if (!original) continue;
  ticketDeliveryHandlers[key] = async (ctx) => {
    await assertTicketPayloadAccess(ctx, ctx.payload);
    return original(ctx);
  };
}
