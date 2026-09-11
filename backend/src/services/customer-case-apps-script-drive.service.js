import crypto from 'node:crypto';
import { createUploadToken, parseUploadToken, LARGE_VIDEO_CHUNK_BYTES } from './large-evidence-upload.service.js';
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
      uploadedFileId: evidence.uploadedFile?.id || undefined,
      uploadId: evidence.uploadedFile?.uploadId || undefined,
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


function caseUploadScope(portal, requestId) {
  return {clientId:String(portal.client.ClienteID),testMode:Boolean(portal.testMode),requestId:String(requestId)};
}
function assertCaseScope(token, portal, requestId) {
  const scope = caseUploadScope(portal, requestId);
  if (token.clientId !== scope.clientId || token.testMode !== scope.testMode || token.requestId !== scope.requestId) {
    throw new AppError('INVALID_UPLOAD_REFERENCE', 'La evidencia no pertenece a esta solicitud.', 400);
  }
}
export async function initCustomerCaseUpload(payload, portal) {
  const {requestId, evidenceId} = payload;
  if (![requestId,evidenceId].every(value => /^[A-Za-z0-9._:-]{8,160}$/.test(String(value || '')))) throw new AppError('INVALID_UPLOAD', 'El identificador de carga no es válido.', 400);
  const fileName=clean(payload.fileName,220), mimeType=clean(payload.mimeType,120).toLowerCase(), size=Number(payload.size);
  if (!/^image\/(jpeg|png|webp|gif|heic|heif)$/.test(mimeType) || !Number.isSafeInteger(size) || size<=0 || size>6*1024*1024) throw new AppError('INVALID_UPLOAD', 'La evidencia debe ser una imagen de hasta 6 MB.', 400);
  const scope=caseUploadScope(portal,requestId);
  const uploadId=crypto.createHash('sha256').update(JSON.stringify({...scope,evidenceId,fileName,mimeType,size})).digest('hex');
  const session=await postAppsScript({action:'customer.case.evidence.init',idempotencyKey:`case-upload:${uploadId}`,uploadId,
    case:{ClienteID:scope.clientId,Cliente:portal.client.NombreComercial || portal.client.Nombre || scope.clientId,ModoPrueba:scope.testMode},
    evidence:{fileName,mimeType,size}});
  if (!session?.sessionUrl || !session?.fileId) throw new AppError('UPLOAD_INIT_FAILED','Apps Script no devolvió una sesión de carga.',502);
  return {complete:false,chunkBytes:LARGE_VIDEO_CHUNK_BYTES,uploadToken:createUploadToken({...scope,kind:'case-upload',uploadId,sessionUrl:session.sessionUrl,fileId:session.fileId,fileName,mimeType,size})};
}
export async function chunkCustomerCaseUpload(payload, portal) {
  const token=parseUploadToken(payload.uploadToken,'case-upload');
  assertCaseScope(token,portal,payload.requestId);
  const encoded=String(payload.base64 || '');
  if (!encoded || encoded.length>Math.ceil(LARGE_VIDEO_CHUNK_BYTES/3)*4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new AppError('INVALID_UPLOAD','Bloque de evidencia no válido.',400);
  const bytes=Math.floor(encoded.length*3/4)-(encoded.endsWith('==')?2:encoded.endsWith('=')?1:0);
  const offset=Number(payload.offset);
  if (!Number.isSafeInteger(offset) || offset<0 || offset>=token.size || bytes<=0 || offset+bytes>token.size) throw new AppError('INVALID_UPLOAD','Posición de evidencia no válida.',400);
  const result=await postAppsScript({action:'customer.case.evidence.chunk',uploadId:token.uploadId,sessionUrl:token.sessionUrl,fileId:token.fileId,mimeType:token.mimeType,size:token.size,offset,base64:encoded},90_000);
  if (!result?.complete) return {complete:false,nextOffset:Number(result?.nextOffset)};
  if (result.file?.id !== token.fileId || Number(result.file?.size)!==token.size) throw new AppError('UPLOAD_INCOMPLETE','No se pudo confirmar el archivo original.',502);
  const fingerprint=crypto.createHash('sha256').update(`${token.fileId}|${token.mimeType}|${token.fileName}|${token.size}`).digest('hex');
  const receipt=createUploadToken({...caseUploadScope(portal,payload.requestId),kind:'case-receipt',fileId:token.fileId,uploadId:token.uploadId,fileName:token.fileName,mimeType:token.mimeType,size:token.size,fingerprint});
  return {complete:true,nextOffset:token.size,evidence:{uploadReference:receipt,fileName:token.fileName,mimeType:token.mimeType,size:token.size}};
}
export function resolveCustomerCaseUpload(reference, portal, requestId) {
  const token=parseUploadToken(reference,'case-receipt');
  assertCaseScope(token,portal,requestId);
  return {fileName:token.fileName,mimeType:token.mimeType,bytes:token.size,fingerprint:token.fingerprint,uploadedFile:{id:token.fileId,uploadId:token.uploadId}};
}
