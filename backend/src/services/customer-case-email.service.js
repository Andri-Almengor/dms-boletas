import { AppError } from '../core/errors.js';
import { sha256, uuid } from '../core/utils.js';

const DEFAULT_ADMIN_RECIPIENTS = Object.freeze([
  'yehuda.karmona@solutionsdms.com',
  'raul.mayorga@solutionsdms.com',
  'alejandra.umana@solutionsdms.com',
]);
const TEST_RECIPIENT = 'andrick.almengor@solutionsdms.com';

function clean(value, maxLength = 12000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'si', 'sí', 'yes', 'activo', 'prueba'].includes(clean(value, 20).toLowerCase());
}

function validEmails(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[;,]/);
  return [...new Set(source
    .map((item) => clean(item, 320).toLowerCase())
    .filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item)))];
}

function adminRecipients(caseData = {}) {
  if (booleanValue(caseData.ModoPrueba || caseData.EsPrueba || caseData.TipoCaso, false)) return [TEST_RECIPIENT];
  const configured = validEmails(process.env.CUSTOMER_CASE_ADMIN_EMAILS || '');
  return configured.length ? configured : [...DEFAULT_ADMIN_RECIPIENTS];
}

function appsScriptConfig() {
  const url = clean(process.env.APPS_SCRIPT_REPORT_URL, 2000);
  const secret = clean(process.env.APPS_SCRIPT_REPORT_SECRET, 1000);
  if (!url) {
    throw new AppError(
      'APPS_SCRIPT_URL_MISSING',
      'El caso fue creado, pero el correo no pudo enviarse porque falta APPS_SCRIPT_REPORT_URL.',
      503,
    );
  }
  if (!secret) {
    throw new AppError(
      'APPS_SCRIPT_SECRET_MISSING',
      'El caso fue creado, pero el correo no pudo enviarse porque falta APPS_SCRIPT_REPORT_SECRET.',
      503,
    );
  }
  return { url, secret };
}

async function postAppsScript(payload) {
  const { url, secret } = appsScriptConfig();
  const timeoutMs = Math.max(
    30_000,
    Number(process.env.APPS_SCRIPT_CASE_EMAIL_TIMEOUT_MS || 180_000),
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, secret }),
      redirect: 'follow',
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new AppError(
        'APPS_SCRIPT_INVALID_RESPONSE',
        `Apps Script respondió con un formato inválido (${response.status}).`,
        502,
        { preview: text.slice(0, 300) },
      );
    }
    if (!response.ok || !parsed?.ok) {
      throw new AppError(
        parsed?.error?.code || 'CUSTOMER_CASE_APPS_SCRIPT_FAILED',
        parsed?.error?.message || `Apps Script rechazó el correo del caso (${response.status}).`,
        502,
      );
    }
    return parsed.data;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new AppError(
        'CUSTOMER_CASE_APPS_SCRIPT_TIMEOUT',
        'Apps Script tardó demasiado en enviar el correo del caso.',
        504,
      );
    }
    if (error instanceof AppError) throw error;
    throw new AppError(
      'CUSTOMER_CASE_APPS_SCRIPT_UNAVAILABLE',
      `No fue posible contactar Apps Script para enviar el correo del caso: ${error.message}`,
      502,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function casePayload(caseData = {}) {
  return {
    CasoID: clean(caseData.CasoID, 200),
    CasoNumero: clean(caseData.CasoNumero, 100),
    ClienteID: clean(caseData.ClienteID, 200),
    Cliente: clean(caseData.Cliente, 300),
    RazonVisita: clean(caseData.RazonVisita, 3000),
    Problema: clean(caseData.Problema, 10000),
    CorreoSolicitante: clean(caseData.CorreoSolicitante, 320),
    NombreSolicitante: clean(caseData.NombreSolicitante, 300),
    Estado: clean(caseData.Estado, 80),
    EstadoNotificacionTecnicos: clean(caseData.EstadoNotificacionTecnicos, 80),
    TecnicoNombres: clean(caseData.TecnicoNombres, 2000),
    FechaVisita: clean(caseData.FechaVisita, 40),
    HoraVisita: clean(caseData.HoraVisita, 40),
    MensajeAdministrador: clean(caseData.MensajeAdministrador, 5000),
    BoletaUID: clean(caseData.BoletaUID, 200),
    BoletaID: clean(caseData.BoletaID, 100),
    CarpetaDriveURL: clean(caseData.CarpetaDriveURL, 2000),
    FechaCreacion: clean(caseData.FechaCreacion, 80),
    FechaActualizacion: clean(caseData.FechaActualizacion, 80),
    ModoPrueba: booleanValue(caseData.ModoPrueba || caseData.EsPrueba || caseData.TipoCaso, false),
    TipoCaso: clean(caseData.TipoCaso, 40),
  };
}

function evidencePayload(evidences = []) {
  return (Array.isArray(evidences) ? evidences : []).map((item) => ({
    CasoEvidenciaID: clean(item.CasoEvidenciaID, 200),
    CasoID: clean(item.CasoID, 200),
    NombreArchivo: clean(item.NombreArchivo || item.Nombre, 250),
    MimeType: clean(item.MimeType, 150),
    TamanoBytes: Number(item.TamanoBytes || 0),
    DriveFileID: clean(item.DriveFileID, 250),
    DriveURL: clean(item.DriveURL, 2000),
    Nota: clean(item.Nota, 1500),
  }));
}

function technicianPayload(technicians = []) {
  return (Array.isArray(technicians) ? technicians : []).map((item) => ({
    UsuarioID: clean(item.UsuarioID, 200),
    Nombre: clean(
      item.Nombre || item.NombreCompleto || item.NombreUsuario || item.UsuarioID,
      300,
    ),
    Correo: clean(item.Correo, 320).toLowerCase(),
  }));
}

function initialIdempotencyKey({ caseData, evidences, message }) {
  const evidenceIds = evidencePayload(evidences)
    .map((item) => `${item.CasoEvidenciaID || item.DriveFileID}|${item.TamanoBytes}`)
    .sort();
  const fingerprint = sha256(JSON.stringify({
    caseId: clean(caseData.CasoID, 200),
    testMode: booleanValue(caseData.ModoPrueba, false),
    evidenceIds,
    subject: clean(message?.subject, 300),
    body: clean(message?.body, 15000),
  }));
  return `customer-case-created:${clean(caseData.CasoID, 200)}:${fingerprint}`;
}

function assignmentIdempotencyKey({
  caseData,
  evidences,
  message,
  technicians,
  ticketUrl,
  forceResend,
}) {
  if (forceResend) {
    return `customer-case-assigned-resend:${clean(caseData.CasoID, 200)}:${uuid()}`;
  }
  const fingerprint = sha256(JSON.stringify({
    caseId: clean(caseData.CasoID, 200),
    testMode: booleanValue(caseData.ModoPrueba, false),
    ticketId: clean(caseData.BoletaUID, 200),
    ticketNumber: clean(caseData.BoletaID, 100),
    visitDate: clean(caseData.FechaVisita, 40),
    visitTime: clean(caseData.HoraVisita, 40),
    adminMessage: clean(caseData.MensajeAdministrador, 5000),
    technicians: technicianPayload(technicians)
      .map((item) => `${item.UsuarioID}|${item.Correo}`)
      .sort(),
    evidenceIds: evidencePayload(evidences)
      .map((item) => item.CasoEvidenciaID || item.DriveFileID)
      .sort(),
    subject: clean(message?.subject, 300),
    body: clean(message?.body, 15000),
    ticketUrl: clean(ticketUrl, 2000),
  }));
  return `customer-case-assigned:${clean(caseData.CasoID, 200)}:${fingerprint}`;
}

export function sendNewCustomerCaseEmail({ caseData, evidences, message }) {
  const item = casePayload(caseData);
  return postAppsScript({
    action: 'customer.case.created.send',
    testMode: item.ModoPrueba,
    idempotencyKey: initialIdempotencyKey({
      caseData: item,
      evidences,
      message,
    }),
    case: item,
    evidences: evidencePayload(evidences),
    message: {
      subject: clean(message?.subject, 300),
      body: clean(message?.body, 15000),
    },
    recipients: {
      to: adminRecipients(item),
      cc: [],
    },
  });
}

export function sendAssignedCustomerCaseEmail({
  caseData,
  evidences,
  message,
  technicians,
  ticketUrl,
  forceResend = false,
}) {
  const item = casePayload(caseData);
  const assigned = technicianPayload(technicians);
  const recipients = validEmails(assigned.map((technician) => technician.Correo));
  if (!recipients.length) {
    throw new AppError(
      'CASE_EMAIL_MISSING',
      'No hay técnicos con un correo válido para enviar la asignación.',
      400,
    );
  }
  const explicitResend = forceResend
    || item.EstadoNotificacionTecnicos.toUpperCase() === 'ENVIADO';
  return postAppsScript({
    action: 'customer.case.assigned.send',
    testMode: item.ModoPrueba,
    idempotencyKey: assignmentIdempotencyKey({
      caseData: item,
      evidences,
      message,
      technicians: assigned,
      ticketUrl,
      forceResend: explicitResend,
    }),
    case: item,
    evidences: evidencePayload(evidences),
    technicians: assigned,
    ticketUrl: clean(ticketUrl, 2000),
    message: {
      subject: clean(message?.subject, 300),
      body: clean(message?.body, 15000),
    },
    recipients: {
      to: recipients,
      cc: [],
    },
  });
}

export const CUSTOMER_CASE_ADMIN_RECIPIENTS = DEFAULT_ADMIN_RECIPIENTS;
export const CUSTOMER_CASE_TEST_RECIPIENT = TEST_RECIPIENT;
