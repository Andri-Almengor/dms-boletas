import { AppError } from '../core/errors.js';

const UPLOAD_ACTION = 'customer.case.evidence.upload';
const GET_ACTION = 'customer.case.evidence.get';

function clean(value, maxLength = 12000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function appsScriptConfig() {
  const url = clean(process.env.APPS_SCRIPT_REPORT_URL, 2000);
  const secret = clean(process.env.APPS_SCRIPT_REPORT_SECRET, 1000);
  if (!url) {
    throw new AppError(
      'APPS_SCRIPT_URL_MISSING',
      'No se pueden guardar las evidencias porque falta APPS_SCRIPT_REPORT_URL.',
      503,
    );
  }
  if (!secret) {
    throw new AppError(
      'APPS_SCRIPT_SECRET_MISSING',
      'No se pueden guardar las evidencias porque falta APPS_SCRIPT_REPORT_SECRET.',
      503,
    );
  }
  return { url, secret };
}

async function postAppsScript(payload, timeoutMs = 180_000) {
  const { url, secret } = appsScriptConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(30_000, Number(timeoutMs || 180_000)));

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
        parsed?.error?.message || `Apps Script rechazó la operación (${response.status}).`,
        502,
      );
    }
    return parsed.data;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new AppError(
        'CUSTOMER_CASE_APPS_SCRIPT_TIMEOUT',
        'Apps Script tardó demasiado en procesar la evidencia.',
        504,
      );
    }
    if (error instanceof AppError) throw error;
    throw new AppError(
      'CUSTOMER_CASE_APPS_SCRIPT_UNAVAILABLE',
      `No fue posible contactar Apps Script: ${error.message}`,
      502,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function casePayload(caseData = {}) {
  return {
    CasoID: clean(caseData.CasoID, 200),
    CasoNumero: clean(caseData.CasoNumero, 120),
    ClienteID: clean(caseData.ClienteID, 200),
    Cliente: clean(caseData.Cliente, 300),
    RazonVisita: clean(caseData.RazonVisita, 3000),
    ModoPrueba: Boolean(caseData.ModoPrueba || caseData.EsPrueba),
  };
}

export function uploadCustomerCaseEvidenceWithAppsScript({
  caseData,
  evidence,
  index,
  fingerprint,
}) {
  const item = casePayload(caseData);
  const safeFingerprint = clean(fingerprint, 128);
  return postAppsScript({
    action: UPLOAD_ACTION,
    idempotencyKey: `customer-case-evidence:${item.CasoID}:${safeFingerprint}`,
    case: item,
    evidence: {
      index: Number(index || 0),
      fileName: clean(evidence.fileName, 250),
      mimeType: clean(evidence.mimeType, 150),
      size: Number(evidence.bytes || evidence.size || 0),
      base64: clean(evidence.base64, 40_000_000),
      note: clean(evidence.note, 1500),
      fingerprint: safeFingerprint,
    },
  });
}

export function getCustomerCaseEvidenceFromAppsScript({ fileId, mimeType = 'image/jpeg' }) {
  return postAppsScript({
    action: GET_ACTION,
    fileId: clean(fileId, 250),
    mimeType: clean(mimeType, 150),
  }, 120_000);
}

export const CUSTOMER_CASE_APPS_SCRIPT_ACTIONS = Object.freeze({
  upload: UPLOAD_ACTION,
  get: GET_ACTION,
});
