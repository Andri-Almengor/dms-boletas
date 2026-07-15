import { forbidden, notFound } from '../core/errors.js';
import { pick } from '../core/utils.js';
import { filterRows, findById, readTable, readTables } from '../infra/sheets.repository.js';
import { ticketHandlers } from './tickets.module.js';

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

function isAdministrator(ctx) {
  return ctx.permissions?.includes('USUARIOS_GESTIONAR')
    || ctx.permissions?.includes('BOLETAS_ELIMINAR')
    || ctx.permissions?.includes('BOLETAS_GESTIONAR');
}

function userId(ctx) {
  return String(ctx.user?.UsuarioID || '').trim();
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

async function assertTicketAccess(ctx, ticket, action = 'consultar') {
  if (isAdministrator(ctx)) return ticket;
  const technicianId = userId(ctx);
  const assignments = await readTable('BoletaAsignados');
  const assignedIds = assignedTicketIds(assignments, technicianId);
  if (!technicianIsAssigned(ticket, assignedIds)) {
    throw forbidden(`Solo puede ${action} boletas en las que está asignado.`);
  }
  return ticket;
}

async function ticketForMedia(payload = {}) {
  const directTicketId = pick(payload, ['boletaUid', 'BoletaUID']);
  if (directTicketId) return findById('Boletas', directTicketId);
  const evidenceId = pick(payload, ['evidenciaId', 'EvidenciaID', 'mediaId', 'id']);
  if (evidenceId) {
    const evidence = await findById('EvidenciasBoleta', evidenceId);
    return findById('Boletas', evidence.BoletaUID);
  }
  const requestedFileId = String(pick(payload, ['fileId', 'ArchivoID', 'ArchivoFileID', 'DriveFileID']) || '').trim();
  if (!requestedFileId) throw notFound('No fue posible identificar la boleta del archivo solicitado.');
  const tables = await readTables(['Boletas', 'EvidenciasBoleta']);
  const evidence = tables.EvidenciasBoleta.find((row) => (
    isActive(row)
    && String(pick(row, ['ArchivoID', 'ArchivoFileID', 'DriveFileID']) || '').trim() === requestedFileId
  ));
  if (evidence) {
    const ticket = tables.Boletas.find((row) => String(row.BoletaUID) === String(evidence.BoletaUID));
    if (ticket) return ticket;
  }
  const signatureTicket = tables.Boletas.find((row) => (
    String(pick(row, ['FirmaArchivoID', 'FirmaFileID']) || '').trim() === requestedFileId
  ));
  if (signatureTicket) return signatureTicket;
  throw notFound('No se encontró la boleta relacionada con el archivo solicitado.');
}

async function ticketForEvidenceMutation(payload = {}) {
  const directTicketId = pick(payload, ['boletaUid', 'BoletaUID']);
  if (directTicketId) return findById('Boletas', directTicketId);
  const evidenceId = pick(payload, ['evidenciaId', 'EvidenciaID', 'id']);
  if (!evidenceId) throw notFound('No fue posible identificar la evidencia de la boleta.');
  const evidence = await findById('EvidenciasBoleta', evidenceId);
  return findById('Boletas', evidence.BoletaUID);
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

async function assertCanModifyFinalized(ctx, ticketId) {
  const ticket = await findById('Boletas', ticketId);
  return assertTicketAccess(ctx, ticket, 'editar');
}

function preserveFinalizedState(ctx, ticket) {
  if (normalizeStatus(ticket.Estado) !== 'FINALIZADA') return ctx;
  return {
    ...ctx,
    payload: {
      ...ctx.payload,
      estado: 'FINALIZADA',
      Estado: 'FINALIZADA',
    },
  };
}

export const ticketAccessHandlers = {
  assertTicketAccess,
  assertCanModifyFinalized,

  list: async (ctx) => {
    const { payload } = ctx;
    const tables = await readTables(['Boletas', 'BoletaAsignados']);
    const requestedStatus = normalizeStatus(payload.status || payload.estado);
    const admin = isAdministrator(ctx);
    let rows = tables.Boletas.filter((row) => isActive(row) && normalizeStatus(row.Estado) !== 'ANULADA');

    if (requestedStatus) rows = rows.filter((row) => normalizeStatus(row.Estado) === requestedStatus);

    if (admin) {
      const selectedTechnician = String(payload.asignadoUsuarioId || '').trim();
      if (selectedTechnician) {
        const selectedIds = assignedTicketIds(tables.BoletaAsignados, selectedTechnician);
        rows = rows.filter((row) => technicianIsAssigned(row, selectedIds));
      }
    } else {
      const assignedIds = assignedTicketIds(tables.BoletaAsignados, userId(ctx));
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
  },

  get: async (ctx) => {
    const ticket = await findById('Boletas', pick(ctx.payload, ['boletaUid', 'BoletaUID', 'id']));
    await assertTicketAccess(ctx, ticket);
    return ticketHandlers.get(ctx);
  },

  mediaGet: async (ctx) => {
    const ticket = await ticketForMedia(ctx.payload);
    await assertTicketAccess(ctx, ticket);
    return ticketHandlers.mediaGet(ctx);
  },

  update: async (ctx) => {
    const ticket = await assertCanModifyFinalized(ctx, pick(ctx.payload, ['boletaUid', 'BoletaUID', 'id']));
    return ticketHandlers.update(preserveFinalizedState(ctx, ticket));
  },

  autosave: async (ctx) => {
    const ticket = await assertCanModifyFinalized(ctx, pick(ctx.payload, ['boletaUid', 'BoletaUID', 'id']));
    return ticketHandlers.autosave(preserveFinalizedState(ctx, ticket));
  },

  evidenceUpload: async (ctx) => {
    const ticket = await ticketForEvidenceMutation(ctx.payload);
    await assertTicketAccess(ctx, ticket, 'agregar evidencias a');
    return ticketHandlers.evidenceUpload(ctx);
  },

  evidenceUpdate: async (ctx) => {
    const ticket = await ticketForEvidenceMutation(ctx.payload);
    await assertTicketAccess(ctx, ticket, 'editar evidencias de');
    return ticketHandlers.evidenceUpdate(ctx);
  },

  evidenceDelete: async (ctx) => {
    const ticket = await ticketForEvidenceMutation(ctx.payload);
    await assertTicketAccess(ctx, ticket, 'eliminar evidencias de');
    return ticketHandlers.evidenceDelete(ctx);
  },

  signatureUpload: async (ctx) => {
    const ticket = await findById('Boletas', pick(ctx.payload, ['boletaUid', 'BoletaUID', 'id']));
    await assertTicketAccess(ctx, ticket, 'editar la firma de');
    return ticketHandlers.signatureUpload(ctx);
  },

  returnPending: async (ctx) => {
    const ticket = await findById('Boletas', pick(ctx.payload, ['boletaUid', 'BoletaUID', 'id']));
    await assertTicketAccess(ctx, ticket, 'regresar a pendiente');
    return ticketHandlers.returnPending(ctx);
  },

  annul: async (ctx) => {
    const ticket = await findById('Boletas', pick(ctx.payload, ['boletaUid', 'BoletaUID', 'id']));
    await assertTicketAccess(ctx, ticket, 'anular');
    return ticketHandlers.annul(ctx);
  },
};
