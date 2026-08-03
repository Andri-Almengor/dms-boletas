import { apiRequest } from '../api';
import { requestFirstAvailable } from './aliasResolver';

export const CUSTOMER_CASE_ROUTES = Object.freeze({
  publicGet: ['customerCases.public.get', 'casos.cliente.public.get'],
  publicSubmit: ['customerCases.public.submit', 'casos.cliente.public.submit'],
  clientLinkGet: ['customerCases.clientLink.get', 'casos.cliente.enlace.get'],
  clientLinkCreate: ['customerCases.clientLink.create', 'casos.cliente.enlace.crear'],
  clientLinkUpdate: ['customerCases.clientLink.update', 'casos.cliente.enlace.actualizar'],
  list: ['customerCases.list', 'casos.cliente.list'],
  get: ['customerCases.get', 'casos.cliente.get'],
  process: ['customerCases.process', 'casos.cliente.procesar'],
  resendTechnicians: ['customerCases.resendTechnicians', 'casos.cliente.reenviarTecnicos'],
  mediaGet: ['customerCases.media.get', 'casos.cliente.media.get'],
});

export function requestCustomerCase(routes, payload = {}, sessionToken = '', options = {}) {
  const candidates = Array.isArray(routes) ? routes : [routes];
  return requestFirstAvailable(
    candidates,
    (route) => apiRequest(route, payload, sessionToken, options),
    { signal: options?.signal },
  );
}

export function normalizeCustomerCaseState(value) {
  const state = String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (['EN_ESPERA', 'ESPERA', 'PENDIENTE'].includes(state)) return 'EN_ESPERA';
  if (['EN_PROCESO', 'PROCESO'].includes(state)) return 'EN_PROCESO';
  if (['FINALIZADO', 'FINALIZADA', 'FINAL'].includes(state)) return 'FINALIZADO';
  return 'EN_ESPERA';
}

export function customerCaseStateLabel(value) {
  const state = normalizeCustomerCaseState(value);
  if (state === 'EN_PROCESO') return 'En proceso';
  if (state === 'FINALIZADO') return 'Finalizado';
  return 'En espera';
}

export function customerCaseView(record = {}) {
  let technicianIds = record.TecnicoIDs || [];
  if (!Array.isArray(technicianIds)) {
    try { technicianIds = JSON.parse(record.TecnicoIDsJSON || '[]'); } catch { technicianIds = []; }
  }
  return {
    ...record,
    id: String(record.CasoID || record.caseId || record.id || ''),
    number: String(record.CasoNumero || record.caseNumber || ''),
    clientId: String(record.ClienteID || record.clientId || ''),
    client: String(record.Cliente || record.client || ''),
    reason: String(record.RazonVisita || record.reason || ''),
    problem: String(record.Problema || record.problem || ''),
    requesterName: String(record.NombreSolicitante || record.requesterName || ''),
    requesterEmail: String(record.CorreoSolicitante || record.requesterEmail || ''),
    state: normalizeCustomerCaseState(record.Estado || record.state),
    evidenceCount: Number(record.EvidenciaCount || record.evidenceCount || 0),
    requestedEvidenceCount: Number(record.EvidenciasSolicitadas || record.requestedEvidenceCount || 0),
    failedEvidenceCount: Number(record.EvidenciasFallidas || record.failedEvidenceCount || 0),
    evidenceError: String(record.UltimoErrorEvidencias || record.evidenceUploadWarning || ''),
    technicianIds: Array.isArray(technicianIds) ? technicianIds.map(String) : [],
    technicianNames: String(record.TecnicoNombres || record.technicianNames || ''),
    visitDate: String(record.FechaVisita || record.visitDate || ''),
    visitTime: String(record.HoraVisita || record.visitTime || ''),
    adminMessage: String(record.MensajeAdministrador || record.adminMessage || ''),
    ticketId: String(record.BoletaUID || record.ticketId || ''),
    ticketNumber: String(record.BoletaID || record.ticketNumber || ''),
    createdAt: String(record.FechaCreacion || record.createdAt || ''),
    finalizedAt: String(record.FechaFinalizacion || record.finalizedAt || ''),
  };
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error(`No se pudo leer ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function mimeFromFile(file) {
  const explicit = String(file?.type || '').trim().toLowerCase();
  if (explicit.startsWith('image/')) return explicit;
  const name = String(file?.name || '').toLowerCase();
  if (/\.jpe?g$/.test(name)) return 'image/jpeg';
  if (/\.png$/.test(name)) return 'image/png';
  if (/\.webp$/.test(name)) return 'image/webp';
  if (/\.gif$/.test(name)) return 'image/gif';
  if (/\.heic$/.test(name)) return 'image/heic';
  if (/\.heif$/.test(name)) return 'image/heif';
  return '';
}

async function optimizeImage(file, maxDimension = 1600, quality = 0.82) {
  const detectedMime = mimeFromFile(file);
  if (!/^image\/(jpeg|png|webp)$/i.test(detectedMime) || typeof createImageBitmap !== 'function') return file;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1 && file.size <= 4 * 1024 * 1024) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const outputType = detectedMime === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob = await canvasBlob(canvas, outputType, outputType === 'image/png' ? undefined : quality);
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, outputType === 'image/png' ? '.png' : '.jpg'), {
      type: outputType,
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  } finally {
    bitmap?.close?.();
  }
}

export async function prepareCustomerCaseEvidence(file) {
  const sourceMime = mimeFromFile(file);
  if (!sourceMime) throw new Error(`${file.name || 'El archivo'} no es una imagen compatible.`);
  const optimized = await optimizeImage(file);
  const mimeType = mimeFromFile(optimized) || sourceMime;
  const dataUrl = await fileToDataUrl(optimized);
  const comma = dataUrl.indexOf(',');
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1).replace(/[\r\n\s]/g, '') : '';
  if (!base64) throw new Error(`No se pudieron preparar los datos de ${optimized.name || file.name}.`);
  return {
    fileName: optimized.name,
    mimeType,
    size: optimized.size,
    base64,
    previewUrl: URL.createObjectURL(optimized),
  };
}

export function newCustomerCaseRequestId() {
  return globalThis.crypto?.randomUUID?.() || `case-request-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
