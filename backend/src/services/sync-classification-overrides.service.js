import { pick } from '../core/utils.js';
import { SYNC_MUTATION_CLASS } from './sync-resource-registry.js';

const CASE_UPSERT_ROUTES = new Set([
  'customerCases.public.submit',
  'casos.cliente.public.submit',
  'customerCases.process',
  'casos.cliente.procesar',
  'customerCases.resendTechnicians',
  'casos.cliente.reenviarTecnicos',
]);

const CLIENT_LINK_ROUTES = new Set([
  'customerCases.clientLink.create',
  'casos.cliente.enlace.crear',
  'customerCases.clientLink.update',
  'casos.cliente.enlace.actualizar',
]);

const KNOWLEDGE_ATTACHMENT_ROUTES = new Set([
  'knowledge.attachments.upload',
  'baseConocimientos.adjuntos.upload',
  'conocimiento.adjuntos.upload',
  'knowledge.attachments.delete',
  'baseConocimientos.adjuntos.delete',
  'conocimiento.adjuntos.delete',
]);

function clean(value) {
  return String(value ?? '').trim();
}

function caseId(payload = {}, result = {}) {
  return clean(result?.case?.CasoID)
    || clean(result?.caseId)
    || clean(result?.CasoID)
    || clean(pick(payload, ['caseId', 'CasoID', 'id'], ''));
}

function clientId(payload = {}, result = {}) {
  return clean(result?.clientId)
    || clean(result?.ClienteID)
    || clean(result?.client?.ClienteID)
    || clean(pick(payload, ['clientId', 'ClienteID', 'id'], ''));
}

function knowledgeArticleId(payload = {}, result = {}) {
  return clean(result?.evidence?.TutorialID)
    || clean(result?.item?.TutorialID)
    || clean(result?.article?.TutorialID)
    || clean(result?.TutorialID)
    || clean(pick(payload, ['tutorialId', 'TutorialID', 'articleId', 'ArticuloID'], ''));
}

function upsert(resource, entityId, route) {
  return {
    classification: SYNC_MUTATION_CLASS.SYNC_RESOURCE,
    resource,
    entityId: clean(entityId),
    operation: 'UPSERT',
    metadata: { action: clean(route).slice(0, 120) },
  };
}

export function overrideSyncClassification({ route = '', payload = {}, result = null, classification = null } = {}) {
  const normalized = clean(route);
  if (CASE_UPSERT_ROUTES.has(normalized)) {
    const id = caseId(payload, result || {});
    return id ? upsert('customerCase', id, normalized) : classification;
  }
  if (CLIENT_LINK_ROUTES.has(normalized)) {
    const id = clientId(payload, result || {});
    return id ? upsert('client', id, normalized) : classification;
  }
  if (KNOWLEDGE_ATTACHMENT_ROUTES.has(normalized)) {
    if (result?.complete === false) {
      return { classification: SYNC_MUTATION_CLASS.NO_SYNC_REQUIRED, reason: 'knowledge_attachment_chunk' };
    }
    const id = knowledgeArticleId(payload, result || {});
    return id ? upsert('knowledgeArticle', id, normalized) : classification;
  }
  return classification;
}
