export const ASSISTANT_HISTORY_RETENTION_MS = 24 * 60 * 60 * 1000;

function normalizedUserId(userId) {
  return String(userId || 'user').trim() || 'user';
}

export function assistantHistoryStorageKeys(userId) {
  const suffix = normalizedUserId(userId);
  return {
    messages: `dms_assistant_messages_${suffix}`,
    context: `dms_assistant_context_${suffix}`,
    conversation: `dms_assistant_conversation_${suffix}`,
    expiresAt: `dms_assistant_expires_at_${suffix}`,
  };
}

function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function clearAssistantHistory(storage, keys) {
  storage.removeItem(keys.messages);
  storage.removeItem(keys.context);
  storage.removeItem(keys.conversation);
}

export function ensureAssistantHistoryRetention({
  userId,
  storage = globalThis.localStorage,
  now = Date.now(),
} = {}) {
  const keys = assistantHistoryStorageKeys(userId);
  if (!storage) {
    return {
      expired: false,
      expiresAt: now + ASSISTANT_HISTORY_RETENTION_MS,
      keys,
    };
  }

  const currentExpiry = safeNumber(storage.getItem(keys.expiresAt));
  if (!currentExpiry) {
    const expiresAt = now + ASSISTANT_HISTORY_RETENTION_MS;
    storage.setItem(keys.expiresAt, String(expiresAt));
    return { expired: false, expiresAt, keys };
  }

  if (now < currentExpiry) {
    return { expired: false, expiresAt: currentExpiry, keys };
  }

  clearAssistantHistory(storage, keys);
  const expiresAt = now + ASSISTANT_HISTORY_RETENTION_MS;
  storage.setItem(keys.expiresAt, String(expiresAt));
  return { expired: true, expiresAt, keys };
}

export function restartAssistantHistoryRetention({
  userId,
  storage = globalThis.localStorage,
  now = Date.now(),
} = {}) {
  const keys = assistantHistoryStorageKeys(userId);
  const expiresAt = now + ASSISTANT_HISTORY_RETENTION_MS;
  if (storage) storage.setItem(keys.expiresAt, String(expiresAt));
  return { expiresAt, keys };
}
