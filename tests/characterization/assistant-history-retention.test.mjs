import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const retentionModule = await import(pathToFileURL(path.join(ROOT, 'src/services/assistantHistoryRetention.js')).href);

const {
  ASSISTANT_HISTORY_RETENTION_MS,
  assistantHistoryStorageKeys,
  ensureAssistantHistoryRetention,
} = retentionModule;

class MemoryStorage {
  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries));
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

test('la retención del chatbot está fijada exactamente en 24 horas', () => {
  assert.equal(ASSISTANT_HISTORY_RETENTION_MS, 24 * 60 * 60 * 1000);
});

test('la primera apertura inicia una ventana de 24 horas sin borrar el historial', () => {
  const now = 1_000_000;
  const keys = assistantHistoryStorageKeys('tecnico-1');
  const storage = new MemoryStorage({
    [keys.messages]: '[{"role":"user","text":"hola"}]',
    [keys.context]: '{"cliente":"AFZ"}',
    [keys.conversation]: 'conversation-1',
  });

  const result = ensureAssistantHistoryRetention({ userId: 'tecnico-1', storage, now });

  assert.equal(result.expired, false);
  assert.equal(result.expiresAt, now + ASSISTANT_HISTORY_RETENTION_MS);
  assert.ok(storage.getItem(keys.messages));
  assert.ok(storage.getItem(keys.context));
  assert.ok(storage.getItem(keys.conversation));
});

test('antes de cumplir 24 horas conserva mensajes, contexto y conversación', () => {
  const startedAt = 5_000_000;
  const keys = assistantHistoryStorageKeys('admin-1');
  const storage = new MemoryStorage({
    [keys.messages]: '[{"role":"assistant","text":"respuesta"}]',
    [keys.context]: '{"cliente":"Asamblea"}',
    [keys.conversation]: 'conversation-2',
    [keys.expiresAt]: String(startedAt + ASSISTANT_HISTORY_RETENTION_MS),
  });

  const result = ensureAssistantHistoryRetention({
    userId: 'admin-1',
    storage,
    now: startedAt + ASSISTANT_HISTORY_RETENTION_MS - 1,
  });

  assert.equal(result.expired, false);
  assert.ok(storage.getItem(keys.messages));
  assert.ok(storage.getItem(keys.context));
  assert.ok(storage.getItem(keys.conversation));
});

test('al cumplir 24 horas elimina el historial completo y crea una ventana nueva', () => {
  const startedAt = 9_000_000;
  const expiresAt = startedAt + ASSISTANT_HISTORY_RETENTION_MS;
  const keys = assistantHistoryStorageKeys('admin-2');
  const storage = new MemoryStorage({
    [keys.messages]: '[{"role":"user","text":"consulta"}]',
    [keys.context]: '{"lastClientId":"cliente-1"}',
    [keys.conversation]: 'conversation-3',
    [keys.expiresAt]: String(expiresAt),
  });

  const result = ensureAssistantHistoryRetention({
    userId: 'admin-2',
    storage,
    now: expiresAt,
  });

  assert.equal(result.expired, true);
  assert.equal(storage.getItem(keys.messages), null);
  assert.equal(storage.getItem(keys.context), null);
  assert.equal(storage.getItem(keys.conversation), null);
  assert.equal(Number(storage.getItem(keys.expiresAt)), expiresAt + ASSISTANT_HISTORY_RETENTION_MS);
});

test('la pantalla comprueba expiración abierta, al enfocar y al volver a la pestaña', () => {
  const page = readFileSync(path.join(ROOT, 'src/pages/assistant/AssistantPage.jsx'), 'utf8');

  assert.match(page, /ensureAssistantHistoryRetention/);
  assert.match(page, /window\.setTimeout/);
  assert.match(page, /window\.addEventListener\('focus'/);
  assert.match(page, /document\.addEventListener\('visibilitychange'/);
  assert.match(page, /AssistantPageSecure key=/);
});
