export function createLocalId(prefix = '') {
  const random = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const normalizedPrefix = String(prefix || '').trim();
  return normalizedPrefix ? `${normalizedPrefix}-${random}` : random;
}
