import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const page = readFileSync(new URL('../../src/pages/assistant/AssistantPageSecure.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../src/styles/assistant.css', import.meta.url), 'utf8');
const functionSource = page.match(/  async function requestMicrophonePermission\(\) \{[\s\S]*?\n  \}\n\n  \/\/ SpeechRecognition/);
assert.ok(functionSource, 'the existing assistant page must own the permission request');

function permissionHarness({ getUserMedia, secure = true, speechSupported = true, recordingSupported = false } = {}) {
  const state = { requesting: false, permission: 'prompt', feedback: '', help: false, calls: 0 };
  const context = {
    sending: false,
    dictating: false,
    microphoneRequesting: false,
    speechSupported,
    recordingSupported,
    window: { isSecureContext: secure },
    navigator: {
      mediaDevices: getUserMedia && {
        getUserMedia: async (constraints) => {
          state.calls += 1;
          assert.equal(constraints.audio, true);
          return getUserMedia();
        },
      },
    },
    setMicrophoneRequesting(value) { state.requesting = value; },
    setMicrophonePermission(value) { state.permission = value; },
    setMicrophoneFeedback(value) { state.feedback = value; },
    setMicrophoneHelpOpen(value) { state.help = value; },
  };
  const request = runInNewContext('(' + functionSource[0].replace(/\n\n  \/\/ SpeechRecognition$/, '').trim() + ')', context);
  return { request, state };
}

test('un clic autoriza el micrófono, detiene sus pistas y no inicia el dictado', async () => {
  let stopped = 0;
  const { request, state } = permissionHarness({ getUserMedia: () => ({
    getTracks: () => [{ stop() { stopped += 1; } }],
  }) });
  assert.equal(state.calls, 0, 'no microphone capture before a user gesture');
  await request();
  assert.equal(state.calls, 1);
  assert.equal(stopped, 1, 'the temporary stream must be released');
  assert.equal(state.permission, 'granted');
  assert.equal(state.requesting, false);
  assert.equal(state.help, false);
  assert.match(state.feedback, /autorizado/);
  assert.match(page, /onClick=\{requestMicrophonePermission\}/);
  assert.doesNotMatch(functionSource[0], /recognition\.start\(/);
});

test('un permiso rechazado muestra recuperación sin reintentos automáticos', async () => {
  const { request, state } = permissionHarness({
    getUserMedia: () => { throw { name: 'NotAllowedError' }; },
  });
  await request();
  assert.equal(state.calls, 1);
  assert.equal(state.permission, 'denied');
  assert.equal(state.requesting, false);
  assert.equal(state.help, true);
  assert.match(state.feedback, /bloqueado|rechazado/i);
  assert.match(page, /PC \(Chrome\/Edge\)/);
  assert.match(page, /Android:/);
  assert.match(page, /iPhone\/iPad:/);
});

test('el navegador sin contexto seguro muestra ayuda sin pedir audio', async () => {
  const { request, state } = permissionHarness({ secure: false, getUserMedia: () => {
    throw new Error('should not capture audio');
  } });
  await request();
  assert.equal(state.calls, 0);
  assert.equal(state.help, true);
  assert.match(state.feedback, /HTTPS/);
});

test('dictado no soportado no promete que conceder permiso lo habilite', async () => {
  const { request, state } = permissionHarness({
    speechSupported: false,
    getUserMedia: () => ({ getTracks: () => [] }),
  });
  await request();
  assert.match(state.feedback, /no permite grabar ni reconocer voz/i);
  assert.match(state.feedback, /teclado/i);
});

test('cuando no hay reconocimiento nativo, la autorización ofrece grabación con Gemini', async () => {
  const { request, state } = permissionHarness({
    speechSupported: false,
    recordingSupported: true,
    getUserMedia: () => ({ getTracks: () => [] }),
  });
  await request();
  assert.match(state.feedback, /Pulse «Iniciar dictado» para grabar/i);
  assert.match(page, /speech\.transcribe/);
});

test('los controles de permiso se integran al composer y a su tema', () => {
  assert.match(page, /className="assistant-microphone-access"/);
  assert.match(page, /aria-expanded=\{microphoneHelpOpen\}/);
  assert.match(page, /Comprobando…/);
  assert.match(page, /onClick=\{\(\) => setMicrophoneHelpOpen/);
  assert.match(css, /\.assistant-microphone-access__instructions\s*\{[^}]*var\(--outline-soft\)/s);
  assert.match(css, /\.assistant-microphone-access__action:focus-visible/s);
});
