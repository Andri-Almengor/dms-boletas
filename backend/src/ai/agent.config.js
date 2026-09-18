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

export const aiConfig = Object.freeze({
  enabled: boolEnv('AI_CHAT_ENABLED', true),
  webSearchEnabled: boolEnv('AI_WEB_SEARCH_ENABLED', false),
  model: clean(process.env.GEMINI_MODEL || 'gemini-3.5-flash', 120),
  timezone: 'America/Costa_Rica',
  requestTimeoutMs: intEnv('AI_GEMINI_TIMEOUT_MS', 35_000, 5_000, 90_000),
  toolTimeoutMs: intEnv('AI_TOOL_TIMEOUT_MS', 10_000, 1_000, 30_000),
  maxToolRounds: intEnv('AI_MAX_TOOL_ROUNDS', 8, 1, 12),
  maxParallelTools: intEnv('AI_MAX_PARALLEL_TOOLS', 3, 1, 4),
  maxToolResultRows: intEnv('AI_MAX_TOOL_RESULT_ROWS', 50, 5, 100),
  maxToolResultBytes: intEnv('AI_MAX_TOOL_RESULT_BYTES', 48_000, 8_000, 96_000),
  maxHistoryMessages: intEnv('AI_MAX_HISTORY_MESSAGES', 10, 2, 20),
  maxMessageChars: intEnv('AI_MAX_MESSAGE_CHARS', 2_500, 500, 8_000),
  rateLimitPerMinute: intEnv('AI_RATE_LIMIT_PER_MINUTE', 12, 2, 60),
  knowledgeDocumentsEnabled: boolEnv('AI_KNOWLEDGE_DOCUMENTS_ENABLED', true),
  knowledgeMaxChunks: intEnv('AI_KNOWLEDGE_MAX_CHUNKS', 8, 1, 20),
  knowledgeMaxChunkBytes: intEnv('AI_KNOWLEDGE_MAX_CHUNK_BYTES', 12_000, 2_000, 32_000),
});

export function geminiApiKey() {
  return clean(process.env.GEMINI_API_KEY, 1_000);
}
