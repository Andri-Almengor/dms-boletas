function clean(value, maxLength = 500) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function boolEnv(name, fallback) {
  const value = clean(process.env[name], 30).toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on', 'si', 'sí'].includes(value);
}

function intEnv(name, fallback, min, max) {
  const value = Number.parseInt(clean(process.env[name], 30), 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function modelEnv(name) {
  return clean(process.env[name], 160);
}

const primaryModel = modelEnv('GEMINI_PRIMARY_MODEL') || modelEnv('GEMINI_MODEL');
const fallbackModel = modelEnv('GEMINI_FALLBACK_MODEL');
const lastResortModel = modelEnv('GEMINI_LAST_RESORT_MODEL');

export const aiConfig = Object.freeze({
  enabled: boolEnv('AI_AGENT_ENABLED', boolEnv('AI_CHAT_ENABLED', true)),
  webSearchEnabled: boolEnv('AI_WEB_SEARCH_ENABLED', false),

  // GEMINI_MODEL remains a compatibility alias; no concrete model name is hardcoded.
  primaryModel,
  fallbackModel,
  lastResortModel,
  model: primaryModel,
  modelFallbackEnabled: boolEnv('AI_MODEL_FALLBACK_ENABLED', true),
  maxModelFallbacks: intEnv('AI_MAX_MODEL_FALLBACKS', 2, 0, 4),

  timezone: 'America/Costa_Rica',
  requestTimeoutMs: intEnv('AI_GEMINI_TIMEOUT_MS', 60_000, 5_000, 120_000),
  toolTimeoutMs: intEnv('AI_TOOL_TIMEOUT_MS', 15_000, 1_000, 60_000),
  totalTimeoutMs: intEnv('AI_AGENT_TOTAL_TIMEOUT_MS', 120_000, 10_000, 180_000),
  maxToolRounds: intEnv('AI_MAX_TOOL_ROUNDS', 8, 1, 12),
  maxParallelTools: intEnv('AI_MAX_PARALLEL_TOOLS', 3, 1, 4),
  maxToolResultRows: intEnv('AI_MAX_TOOL_RESULT_ROWS', 50, 5, 100),
  maxToolResultBytes: intEnv('AI_MAX_TOOL_RESULT_BYTES', 48_000, 8_000, 96_000),
  maxHistoryMessages: intEnv('AI_MAX_HISTORY_MESSAGES', 12, 2, 24),
  maxMessageChars: intEnv('AI_MAX_MESSAGE_CHARS', 5_000, 500, 12_000),
  maxOutputTokens: intEnv('AI_MAX_OUTPUT_TOKENS', 8_192, 512, 32_768),
  rateLimitPerMinute: intEnv('AI_RATE_LIMIT_PER_MINUTE', 12, 2, 60),

  writeEnabled: boolEnv('AI_WRITE_ENABLED', false),
  maintenanceWriteEnabled: boolEnv('AI_MAINTENANCE_WRITE_ENABLED', false),
  maxDeviceCreateBatch: intEnv('AI_MAX_DEVICE_CREATE_BATCH', 100, 1, 250),
  maxEvidenceUploadBatch: intEnv('AI_MAX_EVIDENCE_UPLOAD_BATCH', 50, 1, 100),
  pendingOperationTtlMinutes: intEnv('AI_PENDING_OPERATION_TTL_MINUTES', 15, 5, 120),

  knowledgeDocumentsEnabled: boolEnv('AI_KNOWLEDGE_DOCUMENTS_ENABLED', true),
  knowledgeMaxChunks: intEnv('AI_KNOWLEDGE_MAX_CHUNKS', 8, 1, 20),
  knowledgeMaxChunkBytes: intEnv('AI_KNOWLEDGE_MAX_CHUNK_BYTES', 12_000, 2_000, 32_000),
  knowledgeRecoveryBatch: intEnv('AI_KNOWLEDGE_RECOVERY_BATCH', 2, 1, 5),
  knowledgeRecoveryIntervalMs: intEnv('AI_KNOWLEDGE_RECOVERY_INTERVAL_MS', 300_000, 60_000, 3_600_000),
  knowledgeProcessingStaleMinutes: intEnv('AI_KNOWLEDGE_PROCESSING_STALE_MINUTES', 10, 2, 120),
});

export function configuredModels() {
  const values = [aiConfig.primaryModel, aiConfig.fallbackModel, aiConfig.lastResortModel].filter(Boolean);
  return [...new Set(values)];
}

export function geminiApiKey() {
  return clean(process.env.GEMINI_API_KEY, 1_000);
}
