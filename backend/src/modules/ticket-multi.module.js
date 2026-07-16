import { nowIso, pick } from '../core/utils.js';
import { readTables, updateRow } from '../infra/sheets.repository.js';
import { audit } from '../services/audit.service.js';
import {
  applySignatureToVisitGroup,
  ensureVisitGroupForTicket,
  groupSummary,
  prepareRelatedVisit,
  synchronizeVisitGroupSignature,
  ticketGroupId,
  ticketRootId,
  ticketVisitNumber,
  updateVisitGroup,
} from '../services/ticket-visit-group.service.js';
import { ticketHandlers as baseTicketHandlers } from './tickets.module.js';

function clean(value) {
  return String(value ?? '').trim();
}

function comparable(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

const CATALOG_SPECS = [
  { table: 'TiposFalla', idKeys: ['TipoFallaID', 'tipoFallaId'], labelKeys: ['TipoFalla', 'tipoFalla'], rowId: 'TipoFallaID', rowLabel: 'Nombre', targetId: 'TipoFallaID', targetLabel: 'TipoFalla' },
  { table: 'TiposDispositivo', idKeys: ['TipoDispositivoID', 'tipoDispositivoId'], labelKeys: ['TipoDispositivo', 'tipoDispositivo'], rowId: 'TipoDispositivoID', rowLabel: 'Nombre', targetId: 'TipoDispositivoID', targetLabel: 'TipoDispositivo' },
  { table: 'Fabricantes', idKeys: ['FabricanteID', 'fabricanteId'], labelKeys: ['Fabricante', 'fabricante'], rowId: 'FabricanteID', rowLabel: 'Nombre', targetId: 'FabricanteID', targetLabel: 'Fabricante' },
  { table: 'Modelos', idKeys: ['ModeloID', 'modeloId'], labelKeys: ['Modelo', 'modelo'], rowId: 'ModeloID', rowLabel: 'Nombre', targetId: 'ModeloID', targetLabel: 'Modelo' },
];

function matchCatalogRow(rows, source, spec) {
  const currentId = clean(pick(source, spec.idKeys));
  const currentLabel = comparable(pick(source, spec.labelKeys));
  return rows.find((row) => currentId && clean(row[spec.rowId]) === currentId)
    || rows.find((row) => currentLabel && comparable(row[spec.rowLabel]) === currentLabel)
    || null;
}

async function normalizeCatalogPayload(payload = {}) {
  const tables = await readTables(CATALOG_SPECS.map((spec) => spec.table));
  const next = { ...payload };
  for (const spec of CATALOG_SPECS) {
    const match = matchCatalogRow(tables[spec.table] || [], next, spec);
    if (!match) continue;
    const id = clean(match[spec.rowId]);
    const label = clean(match[spec.rowLabel]);
    next[spec.targetId] = id;
    next[spec.targetLabel] = label;
    const camelId = spec.idKeys.find((key) => key[0] === key[0].toLowerCase());
    const camelLabel = spec.labelKeys.find((key) => key[0] === key[0].toLowerCase());
    if (camelId) next[camelId] = id;
    if (camelLabel) next[camelLabel] = label;
  }
  return next;
}

async function repairStoredCatalogReferences(ticket, actor = 'SISTEMA') {
  if (!ticket?.BoletaUID) return ticket;
  const normalized = await normalizeCatalogPayload(ticket);
  const patch = {};
  for (const spec of CATALOG_SPECS) {
    const id = clean(normalized[spec.targetId]);
    const label = clean(normalized[spec.targetLabel]);
    if (id && id !== clean(ticket[spec.targetId])) patch[spec.targetId] = id;
    if (label && label !== clean(ticket[spec.targetLabel])) patch[spec.targetLabel] = label;
  }
  if (!Object.keys(patch).length) return ticket;
  return updateRow('Boletas', ticket.BoletaUID, {
    ...patch,
    ActualizadoPor: actor,
    FechaActualizacion: nowIso(),
  });
}

function assignedView(ticketId, assignments, usersById) {
  return assignments
    .filter((item) => clean(item.BoletaUID) === clean(ticketId) && item.Activo !== false)
    .map((item) => {
      const user = usersById.get(clean(item.UsuarioID));
      const name = clean(user?.NombreCompleto || user?.Nombre || user?.NombreUsuario || item.NombreUsuarioSnapshot || item.UsuarioID);
      return {
        ...item,
        NombreCompleto: name,
        Nombre: name,
        NombreUsuario: clean(user?.NombreUsuario),
        Correo: clean(user?.Correo),
      };
    });
}

async function enrichWithVisitGroup(bundle, actor = 'SISTEMA') {
  const sourceTicket = bundle?.boleta || bundle;
  if (!sourceTicket?.BoletaUID) return bundle;
  const ticket = await repairStoredCatalogReferences(sourceTicket, actor);
  const [group, tables] = await Promise.all([
    ensureVisitGroupForTicket(ticket.BoletaUID, actor),
    readTables(['BoletaAsignados', 'EvidenciasBoleta', 'Usuarios']),
  ]);
  const usersById = new Map(tables.Usuarios.map((user) => [clean(user.UsuarioID), user]));
  const visits = group.visits.map((visit) => ({
    ...visit,
    GrupoVisitaID: ticketGroupId(visit),
    BoletaPrincipalUID: ticketRootId(visit),
    NumeroVisita: ticketVisitNumber(visit),
    EsVisitaPrincipal: clean(visit.BoletaUID) === clean(group.rootId),
    asignados: assignedView(visit.BoletaUID, tables.BoletaAsignados, usersById),
    evidenceCount: tables.EvidenciasBoleta.filter((item) => clean(item.BoletaUID) === clean(visit.BoletaUID) && item.Activo !== false).length,
  }));
  const rawCurrent = group.visits.find((visit) => clean(visit.BoletaUID) === clean(ticket.BoletaUID)) || ticket;
  const current = {
    ...rawCurrent,
    ...ticket,
    GrupoVisitaID: ticketGroupId(rawCurrent),
    BoletaPrincipalUID: ticketRootId(rawCurrent),
    NumeroVisita: ticketVisitNumber(rawCurrent),
    EsVisitaPrincipal: clean(rawCurrent.BoletaUID) === clean(group.rootId),
  };

  return {
    ...(bundle?.boleta ? bundle : {}),
    boleta: current,
    asignados: bundle?.asignados || assignedView(current.BoletaUID, tables.BoletaAsignados, usersById),
    evidencias: bundle?.evidencias || tables.EvidenciasBoleta.filter((item) => clean(item.BoletaUID) === clean(current.BoletaUID) && item.Activo !== false),
    grupoVisitas: { ...groupSummary(group), visits },
    visitasRelacionadas: visits,
  };
}

function inheritedPayload(parentBundle, payload, relation) {
  const parent = parentBundle.boleta || {};
  const assigned = Array.isArray(payload.AsignadoA || payload.asignados)
    ? (payload.AsignadoA || payload.asignados)
    : (parentBundle.asignados || []).map((item) => item.UsuarioID).filter(Boolean);
  return {
    ...parent,
    ...payload,
    parentTicketId: parent.BoletaUID,
    Titulo: pick(payload, ['Titulo', 'titulo'], parent.Titulo),
    titulo: pick(payload, ['Titulo', 'titulo'], parent.Titulo),
    ClienteID: pick(payload, ['ClienteID', 'clienteId'], parent.ClienteID),
    Cliente: pick(payload, ['Cliente', 'cliente'], parent.Cliente),
    clienteId: pick(payload, ['ClienteID', 'clienteId'], parent.ClienteID),
    cliente: pick(payload, ['Cliente', 'cliente'], parent.Cliente),
    CategoriaID: pick(payload, ['CategoriaID', 'categoriaId'], parent.CategoriaID),
    Categoria: pick(payload, ['Categoria', 'categoria'], parent.Categoria),
    SupervisorID: pick(payload, ['SupervisorID', 'supervisorId'], parent.SupervisorID),
    Supervisor: pick(payload, ['Supervisor', 'supervisor'], parent.Supervisor),
    CorreoSupervisor: pick(payload, ['CorreoSupervisor', 'correoSupervisor'], parent.CorreoSupervisor),
    CorreoCliente: pick(payload, ['CorreoCliente', 'correoCliente'], parent.CorreoCliente),
    EnviarCorreoCliente: parent.EnviarCorreoCliente,
    CorreosCC: parent.CorreosCC,
    GrupoVisitaID: relation.groupFields.GrupoVisitaID,
    BoletaPrincipalUID: relation.groupFields.BoletaPrincipalUID,
    NumeroVisita: relation.groupFields.NumeroVisita,
    EsVisitaPrincipal: false,
    Estado: 'PENDIENTE',
    estado: 'PENDIENTE',
    AsignadoA: assigned,
    asignados: assigned,
  };
}

async function getEnriched(ctx) {
  const bundle = await baseTicketHandlers.get(ctx);
  return enrichWithVisitGroup(bundle, ctx.user?.UsuarioID || 'SISTEMA');
}

async function createTicket(ctx) {
  const normalizedPayload = await normalizeCatalogPayload(ctx.payload);
  const normalizedContext = { ...ctx, payload: normalizedPayload };
  const parentTicketId = clean(pick(normalizedPayload, ['parentTicketId', 'boletaRelacionadaUid', 'BoletaRelacionadaUID']));
  if (!parentTicketId) {
    const created = await baseTicketHandlers.create(normalizedContext);
    return enrichWithVisitGroup(created, ctx.user.UsuarioID);
  }

  const relation = await prepareRelatedVisit(parentTicketId, ctx.user.UsuarioID);
  const parentBundle = await baseTicketHandlers.get({ ...ctx, payload: { boletaUid: parentTicketId } });
  const createContext = {
    ...ctx,
    payload: inheritedPayload(parentBundle, normalizedPayload, relation),
  };
  const created = await baseTicketHandlers.create(createContext);
  const createdTicket = created.boleta || created;
  const groupedTicket = await updateRow('Boletas', createdTicket.BoletaUID, {
    ...relation.groupFields,
    ActualizadoPor: ctx.user.UsuarioID,
    FechaActualizacion: nowIso(),
  });
  await updateRow('Boletas', relation.group.rootId, {
    Version: Number(relation.group.root.Version || 0) + 1,
    ActualizadoPor: ctx.user.UsuarioID,
    FechaActualizacion: nowIso(),
  });
  await synchronizeVisitGroupSignature(relation.group.rootId, ctx.user.UsuarioID);
  await audit(ctx, 'RELACIONAR_VISITA_BOLETA', 'Boletas', groupedTicket.BoletaUID, createdTicket, {
    GrupoVisitaID: relation.group.id,
    BoletaPrincipalUID: relation.group.rootId,
    NumeroVisita: relation.groupFields.NumeroVisita,
  });
  return getEnriched({ ...ctx, payload: { boletaUid: groupedTicket.BoletaUID } });
}

async function updateTicket(ctx) {
  const normalizedContext = { ...ctx, payload: await normalizeCatalogPayload(ctx.payload) };
  const result = await baseTicketHandlers.update(normalizedContext);
  return enrichWithVisitGroup(result, ctx.user.UsuarioID);
}

async function autosaveTicket(ctx) {
  const normalizedContext = { ...ctx, payload: await normalizeCatalogPayload(ctx.payload) };
  const result = await baseTicketHandlers.autosave(normalizedContext);
  if (result?.throttled) return result;
  const id = pick(normalizedContext.payload, ['boletaUid', 'BoletaUID', 'id']);
  return getEnriched({ ...ctx, payload: { boletaUid: id } });
}

async function uploadSharedSignature(ctx) {
  const ticketId = pick(ctx.payload, ['boletaUid', 'BoletaUID']);
  const file = await baseTicketHandlers.signatureUpload(ctx);
  const group = await applySignatureToVisitGroup(ticketId, {
    fileId: file.id,
    url: file.webViewLink,
    mimeType: file.mimeType || ctx.payload.mimeType || 'image/png',
    origin: 'DETALLE_BOLETA',
    signedAt: nowIso(),
  }, ctx.user.UsuarioID);
  await audit(ctx, 'FIRMA_COMPARTIDA_GRUPO_BOLETAS', 'Boletas', group.rootId, null, {
    GrupoVisitaID: group.id,
    CantidadVisitas: group.visits.length,
    FirmaArchivoID: file.id,
  });
  return { ...file, grupoVisitas: groupSummary(group) };
}

async function returnGroupPending(ctx) {
  const ticketId = pick(ctx.payload, ['boletaUid', 'BoletaUID', 'id']);
  const group = await updateVisitGroup(ticketId, { Estado: 'PENDIENTE' }, ctx.user.UsuarioID);
  return { boleta: group.root, grupoVisitas: groupSummary(group) };
}

export const ticketMultiHandlers = {
  ...baseTicketHandlers,
  get: getEnriched,
  create: createTicket,
  update: updateTicket,
  autosave: autosaveTicket,
  signatureUpload: uploadSharedSignature,
  returnPending: returnGroupPending,
};