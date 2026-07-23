import { AppError, badRequest, forbidden } from '../core/errors.js';
import { asArray, nowIso, pick, uuid } from '../core/utils.js';
import { appendRow, findById, readTable, updateRow } from '../infra/sheets.repository.js';
import { maintenanceHandlers } from './maintenance.module.js';
import { maintenanceReportAccessHandlers } from './maintenance-report-access.module.js';
import { ticketDeliveryHandlers } from './ticket-delivery.module.js';
import {
  generateMaintenanceTickets,
  MAINTENANCE_TICKET_COLUMNS,
} from '../services/maintenance-ticket-generation.service.js';
import { previewMaintenanceTicketsWithDocuments } from '../services/maintenance-ticket-preview-report.service.js';
import { generateMaintenancePresentationWithAppsScript } from '../services/maintenance-presentation.service.js';
import {
  ensureMaintenanceSignatureRequest,
  maintenanceHasSignature,
} from '../services/maintenance-signature-request.service.js';
import { ensureSheetColumns } from '../services/sheet-columns.service.js';

const DEVICE_WORK_COLUMNS = ['FechaTrabajo', 'TecnicoIDsJSON', 'Tecnicos'];

function clean(value) {
  return String(value ?? '').trim();
}

function dateOnly(value, fallback = '') {
  const match = clean(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || fallback;
}

function normalizeCategory(value) {
  const text = clean(value);
  const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return normalized === 'camara' || normalized === 'camaras' ? 'Cámara' : text;
}

function parseAnswers(payload = {}) {
  const source = payload.respuestas || payload.answers || payload.RespuestasJSON || {};
  if (typeof source !== 'string') return source || {};
  try { return JSON.parse(source || '{}'); } catch { return {}; }
}

function isAdmin(ctx) {
  return ctx.permissions?.includes('USUARIOS_GESTIONAR')
    || ctx.permissions?.includes('MANTENIMIENTOS_GESTIONAR')
    || ctx.permissions?.includes('MANTENIMIENTOS_ELIMINAR');
}

async function resolveDeviceWorkMetadata(payload = {}, existing = null) {
  const maintenanceId = clean(pick(payload, ['maintenanceId', 'MantenimientoID', 'MantenimientoRef'], existing?.MantenimientoRef));
  if (!maintenanceId) throw badRequest('No se indicó el mantenimiento del dispositivo.');

  await findById('Mantenimiento', maintenanceId);
  const users = await readTable('Usuarios');
  const ids = [...new Set(asArray(
    payload.TecnicoIDsJSON
      || payload.TecnicoIDs
      || payload.tecnicoIds
      || existing?.TecnicoIDsJSON,
  ).map(clean).filter(Boolean))].sort();

  const names = ids.map((id) => {
    const user = users.find((item) => String(item.UsuarioID) === id);
    return clean(pick(user, ['NombreCompleto', 'Nombre', 'NombreUsuario', 'Correo'], id));
  });

  return {
    maintenanceId,
    FechaTrabajo: dateOnly(pick(payload, ['FechaTrabajo', 'fechaTrabajo'], existing?.FechaTrabajo), ''),
    TecnicoIDsJSON: JSON.stringify(ids),
    Tecnicos: names.join(', '),
    technicianIds: ids,
  };
}

function contextWithMetadata(ctx, metadata) {
  return {
    ...ctx,
    payload: {
      ...ctx.payload,
      maintenanceId: metadata.maintenanceId,
      MantenimientoID: metadata.maintenanceId,
      FechaTrabajo: metadata.FechaTrabajo,
      fechaTrabajo: metadata.FechaTrabajo,
      TecnicoIDs: metadata.technicianIds,
      tecnicoIds: metadata.technicianIds,
      TecnicoIDsJSON: metadata.TecnicoIDsJSON,
      Tecnicos: metadata.Tecnicos,
    },
  };
}

async function persistMetadata(deviceId, metadata, actor) {
  return updateRow('Evidencia_Mantenimientos', deviceId, {
    FechaTrabajo: metadata.FechaTrabajo,
    TecnicoIDsJSON: metadata.TecnicoIDsJSON,
    Tecnicos: metadata.Tecnicos,
    ActualizadoPor: actor,
    FechaActualizacion: nowIso(),
  });
}

async function deviceCreate(ctx) {
  await ensureSheetColumns('Evidencia_Mantenimientos', DEVICE_WORK_COLUMNS);
  const metadata = await resolveDeviceWorkMetadata(ctx.payload);
  const requestedId = clean(pick(ctx.payload, ['deviceId', 'EvidenciaMantenimientoID']));
  const id = requestedId || uuid();
  const existing = (await readTable('Evidencia_Mantenimientos', { force: true }))
    .find((item) => String(item.EvidenciaMantenimientoID) === id);
  if (existing) return persistMetadata(id, metadata, ctx.user.UsuarioID);

  const answers = parseAnswers(ctx.payload);
  const category = normalizeCategory(pick(ctx.payload, ['TipoDispositivo', 'Categoria', 'categoria']));
  const row = {
    EvidenciaMantenimientoID: id,
    MantenimientoRef: metadata.maintenanceId,
    UbicacionEquipoID: pick(ctx.payload, ['UbicacionEquipoID', 'ubicacionEquipoId']),
    Zona: pick(ctx.payload, ['Zona', 'zona']),
    Categoria: category,
    NombreDispositivo: pick(ctx.payload, ['NombreDispositivo', 'nombre']),
    TipoDispositivoID: pick(ctx.payload, ['TipoDispositivoID', 'tipoDispositivoId']),
    TipoDispositivo: category,
    FabricanteID: pick(ctx.payload, ['FabricanteID', 'fabricanteId']),
    Fabricante: pick(ctx.payload, ['Fabricante', 'fabricante']),
    ModeloID: pick(ctx.payload, ['ModeloID', 'modeloId']),
    Modelo: pick(ctx.payload, ['Modelo', 'modelo']),
    Serie: pick(ctx.payload, ['Serie', 'serie']),
    Funcionamiento: pick(ctx.payload, ['Funcionamiento', 'funcionamiento']),
    EnUso: pick(ctx.payload, ['EnUso', 'enUso']),
    Estado: pick(ctx.payload, ['Estado', 'estado']),
    Observacion: pick(ctx.payload, ['Observacion', 'observacion']),
    RespuestasJSON: JSON.stringify(answers),
    ...Object.fromEntries(Object.entries(answers).map(([key, value]) => [key.charAt(0).toUpperCase() + key.slice(1), value])),
    FechaTrabajo: metadata.FechaTrabajo,
    TecnicoIDsJSON: metadata.TecnicoIDsJSON,
    Tecnicos: metadata.Tecnicos,
    Activo: true,
    CreadoPor: ctx.user.UsuarioID,
    FechaCreacion: nowIso(),
    ActualizadoPor: ctx.user.UsuarioID,
    FechaActualizacion: nowIso(),
  };
  await appendRow('Evidencia_Mantenimientos', row);
  return row;
}

async function deviceUpdate(ctx) {
  await ensureSheetColumns('Evidencia_Mantenimientos', DEVICE_WORK_COLUMNS);
  const id = clean(pick(ctx.payload, ['deviceId', 'EvidenciaMantenimientoID']));
  const before = await findById('Evidencia_Mantenimientos', id);
  const metadata = await resolveDeviceWorkMetadata(ctx.payload, before);
  await maintenanceHandlers.deviceUpdate(contextWithMetadata(ctx, metadata));
  return persistMetadata(id, metadata, ctx.user.UsuarioID);
}

async function deviceAutosave(ctx) {
  await ensureSheetColumns('Evidencia_Mantenimientos', DEVICE_WORK_COLUMNS);
  const id = clean(pick(ctx.payload, ['deviceId', 'EvidenciaMantenimientoID']));
  const before = await findById('Evidencia_Mantenimientos', id);
  const metadata = await resolveDeviceWorkMetadata(ctx.payload, before);
  const base = await maintenanceHandlers.deviceAutosave(contextWithMetadata(ctx, metadata));
  const saved = await persistMetadata(id, metadata, ctx.user.UsuarioID);
  return { ...saved, autosaved: true, metadataSaved: true, throttled: Boolean(base?.throttled) };
}

async function refreshReusedSignedReports(ctx, ticketGeneration) {
  const reusedTickets = (ticketGeneration?.tickets || []).filter((ticket) => ticket.reused);
  const refreshed = [];
  for (const ticket of reusedTickets) {
    const systemContext = {
      ...ctx,
      permissions: [...new Set([...(ctx.permissions || []), 'USUARIOS_GESTIONAR', 'BOLETAS_VER', 'BOLETAS_EDITAR'])],
      payload: { boletaUid: ticket.ticketId, BoletaUID: ticket.ticketId, id: ticket.ticketId },
    };
    const report = await ticketDeliveryHandlers.generatePdf(systemContext);
    refreshed.push({ ticketId: ticket.ticketId, pdfUrl: report.pdfUrl || '', signatureIncluded: true });
  }
  return refreshed;
}

async function finalize(ctx) {
  const maintenanceId = clean(pick(ctx.payload, ['maintenanceId', 'MantenimientoID', 'id']));
  const testMode = Boolean(ctx.payload.testMode || ctx.payload.prueba);
  if (testMode) return maintenanceReportAccessHandlers.finalize(ctx);

  const maintenance = await findById('Mantenimiento', maintenanceId);
  if (!maintenanceHasSignature(maintenance)) {
    const request = await ensureMaintenanceSignatureRequest({ maintenanceId, origin: ctx.origin, actor: ctx.user.UsuarioID, testMode: false });
    throw new AppError('MAINTENANCE_SIGNATURE_REQUIRED', 'El cliente debe firmar el mantenimiento general antes de finalizarlo y generar las boletas automáticas.', 409, { signatureUrl: request.url, maintenanceId });
  }

  await ensureSheetColumns('Mantenimiento', MAINTENANCE_TICKET_COLUMNS);
  let ticketGeneration;
  let refreshedSignedReports = [];
  try {
    ticketGeneration = await generateMaintenanceTickets(ctx, maintenanceId);
    refreshedSignedReports = await refreshReusedSignedReports(ctx, ticketGeneration);
  } catch (error) {
    await updateRow('Mantenimiento', maintenanceId, {
      EstadoBoletasMantenimiento: 'ERROR',
      UltimoErrorBoletasMantenimiento: String(error?.message || error).slice(0, 1500),
      ActualizadoPor: ctx.user.UsuarioID,
      FechaActualizacion: nowIso(),
    }).catch(() => {});
    throw error;
  }

  const result = await maintenanceReportAccessHandlers.finalize(ctx);
  return {
    ...result,
    ticketGeneration: { ...ticketGeneration, refreshedSignedReports },
    message: `Mantenimiento finalizado. La firma general del cliente fue aplicada y se generaron y enviaron ${ticketGeneration.ticketCount} boleta(s) por fecha y grupo técnico.${refreshedSignedReports.length ? ` Se regeneraron ${refreshedSignedReports.length} PDF(s) anteriores con la firma.` : ''}`,
  };
}

async function ticketGenerationTest(ctx) {
  if (!isAdmin(ctx)) throw forbidden('Solo los administradores pueden probar las boletas automáticas.');
  const maintenanceId = clean(pick(ctx.payload, ['maintenanceId', 'MantenimientoID', 'id']));
  return previewMaintenanceTicketsWithDocuments(ctx, maintenanceId);
}

async function slidesReport(ctx) {
  if (!isAdmin(ctx)) throw forbidden('Solo los administradores pueden crear presentaciones de mantenimiento.');
  const maintenanceId = clean(pick(ctx.payload, ['maintenanceId', 'MantenimientoID', 'id']));
  if (!maintenanceId) throw badRequest('No se indicó el mantenimiento para crear la presentación.');
  const data = await maintenanceHandlers.get({ ...ctx, payload: { maintenanceId } });
  const result = await generateMaintenancePresentationWithAppsScript({
    maintenance: data.mantenimiento,
    devices: data.dispositivos || [],
    baseFolderId: pick(ctx.payload, ['baseFolderId', 'folderId']),
    actor: ctx.user,
  });
  await updateRow('Mantenimiento', maintenanceId, {
    SlidesID: result.slidesId,
    SlidesURL: result.slidesUrl,
    ActualizadoPor: ctx.user.UsuarioID,
    FechaActualizacion: nowIso(),
  });
  return { ...result, message: `Presentación creada con ${result.slideCount || 0} diapositivas y ${result.imageCount || 0} imágenes.` };
}

export const maintenanceAutomationHandlers = {
  ...maintenanceHandlers,
  ...maintenanceReportAccessHandlers,
  deviceCreate,
  deviceUpdate,
  deviceAutosave,
  finalize,
  ticketGenerationTest,
  slidesReport,
};