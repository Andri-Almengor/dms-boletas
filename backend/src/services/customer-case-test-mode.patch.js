import crypto from 'node:crypto';
import { badRequest, notFound } from '../core/errors.js';
import { nowIso, pick, uuid } from '../core/utils.js';
import {
  appendRow,
  appendRows,
  ensureColumns,
  findById,
  readTable,
  readTables,
  updateRow,
  updateRows,
} from '../infra/sheets.repository.js';
import { env } from '../config/env.js';
import { customerCaseHandlers } from '../modules/customer-cases.module.js';
import { ticketMultiHandlers } from '../modules/ticket-multi.module.js';
import { ticketDeliveryHandlers } from '../modules/ticket-delivery.module.js';
import { ticketAccessHandlers } from '../modules/ticket-access.module.js';
import { ensureCustomerCaseSchema } from './customer-case-schema.service.js';
import { generateInitialCaseEmail } from './customer-case-gemini.service.js';
import { sendNewCustomerCaseEmail } from './customer-case-email.service.js';
import { reconcileCustomerCases } from './customer-case-sync.service.js';
import {
  getCustomerCaseEvidenceFromAppsScript,
  uploadCustomerCaseEvidenceWithAppsScript,
} from './customer-case-apps-script-drive.service.js';
import { audit } from './audit.service.js';

const INSTALL_FLAG = Symbol.for('dms.customerCasesTestModeAndAppsScriptDrive');
const TEST_TICKET_FLAG = Symbol.for('dms.customerCaseTestTicketCreate');
const TEST_FINALIZE_FLAG = Symbol.for('dms.customerCaseTestTicketFinalize');
const TEST_RECIPIENT = 'andrick.almengor@solutionsdms.com';
const MAX_EVIDENCES = 8;
const MAX_FILE_BYTES = 6 * 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const ALLOWED_IMAGE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
]);

let schemaPromise = null;
let caseCreateTail = Promise.resolve();

function clean(value, maxLength = 12000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'si', 'sí', 'yes', 'activo', 'prueba'].includes(clean(value, 20).toLowerCase());
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

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value, 320).toLowerCase());
}

function activeClient(client = {}) {
  const state = clean(client.Estado || 'ACTIVO', 40).toUpperCase();
  return client.Activo !== false
    && state !== 'INACTIVO'
    && booleanValue(client.PortalCasosActivo, true);
}

function clientName(client = {}) {
  return clean(pick(client, ['Clientes', 'Cliente', 'Nombre'], 'Cliente'), 250);
}

function publicBaseUrl(origin = '') {
  return clean(env.appPublicUrl || origin, 1000).replace(/\/$/, '');
}

function casePortalUrl(token, origin = '') {
  const base = publicBaseUrl(origin);
  return base ? `${base}/caso/${encodeURIComponent(token)}` : `/caso/${encodeURIComponent(token)}`;
}

function createPortalToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function withCaseCreateLock(operation) {
  const current = caseCreateTail.then(operation, operation);
  caseCreateTail = current.catch(() => {});
  return current;
}

async function ensureModeSchema() {
  if (!schemaPromise) {
    schemaPromise = Promise.all([
      ensureCustomerCaseSchema(),
      ensureColumns('Clientes', [
        'PortalCasosPruebaToken',
        'PortalCasosPruebaCreadoEn',
        'PortalCasosPruebaActualizadoEn',
      ]),
      ensureColumns('CasosClientes', [
        'ModoPrueba',
        'TipoCaso',
        'EvidenciasSolicitadas',
        'EvidenciasFallidas',
        'UltimoErrorEvidencias',
      ]),
      ensureColumns('CasoEvidencias', [
        'HuellaArchivo',
        'Almacenamiento',
        'PropietarioDrive',
      ]),
      ensureColumns('Boletas', [
        'EsPrueba',
        'ModoPrueba',
      ]),
    ]).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

async function resolvePortal(token) {
  await ensureModeSchema();
  const requested = clean(token, 220);
  if (requested.length < 32) throw notFound('El enlace del formulario no es válido.');
  const clients = await readTable('Clientes');
  const realClient = clients.find((item) => clean(item.PortalCasosToken, 220) === requested);
  const testClient = clients.find((item) => clean(item.PortalCasosPruebaToken, 220) === requested);
  const client = realClient || testClient;
  if (!client || !activeClient(client)) {
    throw notFound('Este enlace no está disponible. Solicite uno nuevo a DMS.');
  }
  return { client, testMode: Boolean(testClient) };
}

function strictNextCaseNumber(rows = []) {
  const highest = rows.reduce((max, row) => {
    const match = clean(row.CasoNumero, 100).match(/^CAS-(\d+)$/i);
    if (!match) return max;
    const value = Number(match[1]);
    return Number.isInteger(value) ? Math.max(max, value) : max;
  }, 0);
  return `CAS-${String(highest + 1).padStart(6, '0')}`;
}

function testCaseNumber() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return `PRUEBA-CAS-${stamp}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

function validRequestId(value) {
  return /^[A-Za-z0-9._:-]{8,160}$/.test(clean(value, 200));
}

function normalizeBase64(value) {
  const text = clean(value, 40_000_000);
  const comma = text.indexOf(',');
  const encoded = comma >= 0 && text.slice(0, comma).includes('base64')
    ? text.slice(comma + 1)
    : text;
  return encoded.replace(/[\r\n\s]/g, '');
}

function mimeFromName(fileName) {
  const extension = clean(fileName, 250).toLowerCase().split('.').pop();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'heic') return 'image/heic';
  if (extension === 'heif') return 'image/heif';
  return '';
}

function evidenceInput(value, index) {
  const fileName = clean(value?.fileName || value?.name || `evidencia-${index + 1}.jpg`, 220);
  const mimeType = clean(value?.mimeType || value?.type || mimeFromName(fileName), 120).toLowerCase();
  const base64 = normalizeBase64(value?.base64 || value?.dataUrl || value?.fileBase64);
  if (!ALLOWED_IMAGE_MIME.has(mimeType)) {
    throw badRequest(`La evidencia ${fileName} no es una imagen permitida.`);
  }
  if (!base64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    throw badRequest(`La evidencia ${fileName} no contiene datos válidos.`);
  }
  const bytes = Buffer.from(base64, 'base64').length;
  if (!bytes) throw badRequest(`La evidencia ${fileName} está vacía.`);
  if (bytes > MAX_FILE_BYTES) throw badRequest(`La evidencia ${fileName} supera el límite de 6 MB.`);
  const fingerprint = crypto
    .createHash('sha256')
    .update(`${mimeType}|${fileName}|${bytes}|`)
    .update(base64)
    .digest('hex');
  return {
    base64,
    mimeType,
    fileName,
    bytes,
    fingerprint,
    note: clean(value?.note || value?.nota, 1000),
  };
}

function validateEvidences(values = []) {
  const source = Array.isArray(values) ? values : [];
  if (source.length > MAX_EVIDENCES) {
    throw badRequest(`Puede adjuntar un máximo de ${MAX_EVIDENCES} imágenes.`);
  }
  const evidences = source.map(evidenceInput);
  const total = evidences.reduce((sum, item) => sum + item.bytes, 0);
  if (total > MAX_TOTAL_BYTES) throw badRequest('Las evidencias superan el límite total de 16 MB.');
  return evidences;
}

function caseView(item = {}) {
  let technicianIds = item.TecnicoIDs || [];
  if (!Array.isArray(technicianIds)) technicianIds = parseArray(item.TecnicoIDsJSON);
  return {
    ...item,
    CasoID: clean(item.CasoID),
    CasoNumero: clean(item.CasoNumero),
    Estado: clean(item.Estado || 'EN_ESPERA').toUpperCase(),
    TecnicoIDs: technicianIds.map(String),
    EvidenciaCount: Number(item.EvidenciaCount || 0),
    EvidenciasSolicitadas: Number(item.EvidenciasSolicitadas || item.EvidenciaCount || 0),
    EvidenciasFallidas: Number(item.EvidenciasFallidas || 0),
    ModoPrueba: booleanValue(item.ModoPrueba || item.EsPrueba || item.TipoCaso, false),
    Activo: item.Activo !== false,
  };
}

function evidenceRowsForCase(rows, caseId) {
  return rows.filter((row) => clean(row.CasoID, 220) === clean(caseId, 220) && row.Activo !== false);
}

async function uploadCaseEvidences(caseData, requested) {
  let stored = evidenceRowsForCase(await readTable('CasoEvidencias', { force: true }), caseData.CasoID);
  const failed = [];
  let folder = null;

  for (let index = 0; index < requested.length; index += 1) {
    const evidence = requested[index];
    const existing = stored.find((row) => (
      clean(row.HuellaArchivo, 128) === evidence.fingerprint
      || (!clean(row.HuellaArchivo, 128)
        && clean(row.NombreArchivo, 250) === evidence.fileName
        && Number(row.TamanoBytes || 0) === evidence.bytes)
    ));
    if (existing) continue;

    try {
      const uploaded = await uploadCustomerCaseEvidenceWithAppsScript({
        caseData,
        evidence,
        index: stored.length + 1,
        fingerprint: evidence.fingerprint,
      });
      if (!uploaded?.id) throw new Error('Apps Script no devolvió el identificador del archivo.');
      folder = folder || {
        id: clean(uploaded.folderId, 250),
        webViewLink: clean(uploaded.folderUrl, 2000),
      };
      const row = {
        CasoEvidenciaID: `caso-evidencia-${evidence.fingerprint.slice(0, 32)}`,
        CasoID: caseData.CasoID,
        ClienteID: caseData.ClienteID,
        NombreArchivo: evidence.fileName,
        MimeType: evidence.mimeType,
        TamanoBytes: evidence.bytes,
        DriveFileID: uploaded.id,
        DriveURL: clean(uploaded.webViewLink || uploaded.url, 2000),
        Nota: evidence.note,
        HuellaArchivo: evidence.fingerprint,
        Almacenamiento: 'APPS_SCRIPT',
        PropietarioDrive: clean(uploaded.ownerEmail, 320) || TEST_RECIPIENT,
        FechaCreacion: nowIso(),
        CreadoPor: 'CLIENTE',
        Activo: true,
      };
      await appendRow('CasoEvidencias', row);
      stored.push(row);
    } catch (error) {
      failed.push({
        fileName: evidence.fileName,
        message: clean(error?.message || error, 800),
      });
    }
  }

  stored = evidenceRowsForCase(await readTable('CasoEvidencias', { force: true }), caseData.CasoID);
  return { rows: stored, failed, folder };
}

async function recordNotification({ caseId, destination, result, error, testMode }) {
  await appendRow('Notificaciones', {
    NotificacionID: uuid(),
    Entidad: 'CASO_CLIENTE',
    EntidadID: caseId,
    Canal: 'CORREO',
    Destino: destination,
    Tipo: testMode ? 'CASO_CREADO_PRUEBA' : 'CASO_CREADO',
    Estado: error ? 'ERROR' : 'ENVIADO',
    Intentos: 1,
    Respuesta: result ? JSON.stringify(result).slice(0, 1500) : '',
    Error: error ? clean(error?.message || error, 1500) : '',
    FechaCreacion: nowIso(),
    FechaEnvio: error ? '' : nowIso(),
    CreadoPor: 'CLIENTE',
  }).catch(() => {});
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
  await recordNotification({
    caseId: caseData.CasoID,
    destination: caseData.ModoPrueba ? TEST_RECIPIENT : 'Coordinación DMS',
    result,
    error,
    testMode: Boolean(caseData.ModoPrueba),
  });
  const updated = await updateRow('CasosClientes', caseData.CasoID, {
    AsuntoCorreoInicial: generated.subject,
    CuerpoCorreoInicial: generated.body,
    GeminiModeloInicial: generated.model || '',
    GeminiUsadoInicial: generated.generatedByGemini,
    EstadoNotificacionInicial: error ? 'ERROR' : 'ENVIADO',
    UltimoErrorNotificacion: error ? clean(error?.message || error, 1500) : generated.warning || '',
    FechaActualizacion: nowIso(),
    ActualizadoPor: 'CLIENTE',
  });
  return { caseData: updated, generated, result, error };
}

async function completeSubmission(caseData, requested) {
  const uploaded = await uploadCaseEvidences(caseData, requested);
  const errorSummary = uploaded.failed
    .map((item) => `${item.fileName}: ${item.message}`)
    .join(' | ')
    .slice(0, 3000);
  const updated = await updateRow('CasosClientes', caseData.CasoID, {
    EvidenciaCount: uploaded.rows.length,
    EvidenciasSolicitadas: requested.length,
    EvidenciasFallidas: uploaded.failed.length,
    UltimoErrorEvidencias: errorSummary,
    CarpetaDriveID: uploaded.folder?.id || caseData.CarpetaDriveID || '',
    CarpetaDriveURL: uploaded.folder?.webViewLink || caseData.CarpetaDriveURL || '',
    FechaActualizacion: nowIso(),
    ActualizadoPor: 'CLIENTE',
  });
  const notification = await sendInitialNotification(updated, uploaded.rows);
  return { caseData: notification.caseData, uploaded, notification };
}

async function createPublicCase(ctx, portal) {
  const requestId = clean(pick(ctx.payload, ['requestId', 'SolicitudClienteID']), 200);
  if (!validRequestId(requestId)) {
    throw badRequest('No se pudo validar el envío. Actualice la página y vuelva a intentarlo.');
  }
  const reason = clean(pick(ctx.payload, ['reason', 'case', 'caso', 'razonVisita', 'RazonVisita']), 2000);
  const problem = clean(pick(ctx.payload, ['problem', 'problema', 'descripcion', 'Descripcion']), 8000);
  const email = clean(pick(ctx.payload, ['email', 'correo', 'CorreoSolicitante']), 320).toLowerCase();
  const requester = clean(pick(ctx.payload, ['requesterName', 'name', 'nombre', 'NombreSolicitante']), 250);
  if (!reason) throw badRequest('Escriba la razón de la visita.');
  if (!problem) throw badRequest('Describa el problema que presenta.');
  if (!requester) throw badRequest('Escriba el nombre de quien genera el caso.');
  if (!validEmail(email)) throw badRequest('Escriba un correo electrónico válido.');
  if (clean(ctx.payload.website, 200)) {
    return { accepted: true, caseNumber: '', message: 'Solicitud recibida.' };
  }
  const requested = validateEvidences(ctx.payload.evidences || ctx.payload.evidencias || []);

  return withCaseCreateLock(async () => {
    const rows = await readTable('CasosClientes', { force: true });
    const duplicate = rows.find((item) => (
      clean(item.SolicitudClienteID, 200) === requestId
      && clean(item.ClienteID, 200) === clean(portal.client.ClienteID, 200)
    ));

    if (duplicate) {
      const completed = await completeSubmission(caseView(duplicate), requested);
      return submissionResponse(completed, true);
    }

    const timestamp = nowIso();
    const caseData = {
      CasoID: uuid(),
      CasoNumero: portal.testMode ? testCaseNumber() : strictNextCaseNumber(rows),
      SolicitudClienteID: requestId,
      ClienteID: portal.client.ClienteID,
      Cliente: clientName(portal.client),
      RazonVisita: reason,
      Problema: problem,
      CorreoSolicitante: email,
      NombreSolicitante: requester,
      Estado: 'EN_ESPERA',
      ModoPrueba: portal.testMode,
      TipoCaso: portal.testMode ? 'PRUEBA' : 'REAL',
      EvidenciaCount: 0,
      EvidenciasSolicitadas: requested.length,
      EvidenciasFallidas: 0,
      UltimoErrorEvidencias: '',
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
    const completed = await completeSubmission(caseData, requested);
    return submissionResponse(completed, false);
  });
}

function submissionResponse(completed, alreadyCreated) {
  const { caseData, uploaded, notification } = completed;
  const failedNames = uploaded.failed.map((item) => item.fileName);
  const failedCount = uploaded.failed.length;
  const warning = failedCount
    ? `El caso fue creado, pero ${failedCount} evidencia${failedCount === 1 ? '' : 's'} no se pudo${failedCount === 1 ? '' : 'ieron'} cargar.`
    : '';
  return {
    accepted: true,
    alreadyCreated,
    caseId: caseData.CasoID,
    caseNumber: caseData.CasoNumero,
    testMode: Boolean(caseData.ModoPrueba),
    evidenceCount: uploaded.rows.length,
    requestedEvidenceCount: Number(caseData.EvidenciasSolicitadas || 0),
    failedEvidenceCount: failedCount,
    failedEvidenceNames: failedNames,
    evidenceUploadWarning: warning,
    notificationSent: !notification.error,
    generatedByGemini: notification.generated.generatedByGemini,
    message: caseData.ModoPrueba
      ? `El caso de prueba ${caseData.CasoNumero} fue creado. El correo inicial se envió únicamente a ${TEST_RECIPIENT}.`
      : `El caso ${caseData.CasoNumero} fue creado correctamente y quedó en espera de revisión.`,
  };
}

async function ensureTestPortal(clientId, { rotate = false, origin = '' } = {}) {
  await ensureModeSchema();
  const client = await findById('Clientes', clientId);
  const current = clean(client.PortalCasosPruebaToken, 220);
  const token = rotate || !current ? createPortalToken() : current;
  const timestamp = nowIso();
  const updated = token !== current
    ? await updateRow('Clientes', clientId, {
      PortalCasosPruebaToken: token,
      PortalCasosPruebaCreadoEn: clean(client.PortalCasosPruebaCreadoEn) || timestamp,
      PortalCasosPruebaActualizadoEn: timestamp,
    })
    : client;
  return {
    token,
    testUrl: casePortalUrl(token, origin),
    testMode: true,
    client: updated,
  };
}

function normalizeState(value) {
  const state = clean(value, 40).toUpperCase().replace(/[\s-]+/g, '_');
  if (['EN_PROCESO', 'PROCESO'].includes(state)) return 'EN_PROCESO';
  if (['FINALIZADO', 'FINALIZADA', 'FINAL'].includes(state)) return 'FINALIZADO';
  return 'EN_ESPERA';
}

async function listCases(ctx) {
  await ensureModeSchema();
  await reconcileCustomerCases(ctx.user.UsuarioID).catch((error) => {
    console.warn(`[customer-cases] No se pudo reconciliar el cierre: ${error.message}`);
  });
  const allRows = (await readTable('CasosClientes'))
    .filter((row) => row.Activo !== false)
    .map(caseView);
  const requestedMode = clean(pick(ctx.payload, ['mode', 'modo', 'caseMode']), 20).toUpperCase();
  const mode = requestedMode === 'TEST' || requestedMode === 'PRUEBA'
    ? 'TEST'
    : requestedMode === 'ALL' || requestedMode === 'TODOS'
      ? 'ALL'
      : 'REAL';
  const modeRows = allRows.filter((row) => (
    mode === 'ALL' || (mode === 'TEST' ? row.ModoPrueba : !row.ModoPrueba)
  ));
  const state = clean(pick(ctx.payload, ['status', 'estado']), 50);
  const clientId = clean(pick(ctx.payload, ['clientId', 'ClienteID']), 200);
  const search = clean(pick(ctx.payload, ['search', 'q']), 300).toLowerCase();
  let rows = modeRows;
  if (state) rows = rows.filter((row) => normalizeState(row.Estado) === normalizeState(state));
  if (clientId) rows = rows.filter((row) => clean(row.ClienteID) === clientId);
  if (search) {
    rows = rows.filter((row) => `${row.CasoNumero} ${row.Cliente} ${row.RazonVisita} ${row.Problema} ${row.NombreSolicitante} ${row.CorreoSolicitante}`.toLowerCase().includes(search));
  }
  rows.sort((a, b) => clean(b.FechaCreacion).localeCompare(clean(a.FechaCreacion)));
  const counts = {
    EN_ESPERA: modeRows.filter((row) => normalizeState(row.Estado) === 'EN_ESPERA').length,
    EN_PROCESO: modeRows.filter((row) => normalizeState(row.Estado) === 'EN_PROCESO').length,
    FINALIZADO: modeRows.filter((row) => normalizeState(row.Estado) === 'FINALIZADO').length,
    TOTAL: modeRows.length,
  };
  const page = Math.max(1, Number(ctx.payload.page || 1));
  const pageSize = Math.min(200, Math.max(1, Number(ctx.payload.pageSize || 60)));
  return {
    items: rows.slice((page - 1) * pageSize, page * pageSize),
    total: rows.length,
    page,
    pageSize,
    counts,
    mode,
    modeCounts: {
      REAL: allRows.filter((row) => !row.ModoPrueba).length,
      TEST: allRows.filter((row) => row.ModoPrueba).length,
      ALL: allRows.length,
    },
  };
}

function testTicketNumber(caseData) {
  const source = clean(caseData.CasoNumero || caseData.CasoID, 100)
    .replace(/^PRUEBA-CAS-/i, '')
    .replace(/[^A-Za-z0-9-]/g, '-')
    .slice(0, 70);
  return `PRUEBA-${source || crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function normalizedIds(values) {
  return [...new Set(parseArray(values).map((value) => clean(value, 200)).filter(Boolean))].sort();
}

async function replaceTestTicketAssignments(ticketId, ids, ctx) {
  const tables = await readTables(['BoletaAsignados', 'Usuarios']);
  const active = tables.BoletaAsignados.filter((item) => clean(item.BoletaUID) === clean(ticketId) && item.Activo !== false);
  const nextIds = normalizedIds(ids);
  const currentIds = active.map((item) => clean(item.UsuarioID)).sort();
  if (currentIds.length === nextIds.length && currentIds.every((id, index) => id === nextIds[index])) return;
  if (active.length) {
    await updateRows('BoletaAsignados', active.map((row) => ({
      idValue: row.BoletaAsignadoID,
      patch: { Activo: false },
    })));
  }
  const usersById = new Map(tables.Usuarios.map((user) => [clean(user.UsuarioID), user]));
  const rows = nextIds.map((id) => {
    const user = usersById.get(id) || {};
    return {
      BoletaAsignadoID: uuid(),
      BoletaUID: ticketId,
      UsuarioID: id,
      NombreUsuarioSnapshot: clean(user.NombreCompleto || user.Nombre || user.NombreUsuario || id, 250),
      Activo: true,
      CreadoPor: ctx.user.UsuarioID,
      FechaCreacion: nowIso(),
    };
  });
  if (rows.length) await appendRows('BoletaAsignados', rows);
}

async function createOrUpdateTestTicket(ctx, caseData) {
  const payload = ctx.payload || {};
  const ticketId = clean(pick(payload, ['boletaUid', 'BoletaUID']), 200) || `caso-prueba-${caseData.CasoID}`;
  const rows = await readTable('Boletas', { force: true });
  const existing = rows.find((row) => clean(row.BoletaUID) === ticketId);
  const timestamp = nowIso();
  const patch = {
    BoletaID: existing?.BoletaID || testTicketNumber(caseData),
    Titulo: clean(pick(payload, ['Titulo', 'titulo'], `[PRUEBA] ${caseData.RazonVisita}`), 200),
    Estado: clean(pick(payload, ['Estado', 'estado'], existing?.Estado || 'PENDIENTE'), 40).toUpperCase(),
    Fecha: clean(pick(payload, ['Fecha', 'fecha'], existing?.Fecha), 20),
    HoraInicio: clean(pick(payload, ['HoraInicio', 'horaInicio'], existing?.HoraInicio), 20),
    HoraFinal: clean(pick(payload, ['HoraFinal', 'horaFinal'], existing?.HoraFinal), 20),
    HorasTotales: Number(payload.HorasTotales ?? payload.horasTotales ?? existing?.HorasTotales ?? 0),
    ClienteID: clean(pick(payload, ['ClienteID', 'clienteId'], caseData.ClienteID), 200),
    Cliente: clean(pick(payload, ['Cliente', 'cliente'], caseData.Cliente), 300),
    CorreoCliente: clean(pick(payload, ['CorreoCliente', 'correoCliente'], caseData.CorreoSolicitante), 320),
    RazonVisita: clean(pick(payload, ['RazonVisita', 'razonVisita'], caseData.RazonVisita), 4000),
    Descripcion: clean(pick(payload, ['Descripcion', 'descripcion'], caseData.Problema), 8000),
    OrigenCasoID: caseData.CasoID,
    EsPrueba: true,
    ModoPrueba: true,
    EnviarCorreoCliente: false,
    CorreosCC: '',
    EstadoNotificacion: 'PRUEBA',
    UltimoErrorNotificacion: '',
    ActualizadoPor: ctx.user.UsuarioID,
    FechaActualizacion: timestamp,
  };
  if (existing) {
    await updateRow('Boletas', ticketId, {
      ...patch,
      Version: Number(existing.Version || 1) + 1,
    });
  } else {
    await appendRow('Boletas', {
      BoletaUID: ticketId,
      Version: 1,
      ...patch,
      CreadoPor: ctx.user.UsuarioID,
      FechaCreacion: timestamp,
    });
  }
  await replaceTestTicketAssignments(ticketId, payload.AsignadoA || payload.asignados, ctx);
  await audit(ctx, existing ? 'ACTUALIZAR_BOLETA_PRUEBA_CASO' : 'CREAR_BOLETA_PRUEBA_CASO', 'Boletas', ticketId, existing || null, patch).catch(() => {});
  return ticketMultiHandlers.get({ ...ctx, payload: { boletaUid: ticketId } });
}

if (!customerCaseHandlers[INSTALL_FLAG]) {
  const originalClientLink = customerCaseHandlers.clientLink;
  const originalClientLinkStatus = customerCaseHandlers.clientLinkStatus;
  const originalClientLinkUpdate = customerCaseHandlers.clientLinkUpdate;
  const originalMediaGet = customerCaseHandlers.mediaGet;

  customerCaseHandlers.publicGet = async (ctx) => {
    const portal = await resolvePortal(pick(ctx.payload, ['token', 'portalToken']));
    return {
      client: {
        id: portal.client.ClienteID,
        name: clientName(portal.client),
      },
      limits: {
        maxImages: MAX_EVIDENCES,
        maxFileMb: MAX_FILE_BYTES / 1024 / 1024,
        maxTotalMb: MAX_TOTAL_BYTES / 1024 / 1024,
      },
      reusable: true,
      testMode: portal.testMode,
      mode: portal.testMode ? 'TEST' : 'REAL',
    };
  };

  customerCaseHandlers.publicSubmit = async (ctx) => {
    const portal = await resolvePortal(pick(ctx.payload, ['token', 'portalToken']));
    return createPublicCase(ctx, portal);
  };

  customerCaseHandlers.clientLink = async (ctx) => {
    const result = await originalClientLink(ctx);
    const test = await ensureTestPortal(result.clientId, {
      rotate: booleanValue(ctx.payload.rotate, false),
      origin: ctx.origin,
    });
    return { ...result, testUrl: test.testUrl, testModeAvailable: true };
  };

  customerCaseHandlers.clientLinkStatus = async (ctx) => {
    const result = await originalClientLinkStatus(ctx);
    if (!result.configured) return { ...result, testUrl: '', testModeAvailable: true };
    const test = await ensureTestPortal(result.clientId, { origin: ctx.origin });
    return { ...result, testUrl: test.testUrl, testModeAvailable: true };
  };

  customerCaseHandlers.clientLinkUpdate = async (ctx) => {
    const result = await originalClientLinkUpdate(ctx);
    const test = result.configured
      ? await ensureTestPortal(result.clientId, { origin: ctx.origin })
      : null;
    return { ...result, testUrl: test?.testUrl || '', testModeAvailable: true };
  };

  customerCaseHandlers.list = listCases;

  customerCaseHandlers.mediaGet = async (ctx) => {
    const evidence = await findById('CasoEvidencias', pick(ctx.payload, ['evidenceId', 'CasoEvidenciaID', 'id']));
    const requestedCaseId = clean(pick(ctx.payload, ['caseId', 'CasoID']), 220);
    if (requestedCaseId && clean(evidence.CasoID, 220) !== requestedCaseId) {
      throw notFound('La evidencia no pertenece al caso solicitado.');
    }
    if (clean(evidence.Almacenamiento, 40).toUpperCase() !== 'APPS_SCRIPT') {
      return originalMediaGet(ctx);
    }
    if (!evidence.DriveFileID) throw notFound('La evidencia no tiene un archivo asociado.');
    return getCustomerCaseEvidenceFromAppsScript({
      fileId: evidence.DriveFileID,
      mimeType: evidence.MimeType || 'image/jpeg',
    });
  };

  customerCaseHandlers[INSTALL_FLAG] = true;
}

if (!ticketMultiHandlers[TEST_TICKET_FLAG]) {
  const originalCreateTicket = ticketMultiHandlers.create;
  ticketMultiHandlers.create = async (ctx) => {
    const caseId = clean(pick(ctx.payload, ['OrigenCasoID', 'origenCasoId']), 220);
    if (!caseId) return originalCreateTicket(ctx);
    const caseData = caseView(await findById('CasosClientes', caseId));
    if (!caseData.ModoPrueba) return originalCreateTicket(ctx);
    return createOrUpdateTestTicket(ctx, caseData);
  };
  ticketMultiHandlers[TEST_TICKET_FLAG] = true;
}

if (!ticketDeliveryHandlers[TEST_FINALIZE_FLAG]) {
  const originalFinalize = ticketDeliveryHandlers.finalize;
  const originalResendChats = ticketDeliveryHandlers.resendChats;

  ticketDeliveryHandlers.finalize = async (ctx) => {
    const ticketId = clean(pick(ctx.payload, ['boletaUid', 'BoletaUID', 'id']), 220);
    const ticket = await findById('Boletas', ticketId);
    if (!booleanValue(ticket.EsPrueba || ticket.ModoPrueba, false)) {
      return originalFinalize(ctx);
    }
    await ticketAccessHandlers.assertTicketAccess(ctx, ticket, 'finalizar');
    const timestamp = nowIso();
    const updated = await updateRow('Boletas', ticketId, {
      Estado: 'FINALIZADA',
      FinalizadaEn: timestamp,
      EstadoNotificacion: 'PRUEBA',
      UltimoErrorNotificacion: '',
      ActualizadoPor: ctx.user.UsuarioID,
      FechaActualizacion: timestamp,
    });
    await audit(ctx, 'FINALIZAR_BOLETA_PRUEBA_SIN_NOTIFICAR', 'Boletas', ticketId, ticket, updated).catch(() => {});
    return {
      boleta: updated,
      testMode: true,
      stateChanged: true,
      delivery: {
        notificationState: 'PRUEBA',
        notifications: [],
        errors: [],
        message: 'Boleta de prueba finalizada sin correo al cliente ni Google Chat.',
      },
    };
  };

  ticketDeliveryHandlers.resendChats = async (ctx) => {
    const ticketId = clean(pick(ctx.payload, ['boletaUid', 'BoletaUID', 'id']), 220);
    const ticket = await findById('Boletas', ticketId);
    if (booleanValue(ticket.EsPrueba || ticket.ModoPrueba, false)) {
      throw badRequest('Las boletas de prueba no se envían a Google Chat.');
    }
    return originalResendChats(ctx);
  };

  ticketDeliveryHandlers[TEST_FINALIZE_FLAG] = true;
}

export const CUSTOMER_CASE_TEST_MODE_CONFIG = Object.freeze({
  recipient: TEST_RECIPIENT,
  realCasePrefix: 'CAS-',
  testCasePrefix: 'PRUEBA-CAS-',
  testTicketPrefix: 'PRUEBA-',
});
