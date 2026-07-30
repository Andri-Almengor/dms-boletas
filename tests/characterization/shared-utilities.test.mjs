import assert from 'node:assert/strict';
import test from 'node:test';
import { fileToBase64 } from '../../src/utils/fileEncoding.js';
import { createLocalId } from '../../src/utils/localId.js';

test('createLocalId conserva el prefijo solicitado', () => {
  const id = createLocalId('dispositivo');
  assert.match(id, /^dispositivo-.+/);
});

test('createLocalId genera un identificador sin prefijo cuando no se solicita', () => {
  const id = createLocalId();
  assert.equal(typeof id, 'string');
  assert.ok(id.length > 5);
});

test('fileToBase64 devuelve únicamente el contenido posterior a la coma', async () => {
  const previousFileReader = globalThis.FileReader;
  class FakeFileReader {
    readAsDataURL(file) {
      this.result = `data:${file.type};base64,QUJDRA==`;
      queueMicrotask(() => this.onload?.());
    }
  }
  globalThis.FileReader = FakeFileReader;
  try {
    assert.equal(await fileToBase64({ type: 'text/plain' }), 'QUJDRA==');
  } finally {
    globalThis.FileReader = previousFileReader;
  }
});

test('fileToBase64 propaga el error de lectura', async () => {
  const previousFileReader = globalThis.FileReader;
  const expected = new Error('fallo simulado');
  class FakeFileReader {
    readAsDataURL() {
      this.error = expected;
      queueMicrotask(() => this.onerror?.());
    }
  }
  globalThis.FileReader = FakeFileReader;
  try {
    await assert.rejects(fileToBase64({}), expected);
  } finally {
    globalThis.FileReader = previousFileReader;
  }
});
