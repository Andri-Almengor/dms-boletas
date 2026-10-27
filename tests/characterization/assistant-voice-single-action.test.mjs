import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const page = readFileSync(new URL('../../src/pages/assistant/AssistantPageSecure.jsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../../src/styles/assistant.css', import.meta.url), 'utf8');
const match = page.match(/  function startDictation\(\) \{[\s\S]*?\n  \}\n\n  function startNativeDictation/);
assert.ok(match, 'the existing microphone button must use a single shared entry point');

function dispatch({ recordingSupported, speechSupported }) {
  const state = { recorder: 0, native: 0, error: '', help: false };
  const context = {
    recordingSupported, speechSupported,
    startRecordedDictation: async () => { state.recorder += 1; },
    startNativeDictation: () => { state.native += 1; },
    setError: (message) => { state.error = message; },
    setMicrophoneHelpOpen: (open) => { state.help = open; },
  };
  const start = runInNewContext('(' + match[0].replace(/\n\n  function startNativeDictation$/, '').trim() + ')', context);
  start();
  return state;
}

test('Chrome con ambas API usa captura real en vez del reconocimiento nativo propenso a fallar', () => {
  const state = dispatch({ recordingSupported: true, speechSupported: true });
  assert.equal(state.recorder, 1);
  assert.equal(state.native, 0);
  assert.equal(state.error, '');
});

test('Safari o Android con grabación y sin SpeechRecognition también activan captura', () => {
  const state = dispatch({ recordingSupported: true, speechSupported: false });
  assert.equal(state.recorder, 1);
  assert.equal(state.native, 0);
});

test('solo si no hay grabación se usa el servicio nativo y si no hay API se explica por qué', () => {
  const native = dispatch({ recordingSupported: false, speechSupported: true });
  assert.equal(native.native, 1);
  assert.equal(native.recorder, 0);
  const unsupported = dispatch({ recordingSupported: false, speechSupported: false });
  assert.equal(unsupported.native, 0);
  assert.equal(unsupported.recorder, 0);
  assert.match(unsupported.error, /no permite grabar ni reconocer voz/i);
  assert.equal(unsupported.help, true);
});

test('el botón real es principal y el chequeo de permiso no se confunde con iniciar captura', () => {
  assert.match(page, /assistant-microphone-access__action--start"[\s\S]*?onClick=\{\(\) => dictating \? endDictation\(\) : startDictation\(\)\}/);
  assert.match(page, /Iniciar dictado/);
  assert.match(page, /Detener y transcribir/);
  assert.match(page, /Probar acceso/);
  assert.match(page, /Diagnóstico local:/);
  assert.match(styles, /\.assistant-microphone-access__action--start\s*\{[^}]*var\(--primary\)/s);
});
