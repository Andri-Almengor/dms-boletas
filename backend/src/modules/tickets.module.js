import { appendRow, filterRows, findById, readTable, readTables, softDelete, updateRow } from '../infra/sheets.repository.js';
import { uploadBase64, downloadAsDataUrl, trashFile } from '../infra/drive.repository.js';
import { badRequest, notFound } from '../core/errors.js';
import { asArray, asBool, nowIso, pick, uuid } from '../core/utils.js';
import { getConfig } from './config.module.js';
import { audit } from '../services/audit.service.js';

function driveIdFromUrl(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  const patterns = [
    /\/d\/([a-zA-Z0-9_-]{10,})/,
    /[?&]id=([a-zA-Z0-9_-]{10,})/,
    /\/thumbnail\?id=([a-zA-Z0-9_-]{10,})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match?.[1]) return match[1];
  }
  return '';
}

function userDisplayName(user) {
  return String(user?.NombreCompleto || user?.Nombre || user?.NombreUsuario || user?.Correo || '').trim();
}

function evidenceFileId(row) {
  return String(pick(row, ['ArchivoID','ArchivoFileID','DriveFileID','FileID'], driveIdFromUrl(pick(row, ['ArchivoURL','DriveURL','URL'])))).trim();
}

function signatureFileId(row) {
  return String(pick(row, ['FirmaArchivoID','FirmaFileID','FirmaDriveFileID'], driveIdFromUrl(pick(row, ['FirmaURL','FirmaUrl','Firma'])))).trim();
}

async function enrichTicket(row) {
  const tables = await readTables(['BoletaAsignados', 'EvidenciasBoleta', 'Usuarios']);
  const usersById = new Map(tables.Usuarios.map((user) => [String(user.UsuarioID), user]));
  const assigned = tables.BoletaAsignados
    .filter((item) => String(item.BoletaUID) === String(row.BoletaUID) && asBool(item.Activo, true))
    .map((item) => {
      const user = usersById.get(String(item.UsuarioID));
      const name = userDisplayName(user) || String(item.NombreUsuarioSnapshot || item.Nombre || item.UsuarioID || '');
      return { ...item, NombreCompleto: name, Nombre: name };
    });
  const evidences = tables.EvidenciasBoleta
    .filter((item) => String(item.BoletaUID) === String(row.BoletaUID) && asBool(item.Activo, true))
    .map((item) => ({ ...item, ArchivoID: evidenceFileId(item) || item.ArchivoID }));
  return { boleta: row, asignados: assigned, evidencias: evidences };
}

function ticketPayload(p, existing = {}) {
  return {
    Titulo: pick(p,['Titulo','titulo'],existing.Titulo), Estado: pick(p,['Estado','estado'],existing.Estado || 'PENDIENTE').toUpperCase(), Fecha: pick(p,['Fecha','fecha'],existing.Fecha), HoraInicio: pick(p,['HoraInicio','horaInicio'],existing.HoraInicio), HoraFinal: pick(p,['HoraFinal','horaFinal'],existing.HoraFinal), HorasTotales: Number(p.HorasTotales ?? p.horasTotales ?? existing.HorasTotales ?? 0),
    ClienteID: pick(p,['ClienteID','clienteId'],existing.ClienteID), Cliente: pick(p,['Cliente','cliente'],existing.Cliente), UbicacionID: pick(p,['UbicacionID','ubicacionId'],existing.UbicacionID), Ubicacion: pick(p,['Ubicacion','ubicacion'],existing.Ubicacion), UbicacionEquipoID: pick(p,['UbicacionEquipoID','ubicacionEquipoId'],existing.UbicacionEquipoID), UbicacionEquipo: pick(p,['UbicacionEquipo','ubicacionEquipo'],existing.UbicacionEquipo), SupervisorID: pick(p,['SupervisorID','supervisorId'],existing.SupervisorID), Supervisor: pick(p,['Supervisor','supervisor'],existing.Supervisor), CorreoCliente: pick(p,['CorreoCliente','correoCliente'],existing.CorreoCliente), CorreoSupervisor: pick(p,['CorreoSupervisor','correoSupervisor'],existing.CorreoSupervisor),
    CategoriaID: pick(p,['CategoriaID','categoriaId'],existing.CategoriaID), Categoria: pick(p,['Categoria','categoria'],existing.Categoria), TipoFalla: pick(p,['TipoFalla','tipoFalla'],existing.TipoFalla), TipoDispositivoID: pick(p,['TipoDispositivoID','tipoDispositivoId'],existing.TipoDispositivoID), TipoDispositivo: pick(p,['TipoDispositivo','tipoDispositivo'],existing.TipoDispositivo), FabricanteID: pick(p,['FabricanteID','fabricanteId'],existing.FabricanteID), Fabricante: pick(p,['Fabricante','fabricante'],existing.Fabricante), ModeloID: pick(p,['ModeloID','modeloId'],existing.ModeloID), Modelo: pick(p,['Modelo','modelo'],existing.Modelo), Serie: pick(p,['Serie','serie'],existing.Serie),
    RazonVisita: pick(p,['RazonVisita','razonVisita'],existing.RazonVisita), Descripcion: pick(p,['Descripcion','descripcion'],existing.Descripcion), PruebasRealizadas: pick(p,['PruebasRealizadas','pruebasRealizadas'],existing.PruebasRealizadas), Resultado: pick(p,['Resultado','resultado'],existing.Resultado), Recomendaciones: pick(p,['Recomendaciones','recomendaciones'],existing.Recomendaciones), EnviarCorreoCliente: asBool(p.EnviarCorreoCliente ?? p.enviarCorreoCliente, existing.EnviarCorreoCliente), CorreosCC: pick(p,['CorreosCC','correosCC'],existing.CorreosCC),
  };
}

async function replaceAssigned(ticketId, ids, ctx) {
  const existing = await readTable('BoletaAsignados');
  for (const row of existing.filter((item) => String(item.BoletaUID) === String(ticketId) && asBool(item.Activo, true))) await updateRow('BoletaAsignados', row.BoletaAsignadoID, { Activo: false });
  const users = await readTable('Usuarios');
  for (const id of ids) {
    const user = users.find((item) => String(item.UsuarioID) === String(id));
    await appendRow('BoletaAsignados', { BoletaAsignadoID: uuid(), BoletaUID: ticketId, UsuarioID: id, NombreUsuarioSnapshot: userDisplayName(user) || id, Activo: true, CreadoPor: ctx.user.UsuarioID, FechaCreacion: nowIso() });
  }
}

async function nextTicketNumber() {
  const rows = await readTable('Boletas'); return Math.max(0, ...rows.map((r) => Number(r.BoletaID || 0))) + 1;
}

async function resolveTicketMedia(payload = {}) {
  const ticketId = pick(payload, ['boletaUid','BoletaUID','ticketId']);
  const evidenceId = pick(payload, ['evidenciaId','EvidenciaID','id']);
  const requestedFileId = String(pick(payload, ['fileId','ArchivoID','FirmaArchivoID'], driveIdFromUrl(pick(payload, ['directUrl','url','ArchivoURL','FirmaURL'])))).trim();
  const tables = await readTables(['Boletas', 'EvidenciasBoleta']);
  const ticket = ticketId ? tables.Boletas.find((item) => String(item.BoletaUID) === String(ticketId)) : null;

  let evidence = evidenceId
    ? tables.EvidenciasBoleta.find((item) => String(item.EvidenciaID) === String(evidenceId))
    : null;
  if (!evidence && requestedFileId) {
    evidence = tables.EvidenciasBoleta.find((item) => evidenceFileId(item) === requestedFileId && (!ticketId || String(item.BoletaUID) === String(ticketId)));
  }
  if (evidence) {
    if (ticketId && String(evidence.BoletaUID) !== String(ticketId)) throw notFound('La evidencia no pertenece a esta boleta.');
    const fileId = evidenceFileId(evidence);
    if (!fileId) throw notFound('La evidencia no tiene un archivo de Drive asociado.');
    return { fileId, mimeType: evidence.MimeType || 'application/octet-stream', evidenceId: evidence.EvidenciaID, kind: 'evidence' };
  }

  if (ticket) {
    const fileId = signatureFileId(ticket);
    if (fileId && (!requestedFileId || requestedFileId === fileId)) return { fileId, mimeType: 'image/png', ticketId: ticket.BoletaUID, kind: 'signature' };
  }

  throw notFound('No se encontró la imagen o archivo solicitado para esta boleta.');
}

export const ticketHandlers = {
  list: async ({ payload }) => {
    let rows = (await readTable('Boletas')).filter((r) => r.Activo !== false && String(r.Estado || '').toUpperCase() !== 'ANULADA');
    if (payload.status || payload.estado) rows = rows.filter((r) => String(r.Estado || '').toUpperCase() === String(payload.status || payload.estado).toUpperCase());
    if (payload.dateFrom) rows = rows.filter((r) => String(r.Fecha || '').slice(0,10) >= String(payload.dateFrom));
    if (payload.dateTo) rows = rows.filter((r) => String(r.Fecha || '').slice(0,10) <= String(payload.dateTo));
    return filterRows(rows, payload, ['Titulo','Cliente','Ubicacion','Categoria','TipoDispositivo','Modelo','BoletaID']);
  },
  get: async ({ payload }) => enrichTicket(await findById('Boletas', pick(payload,['boletaUid','BoletaUID','id']))),
  create: async (ctx) => {
    const row = { BoletaUID: uuid(), BoletaID: await nextTicketNumber(), Version: 1, ...ticketPayload(ctx.payload), CreadoPor: ctx.user.UsuarioID, ActualizadoPor: ctx.user.UsuarioID, FechaCreacion: nowIso(), FechaActualizacion: nowIso(), EstadoNotificacion: 'PENDIENTE', UltimoErrorNotificacion: '' };
    if (!row.ClienteID || !row.Titulo) throw badRequest('Título y cliente son obligatorios.');
    await appendRow('Boletas', row); await replaceAssigned(row.BoletaUID, asArray(ctx.payload.AsignadoA || ctx.payload.asignados), ctx); await audit(ctx,'CREAR_BOLETA','Boletas',row.BoletaUID,null,row); return enrichTicket(row);
  },
  update: async (ctx) => {
    const id = pick(ctx.payload,['boletaUid','BoletaUID','id']); const before = await findById('Boletas', id); const patch = { ...ticketPayload(ctx.payload,before), Version: Number(before.Version || 0)+1, ActualizadoPor: ctx.user.UsuarioID, FechaActualizacion: nowIso() };
    const after = await updateRow('Boletas', id, patch); if (ctx.payload.AsignadoA || ctx.payload.asignados) await replaceAssigned(id, asArray(ctx.payload.AsignadoA || ctx.payload.asignados), ctx); await audit(ctx,'EDITAR_BOLETA','Boletas',id,before,after); return enrichTicket(after);
  },
  finalize: async (ctx) => { const id = pick(ctx.payload,['boletaUid','BoletaUID']); const after = await updateRow('Boletas', id, { Estado:'FINALIZADA', FinalizadaEn:nowIso(), ActualizadoPor:ctx.user.UsuarioID, FechaActualizacion:nowIso() }); await audit(ctx,'FINALIZAR_BOLETA','Boletas',id,null,after); return enrichTicket(after); },
  returnPending: async (ctx) => ({ boleta: await updateRow('Boletas', pick(ctx.payload,['boletaUid','BoletaUID']), { Estado:'PENDIENTE', ActualizadoPor:ctx.user.UsuarioID, FechaActualizacion:nowIso() }) }),
  annul: async (ctx) => ({ boleta: await updateRow('Boletas', pick(ctx.payload,['boletaUid','BoletaUID']), { Estado:'ANULADA', ActualizadoPor:ctx.user.UsuarioID, FechaActualizacion:nowIso() }) }),
  evidenceUpload: async (ctx) => {
    const cfg = await getConfig(); const file = await uploadBase64({ base64:ctx.payload.base64, mimeType:ctx.payload.mimeType, fileName:ctx.payload.fileName, folderId:cfg.EVIDENCIAS_FOLDER_ID });
    const row = { EvidenciaID:uuid(), BoletaUID:pick(ctx.payload,['boletaUid','BoletaUID']), Nombre:pick(ctx.payload,['nombre','Nombre'],file.name), Nota:pick(ctx.payload,['nota','Nota']), ArchivoID:file.id, ArchivoURL:file.webViewLink, NombreArchivo:file.name, MimeType:file.mimeType, Orden:Number(ctx.payload.orden||0), Activo:true, CreadoPor:ctx.user.UsuarioID, FechaCreacion:nowIso(), ActualizadoPor:ctx.user.UsuarioID, FechaActualizacion:nowIso() };
    await appendRow('EvidenciasBoleta',row); return row;
  },
  evidenceUpdate: async (ctx) => updateRow('EvidenciasBoleta', pick(ctx.payload,['evidenciaId','EvidenciaID','id']), { Nombre:pick(ctx.payload,['nombre','Nombre']), Nota:pick(ctx.payload,['nota','Nota']), ActualizadoPor:ctx.user.UsuarioID, FechaActualizacion:nowIso() }),
  evidenceDelete: async (ctx) => { const row=await findById('EvidenciasBoleta',pick(ctx.payload,['evidenciaId','EvidenciaID','id'])); await trashFile(evidenceFileId(row)).catch(()=>{}); return softDelete('EvidenciasBoleta',row.EvidenciaID,ctx.user.UsuarioID); },
  mediaGet: async ({ payload }) => { const media = await resolveTicketMedia(payload); return { ...media, ...await downloadAsDataUrl(media.fileId, media.mimeType) }; },
  signatureUpload: async (ctx) => { const cfg=await getConfig(); const file=await uploadBase64({base64:ctx.payload.base64,mimeType:ctx.payload.mimeType||'image/png',fileName:ctx.payload.fileName,folderId:cfg.FIRMAS_FOLDER_ID}); await updateRow('Boletas',pick(ctx.payload,['boletaUid','BoletaUID']),{FirmaArchivoID:file.id,FirmaURL:file.webViewLink,ActualizadoPor:ctx.user.UsuarioID,FechaActualizacion:nowIso()}); return file; },
  generatePdf: async ({ payload }) => { const row=await findById('Boletas',pick(payload,['boletaUid','BoletaUID'])); return { boletaUid:row.BoletaUID, pdfUrl:row.PDFURL || '', message:'La generación avanzada de PDF puede configurarse con una plantilla de Google Docs; los datos y archivos ya están migrados al backend Node.' }; },
  testFinalize: async (ctx) => ticketHandlers.finalize(ctx),
};
