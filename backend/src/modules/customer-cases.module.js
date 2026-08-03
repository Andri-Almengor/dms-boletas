import crypto from 'node:crypto';
import { AppError, badRequest, notFound } from '../core/errors.js';
import { nowIso, pick, uuid } from '../core/utils.js';
import {
  appendRow,
  appendRows,
  findById,
  readTable,
  readTables,
  updateRow,
} from '../infra/sheets.repository.js';
import {
  createFolder,
  downloadAsDataUrl,
  trashFile,
  uploadBase64,
} from '../infra/drive.repository.js';
import { env } from '../config/env.js';
import { getConfig } from './config.module.js';
import { ticketMultiHandlers } from './ticket-multi.module.js';
import { ensureCustomerCaseSchema } from '../services/customer-case-schema.service.js';
import {
  generateAssignedCaseEmail,
  generateInitialCaseEmail,
} from '../services/customer-case-gemini.service.js';
import {
  sendAssignedCustomerCaseEmail,
  sendNewCustomerCaseEmail,
} from '../services/customer-case-email.service.js';
import { reconcileCustomerCases } from '../services/customer-case-sync.service.js';

const MAX_EVIDENCES = 8;
const MAX_FILE_BYTES = 6 * 1024 * 1024;
const MAX_TOTAL_BYTES = 22 * 1024 * 1024;
const ALLOWED_IMAGE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
]);

let caseCreateTail = Promise.resolve();

function withCaseCreateLock(operation) {
  const current = caseCreateTail.then(operation, operation);
  caseCreateTail = current.catch(() => {});
  return current;
}

function clean(value, maxLength = 12000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'si', 'sí', 'yes', 'activo'].includes(clean(value, 20).toLowerCase());
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value, 320).toLowerCase());
}

function normalizeState(value) {
  const state = clean(value, 40).toUpperCase().replace(/[\s-]+/g, '_');
  if (['EN_ESPERA', 'ESPERA', 'PENDIENTE'].includes(state)) return 'EN_ESPERA';
  if (['EN_PROCESO', 'PROCESO'].includes(state)) return 'EN_PROCESO';
  if (['FINALIZADO', 'FINALIZADA', 'FINAL'].includes(state)) return 'FINALIZADO';
  return 'EN_ESPERA';
}

function parseArray(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(clean(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return clean(value).split(/[;,]/).map((item) => item.trim()).filter(Boolean);
  }
}

function publicBaseUrl(origin = '') {
  return clean(env.appPublicUrl || origin, 1000).replace(/\/$/, '');
}

function casePortalUrl(token, origin = '') {
  const base = publicBaseUrl(origin);
  return base ? `${base}/caso/${encodeURIComponent(token)}` : `/caso/${encodeURIComponent(token)}`;
}

function ticketUrl(ticketId, origin = '') {
  const base = publicBaseUrl(origin);
  return base ? `${base}/boletas/${encodeURIComponent(ticketId)}` : `/boletas/${encodeURIComponent(ticketId)}`;
}

function clientName(client = {}) {
  return clean(pick(client, ['Clientes', 'Cliente', 'Nombre'], 'Cliente'), 250);
}

function activeClient(client = {}) {
  const state = clean(client.Estado || 'ACTIVO').toUpperCase();
  return client.Activo !== false && state !== 'INACTIVO';
}

function activePortal(client = {}) {
  return activeClient(client) && booleanValue(client.PortalCasosActivo, true);
}

function createPortalToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function nextCaseNumber(rows = []) {
  const highest = rows.reduce((max, row) => {
    const value = Number(String(row.CasoNumero || '').replace(/\D/g, ''));
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, 0);
  return `CAS-${String(highest + 1).padStart(6, '0')}`;
}

function validRequestId(value) {
  return /^[A-Za-z0-9._:-]{8,160}$/.test(clean(value, 200));
}

function sanitizedBase64(value) {
  const text = clean(value, 40_000_000);
  const comma = text.indexOf(',');
  return comma >= 0 && text.slice(0, comma).includes('base64') ? text.slice(comma + 1) : text;
}

function evidenceInput(value, index) {
  const mimeType = clean(value?.mimeType || value?.type, 120).toLowerCase();
  const base64 = sanitizedBase64(value?.base64 || value?.dataUrl || value?.fileBase64);
  const fileName = clean(value?.fileName || value?.name || `evidencia-${index + 1}.jpg`, 220);
  if (!ALLOWED_IMAGE_MIME.has(mimeType)) throw badRequest(`La evidencia ${fileName} no es una imagen permitida.`);
  if (!base64 || !/^[A-Za-z0-9+/=\r\n]+$/.test(base64)) throw badRequest(`La evidencia ${fileName} no contiene datos válidos.`);
  const bytes = Buffer.from(base64, 'base64').length;
  if (!bytes) throw badRequest(`La evidencia ${fileName} está vacía.`);
  if (bytes > MAX_FILE_BYTES) throw badRequest(`La evidencia ${fileName} supera el límite de 6 MB.`);
  return { base64, mimeType, fileName, bytes, note: clean(value?.note || value?.nota, 1000) };
}

function validateEvidences(values = []) {
  const source = Array.isArray(values) ? values : [];
  if (source.length > MAX_EVIDENCES) throw badRequest(`Puede adjuntar un máximo de ${MAX_EVIDENCES} imágenes.`);
  const evidences = source.map(evidenceInput);
  const total = evidences.reduce((sum, item) => sum + item.bytes, 0);
  if (total > MAX_TOTAL_BYTES) throw badRequest('Las evidencias superan el límite total de 22 MB.');
  return evidences;
}

async function findClientByToken(token) {
  const requested = clean(token, 200);
  if (requested.length < 32) throw notFound('El enlace del formulario no es válido.');
  await ensureCustomerCaseSchema();
  const clients = await readTable('Clientes');
  const client = clients.find((item) => clean(item.PortalCasosToken, 200) === requested);
  if (!client || !activePortal(client)) throw notFound('Este enlace no está disponible. Solicite uno nuevo a DMS.');
  return client;
}

function caseView(item = {}) {
  return {
    ...item,
    CasoID: clean(item.CasoID),
    CasoNumero: clean(item.CasoNumero),
    Estado: normalizeState(item.Estado),
    TecnicoIDs: parseArray(item.TecnicoIDsJSON),
    EvidenciaCount: Number(item.EvidenciaCount || 0),
    Activo: item.Activo !== false,
  };
}

async function evidenceRows(caseId) {
  const rows = await readTable('CasoEvidencias');
  return rows.filter((row) => clean(row.CasoID) === clean(caseId) && row.Activo !== false);
}

async function notificationRecord({ caseId, channel, destination, type, result = null, error = null, actor = 'SISTEMA' }) {
  await appendRow('Notificaciones', {
    NotificacionID: uuid(),
    Entidad: 'CASO_CLIENTE',
    EntidadID: caseId,
    Canal: channel,
    Destino: clean(destination, 1000),
    Tipo: type,
    Estado: error ? 'ERROR' : 'ENVIADO',
    Intentos: 1,
    Respuesta: result ? JSON.stringify(result).slice(0, 1500) : '',
    Error: error ? clean(error.message || error, 1500) : '',
    FechaCreacion: nowIso(),
    FechaEnvio: error ? '' : nowIso(),
    CreadoPor: actor,
  }).catch(() => {});
}

async function casesRootFolder() {
  const config = await getConfig().catch(() => ({}));
  const configured = clean(
    process.env.CUSTOMER_CASES_FOLDER_ID
      || config.CUSTOMER_CASES_FOLDER_ID
      || config.CARPETA_CASOS_CLIENTES_ID,
    250,
  );
  return createFolder('Casos de clientes DMS', configured || undefined);
}

async function uploadCaseEvidences({ caseData, client, evidences }) {
  if (!evidences.length) return { rows: [], folder: null, failed: [] };
  const root = await casesRootFolder();
  const clientFolder = await createFolder(clientName(client), root.id);
  const caseFolder = await createFolder(`${caseData.CasoNumero} - ${clean(caseData.RazonVisita, 80)}`, clientFolder.id);
  const rows = [];
  const failed = [];

  for (let index = 0; index < evidences.length; index += 1) {
    const evidence = evidences[index];
    let file = null;
    try {
      file = await uploadBase64({
        base64: evidence.base64,
        mimeType: evidence.mimeType,
        fileName: `${String(index + 1).padStart(2, '0')} - ${evidence.fileName}`,
        folderId: caseFolder.id,
      });
      rows.push({
        CasoEvidenciaID: uuid(),
        CasoID: caseData.CasoID,
        ClienteID: caseData.ClienteID,
        NombreArchivo: evidence.fileName,
        MimeType: evidence.mimeType,
        TamanoBytes: evidence.bytes,
        DriveFileID: file.id,
        DriveURL: file.webViewLink || '',
        Nota: evidence.note,
        FechaCreacion: nowIso(),
        CreadoPor: 'CLIENTE',
        Activo: true,
      });
    } catch (error) {
      if (file?.id) await trashFile(file.id).catch(() => {});
      failed.push({ fileName: evidence.fileName, message: clean(error.message || error, 500) });
    }
  }

  if (rows.length) await appendRows('CasoEvidencias', rows);
  return { rows, folder: caseFolder, failed };
}

async function sendInitialNotification(caseData, evidences) {
  const generated = await generateInitialCaseEmail(caseData);
  let result = null;
  let error = null;
  try {
    result = await sendNewCustomerCaseEmail({ caseData, evidences, message: generated });
  } catch (sendError) {
    error = sendError;
  }
  await notificationRecord({
    caseId: caseData.CasoID,
    channel: 'CORREO',
    destination: 'Coordinación DMS',
    type: 'CASO_CREADO',
    result,
    error,
    actor: 'CLIENTE',
  });
  const updated = await updateRow('CasosClientes', caseData.CasoID, {
    AsuntoCorreoInicial: generated.subject,
    CuerpoCorreoInicial: generated.body,
    GeminiModeloInicial: generated.model || '',
    GeminiUsadoInicial: generated.generatedByGemini,
    EstadoNotificacionInicial: error ? 'ERROR' : 'ENVIADO',
    UltimoErrorNotificacion: error ? clean(error.message || error, 1500) : generated.warning || '',
    FechaActualizacion: nowIso(),
    ActualizadoPor: 'CLIENTE',
  });
  return { caseData: updated, generated, result, error };
}

async function techniciansFromIds(ids = []) {
  const requested = [...new Set(ids.map((value) => clean(value, 200)).filter(Boolean))];
  if (!requested.length) throw badRequest('Seleccione al menos un técnico.');
  const users = await readTable('Usuarios');
  const technicians = requested.map((id) => users.find((user) => clean(user.UsuarioID) === id)).filter(Boolean);
  if (technicians.length !== requested.length) throw badRequest('Uno o más técnicos seleccionados ya no existen.');
  const inactive = technicians.filter((user) => user.Activo === false || clean(user.Estado || 'ACTIVO').toUpperCase() === 'INACTIVO');
  if (inactive.length) throw badRequest('Uno o más técnicos seleccionados están inactivos.');
  const withoutEmail = technicians.filter((user) => !validEmail(user.Correo));
  if (withoutEmail.length) {
    const names = withoutEmail.map((user) => clean(user.NombreCompleto || user.NombreUsuario || user.UsuarioID, 150)).join(', ');
    throw badRequest(`Los siguientes técnicos no tienen un correo válido: ${names}.`);
  }
  return technicians.map((user) => ({
    ...user,
    Nombre: clean(user.NombreCompleto || user.Nombre || user.NombreUsuario || user.UsuarioID, 180),
  }));
}

function ticketFromResult(result = {}) {
  return result.boleta || result.item || result.data || result;
}

async function sendTechnicianNotification({ caseData, evidences, technicians, ctx }) {
  const url = ticketUrl(caseData.BoletaUID, ctx.origin);
  const generated = await generateAssignedCaseEmail(caseData, {
    technicians,
    visitDate: caseData.FechaVisita,
    visitTime: caseData.HoraVisita,
    adminMessage: caseData.MensajeAdministrador,
    ticketId: caseData.BoletaUID,
    ticketNumber: caseData.BoletaID,
    ticketUrl: url,
  });
  let result = null;
  let error = null;
  try {
    result = await sendAssignedCustomerCaseEmail({
      caseData,
      evidences,
      message: generated,
      technicians,
      ticketUrl: url,
    });
  } catch (sendError) {
    error = sendError;
  }
  await notificationRecord({
    caseId: caseData.CasoID,
    channel: 'CORREO',
    destination: technicians.map((item) => item.Correo).join(', '),
    type: 'CASO_ASIGNADO',
    result,
    error,
    actor: ctx.user.UsuarioID,
  });
  const updated = await updateRow('CasosClientes', caseData.CasoID, {
    AsuntoCorreoTecnicos: generated.subject,
    CuerpoCorreoTecnicos: generated.body,
    GeminiModeloTecnicos: generated.model || '',
    GeminiUsadoTecnicos: generated.generatedByGemini,
    EstadoNotificacionTecnicos: error ? 'ERROR' : 'ENVIADO',
    UltimoErrorNotificacion: error ? clean(error.message || error, 1500) : generated.warning || '',
    FechaActualizacion: nowIso(),
    ActualizadoPor: ctx.user.UsuarioID,
  });
  return { caseData: updated, generated, result, error, ticketUrl: url };
}

async function detailBundle(caseId, origin = '') {
  const item = caseView(await findById('CasosClientes', caseId));
  const [evidences, users, tickets] = await Promise.all([
    evidenceRows(item.CasoID),
    readTable('Usuarios'),
    readTable('Boletas'),
  ]);
  const ids = new Set(item.TecnicoIDs);
  const technicians = users
    .filter((user) => ids.has(clean(user.UsuarioID)))
    .map((user) => ({
      UsuarioID: user.UsuarioID,
      Nombre: clean(user.NombreCompleto || user.Nombre || user.NombreUsuario || user.UsuarioID, 180),
      Correo: clean(user.Correo, 320),
    }));
  const ticket = tickets.find((row) => clean(row.BoletaUID) === clean(item.BoletaUID)) || null;
  return {
    case: item,
    evidences,
    technicians,
    ticket,
    ticketUrl: item.BoletaUID ? ticketUrl(item.BoletaUID, origin) : '',
  };
}

async function createPublicCase(ctx, client) {
  const requestId = clean(pick(ctx.payload, ['requestId', 'SolicitudClienteID']), 200);
  if (!validRequestId(requestId)) throw badRequest('No se pudo validar el envío. Actualice la página y vuelva a intentarlo.');
  const reason = clean(pick(ctx.payload, ['reason', 'case', 'caso', 'razonVisita', 'RazonVisita']), 2000);
  const problem = clean(pick(ctx.payload, ['problem', 'problema', 'descripcion', 'Descripcion']), 8000);
  const email = clean(pick(ctx.payload, ['email', 'correo', 'CorreoSolicitante']), 320).toLowerCase();
  const requester = clean(pick(ctx.payload, ['requesterName', 'name', 'nombre', 'NombreSolicitante']), 250);
  if (!reason) throw badRequest('Escriba la razón de la visita.');
  if (!problem) throw badRequest('Describa el problema que presenta.');
  if (!requester) throw badRequest('Escriba el nombre de quien genera el caso.');
  if (!validEmail(email)) throw badRequest('Escriba un correo electrónico válido.');
  if (clean(ctx.payload.website, 200)) return { accepted: true, caseNumber: '', message: 'Solicitud recibida.' };
  const evidences = validateEvidences(ctx.payload.evidences || ctx.payload.evidencias || []);

  return withCaseCreateLock(async () => {
    const rows = await readTable('CasosClientes', { force: true });
    const duplicate = rows.find((item) => clean(item.SolicitudClienteID) === requestId && clean(item.ClienteID) === clean(client.ClienteID));
    if (duplicate) {
      return {
        accepted: true,
        alreadyCreated: true,
        caseId: duplicate.CasoID,
        caseNumber: duplicate.CasoNumero,
        evidenceCount: Number(duplicate.EvidenciaCount || 0),
        notificationSent: clean(duplicate.EstadoNotificacionInicial).toUpperCase() === 'ENVIADO',
        message: `El caso ${duplicate.CasoNumero} ya había sido recibido correctamente.`,
      };
    }

    const timestamp = nowIso();
    let caseData = {
      CasoID: uuid(),
      CasoNumero: nextCaseNumber(rows),
      SolicitudClienteID: requestId,
      ClienteID: client.ClienteID,
      Cliente: clientName(client),
      RazonVisita: reason,
      Problema: problem,
      CorreoSolicitante: email,
      NombreSolicitante: requester,
      Estado: 'EN_ESPERA',
      EvidenciaCount: 0,
      TecnicoIDsJSON: '[]',
      TecnicoNombres: '',
      FechaVisita: '',
      HoraVisita: '',
      MensajeAdministrador: '',
      BoletaUID: '',
      BoletaID: '',
      AsuntoCorreoInicial: '',
      CuerpoCorreoInicial: '',
      AsuntoCorreoTecnicos: '',
      CuerpoCorreoTecnicos: '',
      EstadoNotificacionInicial: 'PENDIENTE',
      EstadoNotificacionTecnicos: 'PENDIENTE',
      UltimoErrorNotificacion: '',
      FechaProceso: '',
      FechaFinalizacion: '',
      FechaCreacion: timestamp,
      FechaActualizacion: timestamp,
      CreadoPor: 'CLIENTE',
      ActualizadoPor: 'CLIENTE',
      Activo: true,
    };
    await appendRow('CasosClientes', caseData);

    const uploaded = await uploadCaseEvidences({ caseData, client, evidences });
    caseData = await updateRow('CasosClientes', caseData.CasoID, {
      EvidenciaCount: uploaded.rows.length,
      CarpetaDriveID: uploaded.folder?.id || '',
      CarpetaDriveURL: uploaded.folder?.webViewLink || '',
      UltimoErrorNotificacion: uploaded.failed.length
        ? `No se pudieron subir ${uploaded.failed.length} evidencia(s): ${uploaded.failed.map((item) => item.fileName).join(', ')}`
        : '',
      FechaActualizacion: nowIso(),
    });

    const notification = await sendInitialNotification(caseData, uploaded.rows);
    return {
      accepted: true,
      alreadyCreated: false,
      caseId: caseData.CasoID,
      caseNumber: caseData.CasoNumero,
      evidenceCount: uploaded.rows.length,
      failedEvidenceCount: uploaded.failed.length,
      notificationSent: !notification.error,
      generatedByGemini: notification.generated.generatedByGemini,
      message: `El caso ${caseData.CasoNumero} fue creado correctamente y quedó en espera de revisión.`,
    };
  });
}

export const customerCaseHandlers = {
  publicGet: async (ctx) => {
    const client = await findClientByToken(pick(ctx.payload, ['token', 'portalToken']));
    return {
      client: {
        id: client.ClienteID,
        name: clientName(client),
      },
      limits: {
        maxImages: MAX_EVIDENCES,
        maxFileMb: MAX_FILE_BYTES / 1024 / 1024,
        maxTotalMb: MAX_TOTAL_BYTES / 1024 / 1024,
      },
      reusable: true,
    };
  },

  publicSubmit: async (ctx) => {
    const client = await findClientByToken(pick(ctx.payload, ['token', 'portalToken']));
    return createPublicCase(ctx, client);
  },

  clientLink: async (ctx) => {
    await ensureCustomerCaseSchema();
    const clientId = clean(pick(ctx.payload, ['clientId', 'ClienteID', 'id']), 200);
    const client = await findById('Clientes', clientId);
    if (!activeClient(client)) throw badRequest('El cliente está inactivo.');
    const rotate = booleanValue(ctx.payload.rotate, false);
    const token = rotate || !clean(client.PortalCasosToken)
      ? createPortalToken()
      : clean(client.PortalCasosToken, 200);
    const timestamp = nowIso();
    const updated = await updateRow('Clientes', clientId, {
      PortalCasosToken: token,
      PortalCasosActivo: true,
      PortalCasosCreadoEn: clean(client.PortalCasosCreadoEn) || timestamp,
      PortalCasosActualizadoEn: timestamp,
    });
    return {
      clientId,
      clientName: clientName(updated),
      token,
      active: true,
      url: casePortalUrl(token, ctx.origin),
      rotated: rotate,
    };
  },

  clientLinkStatus: async (ctx) => {
    await ensureCustomerCaseSchema();
    const clientId = clean(pick(ctx.payload, ['clientId', 'ClienteID', 'id']), 200);
    const client = await findById('Clientes', clientId);
    const token = clean(client.PortalCasosToken, 200);
    return {
      clientId,
      clientName: clientName(client),
      configured: Boolean(token),
      active: Boolean(token) && activePortal(client),
      url: token ? casePortalUrl(token, ctx.origin) : '',
    };
  },

  clientLinkUpdate: async (ctx) => {
    await ensureCustomerCaseSchema();
    const clientId = clean(pick(ctx.payload, ['clientId', 'ClienteID', 'id']), 200);
    const client = await findById('Clientes', clientId);
    const active = booleanValue(ctx.payload.active, true);
    const updated = await updateRow('Clientes', clientId, {
      PortalCasosActivo: active,
      PortalCasosActualizadoEn: nowIso(),
    });
    const token = clean(updated.PortalCasosToken || client.PortalCasosToken, 200);
    return {
      clientId,
      active: Boolean(token) && active,
      configured: Boolean(token),
      url: token ? casePortalUrl(token, ctx.origin) : '',
    };
  },

  list: async (ctx) => {
    await ensureCustomerCaseSchema();
    await reconcileCustomerCases(ctx.user.UsuarioID).catch((error) => {
      console.warn(`[customer-cases] No se pudo reconciliar el cierre: ${error.message}`);
    });
    let rows = (await readTable('CasosClientes')).filter((row) => row.Activo !== false).map(caseView);
    const state = clean(pick(ctx.payload, ['status', 'estado']), 50);
    const clientId = clean(pick(ctx.payload, ['clientId', 'ClienteID']), 200);
    const search = clean(pick(ctx.payload, ['search', 'q']), 300).toLowerCase();
    if (state) rows = rows.filter((row) => normalizeState(row.Estado) === normalizeState(state));
    if (clientId) rows = rows.filter((row) => clean(row.ClienteID) === clientId);
    if (search) rows = rows.filter((row) => `${row.CasoNumero} ${row.Cliente} ${row.RazonVisita} ${row.Problema} ${row.NombreSolicitante} ${row.CorreoSolicitante}`.toLowerCase().includes(search));
    rows.sort((a, b) => clean(b.FechaCreacion).localeCompare(clean(a.FechaCreacion)));
    const all = (await readTable('CasosClientes')).filter((row) => row.Activo !== false).map(caseView);
    const counts = {
      EN_ESPERA: all.filter((row) => row.Estado === 'EN_ESPERA').length,
      EN_PROCESO: all.filter((row) => row.Estado === 'EN_PROCESO').length,
      FINALIZADO: all.filter((row) => row.Estado === 'FINALIZADO').length,
      TOTAL: all.length,
    };
    const page = Math.max(1, Number(ctx.payload.page || 1));
    const pageSize = Math.min(200, Math.max(1, Number(ctx.payload.pageSize || 60)));
    return {
      items: rows.slice((page - 1) * pageSize, page * pageSize),
      total: rows.length,
      page,
      pageSize,
      counts,
    };
  },

  get: async (ctx) => {
    await ensureCustomerCaseSchema();
    await reconcileCustomerCases(ctx.user.UsuarioID).catch(() => {});
    return detailBundle(pick(ctx.payload, ['caseId', 'CasoID', 'id']), ctx.origin);
  },

  process: async (ctx) => {
    await ensureCustomerCaseSchema();
    const caseId = clean(pick(ctx.payload, ['caseId', 'CasoID', 'id']), 200);
    const before = caseView(await findById('CasosClientes', caseId));
    if (before.Estado === 'FINALIZADO') throw badRequest('El caso ya está finalizado.');
    const technicianIds = parseArray(ctx.payload.technicianIds || ctx.payload.TecnicoIDs || ctx.payload.assignedTo);
    const technicians = await techniciansFromIds(technicianIds);
    const visitDate = clean(pick(ctx.payload, ['visitDate', 'FechaVisita', 'fecha']), 20);
    const visitTime = clean(pick(ctx.payload, ['visitTime', 'HoraVisita', 'hora']), 20);
    const adminMessage = clean(pick(ctx.payload, ['adminMessage', 'MensajeAdministrador', 'message']), 4000);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(visitDate)) throw badRequest('Seleccione una fecha válida para la visita.');
    if (visitTime && !/^\d{2}:\d{2}$/.test(visitTime)) throw badRequest('Seleccione una hora válida.');

    const deterministicTicketId = clean(before.BoletaUID) || `caso-${before.CasoID}`;
    const ticketResult = await ticketMultiHandlers.create({
      ...ctx,
      payload: {
        boletaUid: deterministicTicketId,
        BoletaUID: deterministicTicketId,
        Titulo: clean(before.AsuntoCorreoInicial || `${before.CasoNumero} - ${before.RazonVisita}`, 100),
        Estado: 'PENDIENTE',
        Fecha: visitDate,
        HoraInicio: visitTime,
        HoraFinal: '',
        HorasTotales: 0,
        ClienteID: before.ClienteID,
        Cliente: before.Cliente,
        CorreoCliente: before.CorreoSolicitante,
        RazonVisita: before.RazonVisita,
        Descripcion: before.Problema,
        AsignadoA: technicians.map((item) => item.UsuarioID),
        OrigenCasoID: before.CasoID,
      },
    });
    const ticket = ticketFromResult(ticketResult);
    let caseData = await updateRow('CasosClientes', caseId, {
      Estado: 'EN_PROCESO',
      TecnicoIDsJSON: JSON.stringify(technicians.map((item) => item.UsuarioID)),
      TecnicoNombres: technicians.map((item) => item.Nombre).join(', '),
      FechaVisita: visitDate,
      HoraVisita: visitTime,
      MensajeAdministrador: adminMessage,
      BoletaUID: ticket.BoletaUID || deterministicTicketId,
      BoletaID: ticket.BoletaID || '',
      FechaProceso: clean(before.FechaProceso) || nowIso(),
      FechaActualizacion: nowIso(),
      ActualizadoPor: ctx.user.UsuarioID,
      EstadoNotificacionTecnicos: 'PENDIENTE',
      UltimoErrorNotificacion: '',
    });
    const evidences = await evidenceRows(caseId);
    const notification = await sendTechnicianNotification({ caseData, evidences, technicians, ctx });
    caseData = notification.caseData;
    return {
      ...(await detailBundle(caseId, ctx.origin)),
      notificationSent: !notification.error,
      generatedByGemini: notification.generated.generatedByGemini,
      notificationWarning: notification.error
        ? clean(notification.error.message || notification.error, 1000)
        : notification.generated.warning,
    };
  },

  resendTechnicians: async (ctx) => {
    await ensureCustomerCaseSchema();
    const caseId = clean(pick(ctx.payload, ['caseId', 'CasoID', 'id']), 200);
    const caseData = caseView(await findById('CasosClientes', caseId));
    if (caseData.Estado !== 'EN_PROCESO' || !caseData.BoletaUID) throw badRequest('El caso todavía no tiene una boleta en proceso.');
    const technicians = await techniciansFromIds(caseData.TecnicoIDs);
    const evidences = await evidenceRows(caseId);
    const notification = await sendTechnicianNotification({ caseData, evidences, technicians, ctx });
    return {
      sent: !notification.error,
      warning: notification.error
        ? clean(notification.error.message || notification.error, 1000)
        : notification.generated.warning,
      case: caseView(notification.caseData),
    };
  },

  mediaGet: async (ctx) => {
    await ensureCustomerCaseSchema();
    const evidence = await findById('CasoEvidencias', pick(ctx.payload, ['evidenceId', 'CasoEvidenciaID', 'id']));
    const caseId = clean(pick(ctx.payload, ['caseId', 'CasoID']));
    if (caseId && clean(evidence.CasoID) !== caseId) throw notFound('La evidencia no pertenece al caso solicitado.');
    if (!evidence.DriveFileID) throw notFound('La evidencia no tiene un archivo asociado.');
    return downloadAsDataUrl(evidence.DriveFileID, evidence.MimeType || 'image/jpeg');
  },
};
