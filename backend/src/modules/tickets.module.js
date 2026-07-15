import { appendRow, filterRows, findById, readTable, readTables, softDelete, updateRow } from '../infra/sheets.repository.js';
import { uploadBase64, downloadAsDataUrl, trashFile } from '../infra/drive.repository.js';
import { badRequest, notFound } from '../core/errors.js';
import { asArray, asBool, nowIso, pick, uuid } from '../core/utils.js';
import { getConfig } from './config.module.js';
import { audit } from '../services/audit.service.js';

const autosaveWriteTimes = new Map();
const AUTOSAVE_MIN_INTERVAL_MS = 6000;
let ticketCreateTail = Promise.resolve();
let evidenceCreateTail = Promise.resolve();

function serialized(previousTail, operation, setTail) {
  const current = previousTail.then(operation, operation);
  setTail(current.catch(() => {}));
  return current;
}

function withTicketCreateLock(operation) {
  return serialized(ticketCreateTail, operation, (next) => { ticketCreateTail = next; });
}

function withEvidenceCreateLock(operation) {
  return serialized(evidenceCreateTail, operation, (next) => { evidenceCreateTail = next; });
}

function validClientGeneratedId(value) {
  return /^[A-Za-z0-9._:-]{8,160}$/.test(String(value || ''));
}

function userDisplayName(user, fallback = '') {
  return String(pick(user, ['NombreCompleto', 'Nombre', 'NombreUsuario', 'Correo'], fallback)).trim();
}

function normalizeComparable(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function normalizedIds(values) {
  return [...new Set(asArray(values).map((value) => String(value || '').trim()).filter(Boolean))].sort();
}

function sameIds(left, right) {
  const a = normalizedIds(left);
  const b = normalizedIds(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sameValue(left, right) {
  if (typeof left === 'boolean' || typeof right === 'boolean') return Boolean(left) === Boolean(right);
  if (typeof left === 'number' || typeof right === 'number') return Number(left || 0) === Number(right || 0);
  return String(left ?? '').trim() === String(right ?? '').trim();
}

function resolveFailureType(row, failureTypes = []) {
  if (row.TipoFallaID) return row;
  const currentName = normalizeComparable(row.TipoFalla);
  if (!currentName) return row;
  const match = failureTypes.find((item) => normalizeComparable(item.Nombre) === currentName);
  if (!match) return row;
  return { ...row, TipoFallaID: match.TipoFallaID, TipoFalla: row.TipoFalla || match.Nombre };
}

async function enrichTicket(sourceRow) {
  const tables = await readTables(['BoletaAsignados', 'EvidenciasBoleta', 'Usuarios', 'TiposFalla']);
  const row = resolveFailureType(sourceRow, tables.TiposFalla);
  const usersById = new Map(tables.Usuarios.map((user) => [String(user.UsuarioID), user]));
  const assigned = tables.BoletaAsignados
    .filter((item) => String(item.BoletaUID) === String(row.BoletaUID) && item.Activo !== false)
    .map((item) => {
      const user = usersById.get(String(item.UsuarioID));
      const name = userDisplayName(user, item.NombreUsuarioSnapshot || item.UsuarioID);
      return {
        ...item,
        NombreCompleto: name,
        Nombre: name,
        NombreUsuario: String(user?.NombreUsuario || '').trim(),
        Correo: String(user?.Correo || '').trim(),
      };
    });
  const evidences = tables.EvidenciasBoleta
    .filter((item) => String(item.BoletaUID) === String(row.BoletaUID) && item.Activo !== false);
  return { boleta: row, asignados: assigned, evidencias: evidences };
}

function ticketPayload(p, existing = {}) {
  return {
    Titulo: pick(p, ['Titulo', 'titulo'], existing.Titulo),
    Estado: pick(p, ['Estado', 'estado'], existing.Estado || 'PENDIENTE').toUpperCase(),
    Fecha: pick(p, ['Fecha', 'fecha'], existing.Fecha),
    HoraInicio: pick(p, ['HoraInicio', 'horaInicio'], existing.HoraInicio),
    HoraFinal: pick(p, ['HoraFinal', 'horaFinal'], existing.HoraFinal),
    HorasTotales: Number(p.HorasTotales ?? p.horasTotales ?? existing.HorasTotales ?? 0),
    ClienteID: pick(p, ['ClienteID', 'clienteId'], existing.ClienteID),
    Cliente: pick(p, ['Cliente', 'cliente'], existing.Cliente),
    UbicacionID: pick(p, ['UbicacionID', 'ubicacionId'], existing.UbicacionID),
    Ubicacion: pick(p, ['Ubicacion', 'ubicacion'], existing.Ubicacion),
    UbicacionEquipoID: pick(p, ['UbicacionEquipoID', 'ubicacionEquipoId'], existing.UbicacionEquipoID),
    UbicacionEquipo: pick(p, ['UbicacionEquipo', 'ubicacionEquipo'], existing.UbicacionEquipo),
    SupervisorID: pick(p, ['SupervisorID', 'supervisorId'], existing.SupervisorID),
    Supervisor: pick(p, ['Supervisor', 'supervisor'], existing.Supervisor),
    CorreoCliente: pick(p, ['CorreoCliente', 'correoCliente'], existing.CorreoCliente),
    CorreoSupervisor: pick(p, ['CorreoSupervisor', 'correoSupervisor'], existing.CorreoSupervisor),
    CategoriaID: pick(p, ['CategoriaID', 'categoriaId'], existing.CategoriaID),
    Categoria: pick(p, ['Categoria', 'categoria'], existing.Categoria),
    TipoFallaID: pick(p, ['TipoFallaID', 'tipoFallaId'], existing.TipoFallaID),
    TipoFalla: pick(p, ['TipoFalla', 'tipoFalla'], existing.TipoFalla),
    TipoDispositivoID: pick(p, ['TipoDispositivoID', 'tipoDispositivoId'], existing.TipoDispositivoID),
    TipoDispositivo: pick(p, ['TipoDispositivo', 'tipoDispositivo'], existing.TipoDispositivo),
    FabricanteID: pick(p, ['FabricanteID', 'fabricanteId'], existing.FabricanteID),
    Fabricante: pick(p, ['Fabricante', 'fabricante'], existing.Fabricante),
    ModeloID: pick(p, ['ModeloID', 'modeloId'], existing.ModeloID),
    Modelo: pick(p, ['Modelo', 'modelo'], existing.Modelo),
    Serie: pick(p, ['Serie', 'serie'], existing.Serie),
    RazonVisita: pick(p, ['RazonVisita', 'razonVisita'], existing.RazonVisita),
    Descripcion: pick(p, ['Descripcion', 'descripcion'], existing.Descripcion),
    PruebasRealizadas: pick(p, ['PruebasRealizadas', 'pruebasRealizadas'], existing.PruebasRealizadas),
    Resultado: pick(p, ['Resultado', 'resultado'], existing.Resultado),
    Recomendaciones: pick(p, ['Recomendaciones', 'recomendaciones'], existing.Recomendaciones),
    EnviarCorreoCliente: asBool(p.EnviarCorreoCliente ?? p.enviarCorreoCliente, existing.EnviarCorreoCliente),
    CorreosCC: pick(p, ['CorreosCC', 'correosCC'], existing.CorreosCC),
  };
}

function changedTicketPatch(before, payload, userId) {
  const candidate = ticketPayload(payload, before);
  const changed = Object.fromEntries(Object.entries(candidate).filter(([key, value]) => !sameValue(before[key], value)));
  if (!Object.keys(changed).length) return {};
  return { ...changed, Version: Number(before.Version || 0) + 1, ActualizadoPor: userId, FechaActualizacion: nowIso() };
}

function hasAssignedPayload(payload = {}) {
  return Object.prototype.hasOwnProperty.call(payload, 'AsignadoA') || Object.prototype.hasOwnProperty.call(payload, 'asignados');
}

async function replaceAssigned(ticketId, ids, ctx) {
  const rows = await readTable('BoletaAsignados');
  const active = rows.filter((item) => String(item.BoletaUID) === String(ticketId) && item.Activo !== false);
  const nextIds = normalizedIds(ids);
  if (sameIds(active.map((item) => item.UsuarioID), nextIds)) return false;
  for (const row of active) await updateRow('BoletaAsignados', row.BoletaAsignadoID, { Activo: false });
  const users = await readTable('Usuarios');
  for (const id of nextIds) {
    const user = users.find((item) => String(item.UsuarioID) === String(id));
    await appendRow('BoletaAsignados', {
      BoletaAsignadoID: uuid(),
      BoletaUID: ticketId,
      UsuarioID: id,
      NombreUsuarioSnapshot: userDisplayName(user, id),
      Activo: true,
      CreadoPor: ctx.user.UsuarioID,
      FechaCreacion: nowIso(),
    });
  }
  return true;
}

function nextTicketNumber(rows) {
  const used = rows
    .map((row) => Number(row.BoletaID))
    .filter((value) => Number.isInteger(value) && value > 0);
  return (used.length ? Math.max(...used) : 0) + 1;
}

async function resolveTicketMedia(payload = {}) {
  const boletaUid = pick(payload, ['boletaUid', 'BoletaUID']);
  const evidenceId = pick(payload, ['evidenciaId', 'EvidenciaID', 'mediaId', 'id']);
  const requestedFileId = pick(payload, ['fileId', 'ArchivoID', 'ArchivoFileID', 'DriveFileID']);
  const kind = String(pick(payload, ['kind', 'tipo'], '')).trim().toLowerCase();
  if (evidenceId) {
    const evidence = await findById('EvidenciasBoleta', evidenceId);
    if (boletaUid && String(evidence.BoletaUID) !== String(boletaUid)) throw notFound('La evidencia no pertenece a la boleta solicitada.');
    const fileId = pick(evidence, ['ArchivoID', 'ArchivoFileID', 'DriveFileID']);
    if (!fileId) throw notFound('La evidencia no tiene un archivo asociado.');
    return { recordId: evidence.EvidenciaID, kind: 'evidence', fileId, mimeType: evidence.MimeType || 'application/octet-stream' };
  }
  let ticket = null;
  if (boletaUid) ticket = await findById('Boletas', boletaUid);
  if (kind === 'signature' || kind === 'firma') {
    if (!ticket) throw notFound('No se indicó la boleta de la firma.');
    const fileId = pick(ticket, ['FirmaArchivoID', 'FirmaFileID']);
    if (!fileId) throw notFound('La boleta no tiene una firma almacenada.');
    return { recordId: ticket.BoletaUID, kind: 'signature', fileId, mimeType: pick(ticket, ['FirmaMimeType'], 'image/png') };
  }
  if (requestedFileId) {
    const evidences = await readTable('EvidenciasBoleta');
    const evidence = evidences.find((item) => String(pick(item, ['ArchivoID', 'ArchivoFileID', 'DriveFileID'])) === String(requestedFileId) && (!boletaUid || String(item.BoletaUID) === String(boletaUid)) && item.Activo !== false);
    if (evidence) return { recordId: evidence.EvidenciaID, kind: 'evidence', fileId: requestedFileId, mimeType: evidence.MimeType || 'application/octet-stream' };
    if (ticket && String(pick(ticket, ['FirmaArchivoID', 'FirmaFileID'])) === String(requestedFileId)) return { recordId: ticket.BoletaUID, kind: 'signature', fileId: requestedFileId, mimeType: pick(ticket, ['FirmaMimeType'], 'image/png') };
  }
  throw notFound('No se encontró el archivo asociado a la boleta.');
}

export const ticketHandlers = {
  list: async ({ payload }) => {
    let rows = (await readTable('Boletas')).filter((row) => row.Activo !== false && String(row.Estado || '').toUpperCase() !== 'ANULADA');
    if (payload.status || payload.estado) rows = rows.filter((row) => String(row.Estado || '').toUpperCase() === String(payload.status || payload.estado).toUpperCase());
    if (payload.dateFrom) rows = rows.filter((row) => String(row.Fecha || '').slice(0, 10) >= String(payload.dateFrom));
    if (payload.dateTo) rows = rows.filter((row) => String(row.Fecha || '').slice(0, 10) <= String(payload.dateTo));
    return filterRows(rows, payload, ['Titulo', 'Cliente', 'Ubicacion', 'Categoria', 'TipoDispositivo', 'Modelo', 'BoletaID']);
  },

  get: async ({ payload }) => enrichTicket(await findById('Boletas', pick(payload, ['boletaUid', 'BoletaUID', 'id']))),

  create: async (ctx) => withTicketCreateLock(async () => {
    const requestedId = String(pick(ctx.payload, ['boletaUid', 'BoletaUID'], '')).trim();
    if (requestedId && !validClientGeneratedId(requestedId)) throw badRequest('El identificador local de la boleta no es válido.');

    const rows = await readTable('Boletas', { force: true });
    if (requestedId) {
      const existing = rows.find((item) => String(item.BoletaUID) === requestedId);
      if (existing) {
        const sameOwner = String(existing.CreadoPor || '') === String(ctx.user.UsuarioID || '');
        const admin = ctx.permissions?.includes('USUARIOS_GESTIONAR');
        if (!sameOwner && !admin) throw badRequest('El identificador local ya pertenece a otra boleta.');
        if (hasAssignedPayload(ctx.payload)) await replaceAssigned(existing.BoletaUID, ctx.payload.AsignadoA || ctx.payload.asignados, ctx);
        return enrichTicket(existing);
      }
    }

    const row = {
      BoletaUID: requestedId || uuid(),
      BoletaID: nextTicketNumber(rows),
      Version: 1,
      ...ticketPayload(ctx.payload),
      CreadoPor: ctx.user.UsuarioID,
      ActualizadoPor: ctx.user.UsuarioID,
      FechaCreacion: nowIso(),
      FechaActualizacion: nowIso(),
      EstadoNotificacion: 'PENDIENTE',
      UltimoErrorNotificacion: '',
    };
    if (!row.ClienteID || !row.Titulo) throw badRequest('Título y cliente son obligatorios.');
    await appendRow('Boletas', row);
    await replaceAssigned(row.BoletaUID, asArray(ctx.payload.AsignadoA || ctx.payload.asignados), ctx);
    await audit(ctx, 'CREAR_BOLETA', 'Boletas', row.BoletaUID, null, row);
    return enrichTicket(row);
  }),

  update: async (ctx) => {
    const id = pick(ctx.payload, ['boletaUid', 'BoletaUID', 'id']);
    const before = await findById('Boletas', id);
    const patch = changedTicketPatch(before, ctx.payload, ctx.user.UsuarioID);
    const after = Object.keys(patch).length ? await updateRow('Boletas', id, patch) : before;
    const assignedChanged = hasAssignedPayload(ctx.payload) ? await replaceAssigned(id, ctx.payload.AsignadoA || ctx.payload.asignados, ctx) : false;
    if (Object.keys(patch).length || assignedChanged) await audit(ctx, 'EDITAR_BOLETA', 'Boletas', id, before, after);
    return enrichTicket(after);
  },

  autosave: async (ctx) => {
    const id = String(pick(ctx.payload, ['boletaUid', 'BoletaUID', 'id']));
    const now = Date.now();
    if (now - (autosaveWriteTimes.get(id) || 0) < AUTOSAVE_MIN_INTERVAL_MS) return { autosaved: false, throttled: true };
    autosaveWriteTimes.set(id, now);
    try {
      const before = await findById('Boletas', id);
      const patch = changedTicketPatch(before, ctx.payload, ctx.user.UsuarioID);
      const after = Object.keys(patch).length ? await updateRow('Boletas', id, patch) : before;
      if (hasAssignedPayload(ctx.payload)) await replaceAssigned(id, ctx.payload.AsignadoA || ctx.payload.asignados, ctx);
      return { boleta: after, autosaved: true };
    } catch (error) {
      autosaveWriteTimes.delete(id);
      throw error;
    }
  },

  finalize: async (ctx) => {
    const id = pick(ctx.payload, ['boletaUid', 'BoletaUID']);
    const after = await updateRow('Boletas', id, { Estado: 'FINALIZADA', FinalizadaEn: nowIso(), ActualizadoPor: ctx.user.UsuarioID, FechaActualizacion: nowIso() });
    await audit(ctx, 'FINALIZAR_BOLETA', 'Boletas', id, null, after);
    return enrichTicket(after);
  },

  returnPending: async (ctx) => ({ boleta: await updateRow('Boletas', pick(ctx.payload, ['boletaUid', 'BoletaUID']), { Estado: 'PENDIENTE', ActualizadoPor: ctx.user.UsuarioID, FechaActualizacion: nowIso() }) }),
  annul: async (ctx) => ({ boleta: await updateRow('Boletas', pick(ctx.payload, ['boletaUid', 'BoletaUID']), { Estado: 'ANULADA', ActualizadoPor: ctx.user.UsuarioID, FechaActualizacion: nowIso() }) }),

  evidenceUpload: async (ctx) => withEvidenceCreateLock(async () => {
    const requestedId = String(pick(ctx.payload, ['evidenciaId', 'EvidenciaID'], '')).trim();
    const boletaUid = pick(ctx.payload, ['boletaUid', 'BoletaUID']);
    if (requestedId && !validClientGeneratedId(requestedId)) throw badRequest('El identificador local de la evidencia no es válido.');
    if (requestedId) {
      const existing = (await readTable('EvidenciasBoleta', { force: true })).find((item) => String(item.EvidenciaID) === requestedId);
      if (existing) {
        if (String(existing.BoletaUID) !== String(boletaUid)) throw badRequest('La evidencia local ya pertenece a otra boleta.');
        return existing;
      }
    }
    await findById('Boletas', boletaUid);
    const cfg = await getConfig();
    const file = await uploadBase64({ base64: ctx.payload.base64, mimeType: ctx.payload.mimeType, fileName: ctx.payload.fileName, folderId: cfg.EVIDENCIAS_FOLDER_ID });
    const row = {
      EvidenciaID: requestedId || uuid(),
      BoletaUID: boletaUid,
      Nombre: pick(ctx.payload, ['nombre', 'Nombre'], file.name),
      Nota: pick(ctx.payload, ['nota', 'Nota']),
      ArchivoID: file.id,
      ArchivoURL: file.webViewLink,
      NombreArchivo: file.name,
      MimeType: file.mimeType,
      Orden: Number(ctx.payload.orden || 0),
      Activo: true,
      CreadoPor: ctx.user.UsuarioID,
      FechaCreacion: nowIso(),
      ActualizadoPor: ctx.user.UsuarioID,
      FechaActualizacion: nowIso(),
    };
    await appendRow('EvidenciasBoleta', row);
    return row;
  }),

  evidenceUpdate: async (ctx) => updateRow('EvidenciasBoleta', pick(ctx.payload, ['evidenciaId', 'EvidenciaID', 'id']), { Nombre: pick(ctx.payload, ['nombre', 'Nombre']), Nota: pick(ctx.payload, ['nota', 'Nota']), ActualizadoPor: ctx.user.UsuarioID, FechaActualizacion: nowIso() }),

  evidenceDelete: async (ctx) => {
    const row = await findById('EvidenciasBoleta', pick(ctx.payload, ['evidenciaId', 'EvidenciaID', 'id']));
    await trashFile(row.ArchivoID).catch(() => {});
    return softDelete('EvidenciasBoleta', row.EvidenciaID, ctx.user.UsuarioID);
  },

  mediaGet: async ({ payload }) => {
    const media = await resolveTicketMedia(payload);
    return { mediaId: media.recordId, kind: media.kind, fileId: media.fileId, ...await downloadAsDataUrl(media.fileId, media.mimeType) };
  },

  signatureUpload: async (ctx) => {
    const cfg = await getConfig();
    const mimeType = ctx.payload.mimeType || 'image/png';
    const file = await uploadBase64({ base64: ctx.payload.base64, mimeType, fileName: ctx.payload.fileName, folderId: cfg.FIRMAS_FOLDER_ID });
    await updateRow('Boletas', pick(ctx.payload, ['boletaUid', 'BoletaUID']), { FirmaArchivoID: file.id, FirmaURL: file.webViewLink, FirmaMimeType: mimeType, ActualizadoPor: ctx.user.UsuarioID, FechaActualizacion: nowIso() });
    return file;
  },

  generatePdf: async ({ payload }) => {
    const row = await findById('Boletas', pick(payload, ['boletaUid', 'BoletaUID']));
    return { boletaUid: row.BoletaUID, pdfUrl: row.PDFURL || '', message: 'La generación avanzada de PDF puede configurarse con una plantilla de Google Docs; los datos y archivos ya están migrados al backend Node.' };
  },

  testFinalize: async (ctx) => ticketHandlers.finalize(ctx),
};
