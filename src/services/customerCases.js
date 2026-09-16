import { uploadCustomerCaseFile } from './largeEvidenceUpload';
import { apiRequest } from '../api';
import { requestFirstAvailable } from './aliasResolver';
import {
  readSynchronizedCollectionCache,
  requestSynchronizedCollection,
  requestSynchronizedDetail,
  subscribeSyncEntity,
  subscribeSyncResource,
} from './syncManager';

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
  resendInitial: ['customerCases.resendTechnicians', 'casos.cliente.reenviarTecnicos'],
  mediaGet: ['customerCases.media.get', 'casos.cliente.media.get'],
});

function normalizedRoutes(routes) {
  return (Array.isArray(routes) ? routes : [routes]).map((route) => String(route || '').toLowerCase());
}

function storedSyncContext(sessionToken = '') {
  if (!sessionToken || typeof localStorage === 'undefined') return null;
  try {
    const stored = JSON.parse(localStorage.getItem('dms_session') || '{}');
    if (String(stored.sessionToken || '') !== String(sessionToken)) return null;
    return {
      userId: String(stored.user?.UsuarioID || stored.user?.id || ''),
      permissions: Array.isArray(stored.permissions) ? stored.permissions : [],
    };
  } catch {
    return null;
  }
}

function customerCaseEntityId(payload = {}) {
  return String(payload.caseId || payload.CasoID || payload.id || '').trim();
}

export function requestCustomerCase(routes, payload = {}, sessionToken = '', options = {}) {
  const candidates = Array.isArray(routes) ? routes : [routes];
  const syncContext = storedSyncContext(sessionToken);
  const names = normalizedRoutes(candidates);
  if (syncContext && names.some((route) => ['customercases.list', 'casos.cliente.list'].includes(route))) {
    return requestSynchronizedCollection(candidates, payload, sessionToken, {
      resource: 'customerCase',
      ...syncContext,
      signal: options?.signal,
    });
  }
  if (syncContext && names.some((route) => ['customercases.get', 'casos.cliente.get'].includes(route))) {
    const entityId = customerCaseEntityId(payload);
    if (entityId) {
      return requestSynchronizedDetail(candidates, payload, sessionToken, {
        resource: 'customerCase',
        entityId,
        ...syncContext,
        signal: options?.signal,
      });
    }
  }
  return requestFirstAvailable(
    candidates,
    (route) => apiRequest(route, payload, sessionToken, options),
    { signal: options?.signal },
  );
}

export async function readCustomerCaseListCache(payload = {}, sessionToken = '') {
  const syncContext = storedSyncContext(sessionToken);
  if (!syncContext) return null;
  return readSynchronizedCollectionCache(
    CUSTOMER_CASE_ROUTES.list,
    payload,
    { resource: 'customerCase', ...syncContext },
  );
}

export function subscribeCustomerCaseList(callback) {
  return subscribeSyncResource('customerCase', callback);
}

export function subscribeCustomerCase(entityId, callback) {
  return subscribeSyncEntity('customerCase', entityId, callback);
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

function booleanValue(value) {
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'si', 'sí', 'yes', 'prueba'].includes(String(value || '').trim().toLowerCase());
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
    requestedEvidenceCount: Number(record.EvidenciasSolicitadas || record.requestedEvidenceCount || record.EvidenciaCount || 0),
    failedEvidenceCount: Number(record.EvidenciasFallidas || record.failedEvidenceCount || 0),
    evidenceError: String(record.UltimoErrorEvidencias || record.evidenceError || ''),
    technicianIds: Array.isArray(technicianIds) ? technicianIds.map(String) : [],
    technicianNames: String(record.TecnicoNombres || record.technicianNames || ''),
    visitDate: String(record.FechaVisita || record.visitDate || ''),
    visitTime: String(record.HoraVisita || record.visitTime || ''),
    adminMessage: String(record.MensajeAdministrador || record.adminMessage || ''),
    ticketId: String(record.BoletaUID || record.ticketId || ''),
    ticketNumber: String(record.BoletaID || record.ticketNumber || ''),
    createdAt: String(record.FechaCreacion || record.createdAt || ''),
    finalizedAt: String(record.FechaFinalizacion || record.finalizedAt || ''),
    testMode: booleanValue(record.ModoPrueba || record.EsPrueba || record.testMode || record.TipoCaso),
  };
}

function mimeFromName(name) {
  const extension = String(name || '').toLowerCase().split('.').pop();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'heic') return 'image/heic';
  if (extension === 'heif') return 'image/heif';
  return '';
}

export async function prepareCustomerCaseEvidence(file) {
  return {file,evidenceId:newCustomerCaseRequestId(),fileName:file.name,mimeType:file.type || mimeFromName(file.name) || 'image/jpeg',size:file.size,previewUrl:URL.createObjectURL(file)};
}

export async function uploadCustomerCaseEvidences({token,requestId,evidences}) {
  const results=[];
  for (const item of evidences) {
    if (!item.uploadReference) {
      const uploaded=await uploadCustomerCaseFile({token,requestId,item});
      Object.assign(item,uploaded);
    }
    results.push({uploadReference:item.uploadReference,note:item.note || '',fileName:item.fileName,mimeType:item.mimeType,size:item.size});
  }
  return results;
}

export function newCustomerCaseRequestId() {
  return globalThis.crypto?.randomUUID?.() || `case-request-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
