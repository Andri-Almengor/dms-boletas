import { aiConfig } from './agent.config.js';

const FORBIDDEN_KEY = /(password|passwd|contrasena|contraseña|hash|salt|secret|token|private.?key|database.?url|smtp|webhook|cipher|passwordiv|passwordtag|session|drivefileid|archivoid|fileid|firmaarchivoid)/i;
const SAFE_CONTEXT_KEYS = new Set([
  'lastClientId',
  'lastClientName',
  'lastMaintenanceId',
  'lastMaintenanceName',
  'lastTicketId',
  'lastTicketNumber',
  'lastKnowledgeId',
  'lastKnowledgeArticleId',
  'lastKnowledgeDocumentId',
  'lastKnowledgeDocumentName',
  'lastEvidenceStage',
  'pendingOperationId',
  'pendingUploadIds',
  'lastCaseId',
  'lastUserId',
  'lastUserName',
  'lastDeviceId',
  'lastDeviceName',
  'lastIntent',
  'lastSearchTool',
  'lastSearchQuery',
  'lastSearchOffset',
  'lastSearchLimit',
  'lastSearchStatus',
  'lastSearchPeriod',
]);

function cleanString(value, maxLength = 6_000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function sanitizeValue(value, depth = 0) {
  if (depth > 8) return '[recortado]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return cleanString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.slice(0, aiConfig.maxToolResultRows).map((item) => sanitizeValue(item, depth + 1));
  }
  if (typeof value !== 'object') return cleanString(value);

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) continue;
    output[key] = sanitizeValue(item, depth + 1);
  }
  return output;
}

function boundedJson(value) {
  let current = sanitizeValue(value);
  let encoded = JSON.stringify(current);
  if (Buffer.byteLength(encoded, 'utf8') <= aiConfig.maxToolResultBytes) return current;

  if (Array.isArray(current?.items)) {
    const copy = { ...current };
    while (copy.items.length > 1 && Buffer.byteLength(JSON.stringify(copy), 'utf8') > aiConfig.maxToolResultBytes) {
      copy.items = copy.items.slice(0, Math.max(1, Math.floor(copy.items.length / 2)));
      copy.truncated = true;
    }
    current = copy;
    encoded = JSON.stringify(current);
  }

  if (Buffer.byteLength(encoded, 'utf8') > aiConfig.maxToolResultBytes) {
    return {
      truncated: true,
      message: 'El resultado fue recortado por el backend para proteger memoria y contexto.',
      preview: cleanString(encoded, Math.max(1_000, aiConfig.maxToolResultBytes - 1_000)),
    };
  }
  return current;
}

export function sanitizeAiToolResult(toolName, result = {}) {
  const modelData = boundedJson(result.modelData ?? result.data ?? result);
  return {
    tool: cleanString(toolName, 120),
    modelData,
    ui: {
      entities: Array.isArray(result.entities) ? sanitizeValue(result.entities).slice(0, 50) : [],
      attachments: Array.isArray(result.attachments) ? result.attachments.slice(0, 50).map((item) => ({
        type: cleanString(item.type, 40),
        title: cleanString(item.title, 300),
        subtitle: cleanString(item.subtitle, 500),
        url: cleanString(item.url, 4_000),
        mimeType: cleanString(item.mimeType, 150),
        entityType: cleanString(item.entityType, 80),
        entityId: cleanString(item.entityId, 250),
      })) : [],
      sources: Array.isArray(result.sources) ? sanitizeValue(result.sources).slice(0, 50) : [],
      confirmations: Array.isArray(result.confirmations) ? sanitizeValue(result.confirmations).slice(0, 10) : [],
      context: sanitizeActiveContext(result.context || {}),
    },
  };
}

export function sanitizeActiveContext(raw = {}) {
  const output = {};
  for (const key of SAFE_CONTEXT_KEYS) {
    if (raw[key] === undefined || raw[key] === null || raw[key] === '') continue;
    if (key === 'pendingUploadIds' && Array.isArray(raw[key])) {
      output[key] = raw[key].slice(0, aiConfig.maxEvidenceUploadBatch).map((value) => cleanString(value, 250)).filter(Boolean);
    } else {
      output[key] = cleanString(raw[key], 300);
    }
  }

  const page = raw.pageContext;
  if (page && typeof page === 'object') {
    const route = cleanString(page.route, 500);
    output.pageContext = {
      ...(route.startsWith('/') ? { route } : {}),
      entityType: cleanString(page.entityType, 80),
      entityId: cleanString(page.entityId, 250),
      clientId: cleanString(page.clientId, 250),
      maintenanceId: cleanString(page.maintenanceId, 250),
      ticketId: cleanString(page.ticketId, 250),
    };
  }
  return output;
}

export function containsForbiddenField(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsForbiddenField);
  return Object.entries(value).some(([key, item]) => FORBIDDEN_KEY.test(key) || containsForbiddenField(item));
}
