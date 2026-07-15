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

function technicianParticipates(ticket, participationIds, technicianId) {
  return participationIds.has(String(ticket.BoletaUID || '').trim())
    || String(ticket.CreadoPor || '').trim() === String(technicianId || '').trim();
}

async function assertFinalizedAccess(ctx, ticket, action = 'consultar') {
  if (normalizeStatus(ticket.Estado) !== 'FINALIZADA' || isAdministrator(ctx)) return ticket;
  const technicianId = userId(ctx);
  const assignments = await readTable('BoletaAsignados');
  const participationIds = assignedTicketIds(assignments, technicianId);
  if (!technicianParticipates(ticket, participationIds, technicianId)) {
    throw forbidden(`Solo puede ${action} boletas finalizadas en las que participó.`);
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
  return assertFinalizedAccess(ctx, ticket, 'editar');
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
  assertCanModifyFinalized,

  list: async (ctx) => {
    const { payload } = ctx;
    const tables = await readTables(['Boletas', 'BoletaAsignados']);
    const requestedStatus = normalizeStatus(payload.status || payload.estado);
    const admin = isAdministrator(ctx);
    const technicianId = userId(ctx);
    let rows = tables.Boletas.filter((row) => isActive(row) && normalizeStatus(row.Estado) !== 'ANULADA');
    if (requestedStatus) rows = rows.filter((row) => normalizeStatus(row.Estado) === requestedStatus);
    if (requestedStatus === 'FINALIZADA') {
      if (admin) {
        const selectedTechnician = String(payload.asignadoUsuarioId || '').trim();
        if (selectedTechnician) {
          const selectedIds = assignedTicketIds(tables.BoletaAsignados, selectedTechnician);
          rows = rows.filter((row) => selectedIds.has(String(row.BoletaUID)));
        }
      } else {
        const participationIds = assignedTicketIds(tables.BoletaAsignados, technicianId);
        rows = rows.filter((row) => technicianParticipates(row, participationIds, technicianId));
      }
    } else if (admin && payload.asignadoUsuarioId) {
      const selectedIds = assignedTicketIds(tables.BoletaAsignados, payload.asignadoUsuarioId);
      rows = rows.filter((row) => selectedIds.has(String(row.BoletaUID)));
    }
    if (payload.dateFrom) rows = rows.filter((row) => String(row.Fecha || '').slice(0, 10) >= String(payload.dateFrom));
    if (payload.dateTo) rows = rows.filter((row) => String(row.Fecha || '').slice(0, 10) <= String(payload.dateTo));
    rows = applyFieldFilters(rows, payload);
    return filterRows(rows, { ...payload, estado: undefined, status: undefined }, [
      'Titulo', 'Cliente', 'Ubicacion', 'Categoria', 'TipoDispositivo', 'Fabricante', 'Modelo', 'BoletaID',
    ]);
  },

  get: async (ctx) => {
    const ticket = await findById('Boletas', pick(ctx.payload, ['boletaUid', 'BoletaUID', 'id']));
    await assertFinalizedAccess(ctx, ticket);
    return ticketHandlers.get(ctx);
  },

  mediaGet: async (ctx) => {
    const ticket = await ticketForMedia(ctx.payload);
    await assertFinalizedAccess(ctx, ticket);
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
    await assertFinalizedAccess(ctx, ticket, 'agregar evidencias a');
    return ticketHandlers.evidenceUpload(ctx);
  },

  evidenceUpdate: async (ctx) => {
    const ticket = await ticketForEvidenceMutation(ctx.payload);
    await assertFinalizedAccess(ctx, ticket, 'editar evidencias de');
    return ticketHandlers.evidenceUpdate(ctx);
  },

  evidenceDelete: async (ctx) => {
    const ticket = await ticketForEvidenceMutation(ctx.payload);
    await assertFinalizedAccess(ctx, ticket, 'eliminar evidencias de');
    return ticketHandlers.evidenceDelete(ctx);
  },

  signatureUpload: async (ctx) => {
    await assertCanModifyFinalized(ctx, pick(ctx.payload, ['boletaUid', 'BoletaUID', 'id']));
    return ticketHandlers.signatureUpload(ctx);
  },
};
