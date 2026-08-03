import crypto from 'node:crypto';
import { badRequest } from '../core/errors.js';
import { nowIso, pick, uuid } from '../core/utils.js';
import {
  appendRow,
  ensureColumns,
  findById,
  readTable,
  updateRow,
} from '../infra/sheets.repository.js';
import {
  createFolder,
  trashFile,
  uploadBase64,
} from '../infra/drive.repository.js';
import { env } from '../config/env.js';
import { customerCaseHandlers } from '../modules/customer-cases.module.js';
import { getConfig } from '../modules/config.module.js';
import { generateInitialCaseEmail } from './customer-case-gemini.service.js';
import { sendNewCustomerCaseEmail } from './customer-case-email.service.js';

const INSTALL_FLAG = Symbol.for('dms.customerCaseEvidenceRecovery');
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

function clean(value, maxLength = 12000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'si', 'sí', 'yes', 'activo'].includes(clean(value, 20).toLowerCase());
}

function normalizeBase64(value) {
  const text = clean(value, 40_000_000);
  const comma = text.indexOf(',');
  const encoded = comma >= 0 && text.slice(0, comma).includes('base64')
    ? text.slice(comma + 1)
    : text;
  return encoded.replace(/[\r\n\s]/g, '');
}

function fingerprintEvidence({ base64, mimeType, fileName, bytes }) {
  return crypto
    .createHash('sha256')
    .update(`${mimeType}|${fileName}|${bytes}|`)
    .update(base64)
    .digest('hex');
}

function evidenceInput(value, index) {
  const mimeType = clean(value?.mimeType || value?.type, 120).toLowerCase();
  const fileName = clean(
    value?.fileName || value?.name || `evidencia-${index + 1}.jpg`,
    220,
  );
  const base64 = normalizeBase64(
    value?.base64 || value?.dataUrl || value?.fileBase64,
  );

  if (!ALLOWED_IMAGE_MIME.has(mimeType)) {
    throw badRequest(`La evidencia ${fileName} no es una imagen permitida.`);
  }
  if (!base64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    throw badRequest(`La evidencia ${fileName} no contiene datos válidos.`);
  }

  const bytes = Buffer.from(base64, 'base64').length;
  if (!bytes) throw badRequest(`La evidencia ${fileName} está vacía.`);
  if (bytes > MAX_FILE_BYTES) {
    throw badRequest(`La evidencia ${fileName} supera el límite de 6 MB.`);
  }

  return {
    base64,
    mimeType,
    fileName,
    bytes,
    note: clean(value?.note || value?.nota, 1000),
    fingerprint: fingerprintEvidence({ base64, mimeType, fileName, bytes }),
  };
}

function requestedEvidences(payload = {}) {
  const source = Array.isArray(payload.evidences)
    ? payload.evidences
    : Array.isArray(payload.evidencias)
      ? payload.evidencias
      : [];

  if (source.length > MAX_EVIDENCES) {
    throw badRequest(`Puede adjuntar un máximo de ${MAX_EVIDENCES} imágenes.`);
  }

  const evidences = source.map(evidenceInput);
  const totalBytes = evidences.reduce((sum, item) => sum + item.bytes, 0);
  if (totalBytes > MAX_TOTAL_BYTES) {
    throw badRequest('Las evidencias superan el límite total de 16 MB.');
  }
  return evidences;
}

async function ensureRecoverySchema() {
  if (!schemaPromise) {
    schemaPromise = Promise.all([
      ensureColumns('CasosClientes', [
        'EvidenciasSolicitadas',
        'EvidenciasFallidas',
        'UltimoErrorEvidencias',
      ]),
      ensureColumns('CasoEvidencias', ['HuellaArchivo']),
    ]).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

function activeClient(client = {}) {
  const state = clean(client.Estado || 'ACTIVO', 40).toUpperCase();
  return client.Activo !== false
    && state !== 'INACTIVO'
    && booleanValue(client.PortalCasosActivo, true);
}

async function findPortalClient(token, clientId) {
  const requestedToken = clean(token, 220);
  const clients = await readTable('Clientes');
  const client = clients.find((item) => (
    clean(item.ClienteID, 220) === clean(clientId, 220)
    && clean(item.PortalCasosToken, 220) === requestedToken
  ));
  if (!client || !activeClient(client)) {
    throw badRequest('El enlace del cliente dejó de estar disponible durante la carga de evidencias.');
  }
  return client;
}

function clientName(client = {}) {
  return clean(
    pick(client, ['Clientes', 'Cliente', 'Nombre'], 'Cliente'),
    250,
  );
}

async function caseFolder(caseData, client) {
  const existingId = clean(caseData.CarpetaDriveID, 250);
  if (existingId) {
    return {
      id: existingId,
      webViewLink: clean(caseData.CarpetaDriveURL, 2000),
    };
  }

  const config = await getConfig().catch(() => ({}));
  const configuredParent = clean(
    process.env.CUSTOMER_CASES_FOLDER_ID
      || config.CUSTOMER_CASES_FOLDER_ID
      || config.CARPETA_CASOS_CLIENTES_ID,
    250,
  );
  const root = await createFolder(
    'Casos de clientes DMS',
    configuredParent || undefined,
  );
  const clientFolder = await createFolder(clientName(client), root.id);
  return createFolder(
    `${clean(caseData.CasoNumero, 100)} - ${clean(caseData.RazonVisita, 80)}`,
    clientFolder.id,
  );
}

function fallbackMatch(row, evidence) {
  return clean(row.NombreArchivo, 250) === evidence.fileName
    && Number(row.TamanoBytes || 0) === evidence.bytes;
}

function evidenceRowsForCase(rows, caseId) {
  return rows.filter((row) => (
    clean(row.CasoID, 220) === clean(caseId, 220)
    && row.Activo !== false
  ));
}

async function recoverMissingEvidences({ caseData, client, requested }) {
  await ensureRecoverySchema();

  let storedRows = evidenceRowsForCase(
    await readTable('CasoEvidencias', { force: true }),
    caseData.CasoID,
  );
  const usedRowIds = new Set();
  const missing = [];

  for (const evidence of requested) {
    const match = storedRows.find((row) => {
      if (usedRowIds.has(clean(row.CasoEvidenciaID, 220))) return false;
      const fingerprint = clean(row.HuellaArchivo, 100);
      return fingerprint
        ? fingerprint === evidence.fingerprint
        : fallbackMatch(row, evidence);
    });

    if (match) {
      usedRowIds.add(clean(match.CasoEvidenciaID, 220));
      if (!clean(match.HuellaArchivo, 100)) {
        await updateRow('CasoEvidencias', match.CasoEvidenciaID, {
          HuellaArchivo: evidence.fingerprint,
        }).catch(() => {});
      }
    } else {
      missing.push(evidence);
    }
  }

  if (!missing.length) {
    return { rows: storedRows, recovered: [], failed: [] };
  }

  const folder = await caseFolder(caseData, client);
  const recovered = [];
  const failed = [];
  const startIndex = storedRows.length;

  for (let index = 0; index < missing.length; index += 1) {
    const evidence = missing[index];
    let file = null;
    try {
      file = await uploadBase64({
        base64: evidence.base64,
        mimeType: evidence.mimeType,
        fileName: `${String(startIndex + index + 1).padStart(2, '0')} - ${evidence.fileName}`,
        folderId: folder.id,
      });

      const row = {
        CasoEvidenciaID: uuid(),
        CasoID: caseData.CasoID,
        ClienteID: caseData.ClienteID,
        NombreArchivo: evidence.fileName,
        MimeType: evidence.mimeType,
        TamanoBytes: evidence.bytes,
        DriveFileID: file.id,
        DriveURL: file.webViewLink || '',
        Nota: evidence.note,
        HuellaArchivo: evidence.fingerprint,
        FechaCreacion: nowIso(),
        CreadoPor: 'CLIENTE',
        Activo: true,
      };

      try {
        await appendRow('CasoEvidencias', row);
      } catch (sheetError) {
        await trashFile(file.id).catch(() => {});
        throw sheetError;
      }
      recovered.push(row);
    } catch (error) {
      if (file?.id) await trashFile(file.id).catch(() => {});
      failed.push({
        fileName: evidence.fileName,
        message: clean(error?.message || error, 700),
      });
    }
  }

  storedRows = evidenceRowsForCase(
    await readTable('CasoEvidencias', { force: true }),
    caseData.CasoID,
  );
  return { rows: storedRows, recovered, failed, folder };
}

async function registerRecoveryNotification({ caseData, result, error }) {
  await appendRow('Notificaciones', {
    NotificacionID: uuid(),
    Entidad: 'CASO_CLIENTE',
    EntidadID: caseData.CasoID,
    Canal: 'CORREO',
    Destino: 'Coordinación DMS',
    Tipo: 'CASO_CREADO_EVIDENCIAS_RECUPERADAS',
    Estado: error ? 'ERROR' : 'ENVIADO',
    Intentos: 1,
    Respuesta: result ? JSON.stringify(result).slice(0, 1500) : '',
    Error: error ? clean(error?.message || error, 1500) : '',
    FechaCreacion: nowIso(),
    FechaEnvio: error ? '' : nowIso(),
    CreadoPor: 'CLIENTE',
  }).catch(() => {});
}

async function sendCorrectedInitialEmail(caseData, evidences) {
  const generated = await generateInitialCaseEmail(caseData);
  let result = null;
  let error = null;

  try {
    result = await sendNewCustomerCaseEmail({
      caseData,
      evidences,
      message: generated,
    });
  } catch (sendError) {
    error = sendError;
  }

  await registerRecoveryNotification({ caseData, result, error });
  const previousState = clean(caseData.EstadoNotificacionInicial, 40).toUpperCase();
  const state = error && previousState !== 'ENVIADO' ? 'ERROR' : 'ENVIADO';

  await updateRow('CasosClientes', caseData.CasoID, {
    AsuntoCorreoInicial: generated.subject,
    CuerpoCorreoInicial: generated.body,
    GeminiModeloInicial: generated.model || '',
    GeminiUsadoInicial: generated.generatedByGemini,
    EstadoNotificacionInicial: state,
    UltimoErrorNotificacion: error
      ? clean(error?.message || error, 1500)
      : generated.warning || '',
    FechaActualizacion: nowIso(),
    ActualizadoPor: 'CLIENTE',
  });

  return { result, error, generated };
}

if (!customerCaseHandlers[INSTALL_FLAG]) {
  const originalSubmit = customerCaseHandlers.publicSubmit;

  customerCaseHandlers.publicSubmit = async (ctx) => {
    const requested = requestedEvidences(ctx.payload || {});
    const originalResult = await originalSubmit(ctx);

    if (!requested.length || !originalResult?.caseId) {
      return {
        ...originalResult,
        requestedEvidenceCount: requested.length,
        failedEvidenceCount: 0,
        failedEvidenceNames: [],
      };
    }

    const caseData = await findById('CasosClientes', originalResult.caseId);
    const client = await findPortalClient(
      pick(ctx.payload, ['token', 'portalToken']),
      caseData.ClienteID,
    );
    const recovery = await recoverMissingEvidences({
      caseData,
      client,
      requested,
    });

    const failedNames = recovery.failed.map((item) => item.fileName);
    const errorSummary = recovery.failed.length
      ? recovery.failed.map((item) => `${item.fileName}: ${item.message}`).join(' | ').slice(0, 3000)
      : '';
    const updatedCase = await updateRow('CasosClientes', caseData.CasoID, {
      EvidenciaCount: recovery.rows.length,
      EvidenciasSolicitadas: requested.length,
      EvidenciasFallidas: recovery.failed.length,
      UltimoErrorEvidencias: errorSummary,
      CarpetaDriveID: recovery.folder?.id || caseData.CarpetaDriveID || '',
      CarpetaDriveURL: recovery.folder?.webViewLink || caseData.CarpetaDriveURL || '',
      FechaActualizacion: nowIso(),
      ActualizadoPor: 'CLIENTE',
    });

    let correctedEmail = null;
    if (recovery.recovered.length) {
      correctedEmail = await sendCorrectedInitialEmail(updatedCase, recovery.rows);
    }

    const evidenceCount = recovery.rows.length;
    const failedEvidenceCount = recovery.failed.length;
    const warning = failedEvidenceCount
      ? `El caso fue creado, pero ${failedEvidenceCount} evidencia${failedEvidenceCount === 1 ? '' : 's'} no se pudo${failedEvidenceCount === 1 ? '' : 'ieron'} cargar.`
      : '';

    return {
      ...originalResult,
      evidenceCount,
      requestedEvidenceCount: requested.length,
      recoveredEvidenceCount: recovery.recovered.length,
      failedEvidenceCount,
      failedEvidenceNames: failedNames,
      evidenceUploadWarning: warning,
      notificationSent: correctedEmail
        ? !correctedEmail.error
        : originalResult.notificationSent,
      message: failedEvidenceCount
        ? `${originalResult.message} ${warning}`
        : originalResult.message,
    };
  };

  customerCaseHandlers[INSTALL_FLAG] = true;
}

export const CUSTOMER_CASE_EVIDENCE_RECOVERY_LIMITS = Object.freeze({
  maxImages: MAX_EVIDENCES,
  maxFileBytes: MAX_FILE_BYTES,
  maxTotalBytes: MAX_TOTAL_BYTES,
});
