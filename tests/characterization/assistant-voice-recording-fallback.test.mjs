import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const page = readFileSync(new URL('../../src/pages/assistant/AssistantPageSecure.jsx', import.meta.url), 'utf8');
const startIndex = page.indexOf('  async function startRecordedDictation() {');
const nextIndex = page.indexOf('  function startDictation() {', startIndex);
assert.ok(startIndex >= 0 && nextIndex > startIndex, 'recorded dictation must reuse the assistant composer');
const methodRegion = page.slice(startIndex, nextIndex);
const lastClose = methodRegion.lastIndexOf('\n  }');
assert.ok(lastClose >= 0, 'recorded dictation must have a closing brace');
const capture = methodRegion.slice(0, lastClose + 4);

function harness() {
  let stopped = 0;
  const sent = [];
  const state = { recording: false, starting: false, transcribing: false, input: '', error: '', permission: '' };
  const speechRef = { current: null };
  const recordingRef = { current: null };
  const recordingSessionRef = { current: 0 };
  const transcriptionAbortRef = { current: null };
  class Recorder {
    static isTypeSupported(value) { return value.startsWith('audio/webm'); }
    constructor(stream, options) {
      this.stream = stream;
      this.mimeType = options.mimeType;
      this.state = 'inactive';
    }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; }
  }
  const stream = { getTracks: () => [{ stop: () => { stopped += 1; } }] };
  const context = {
    sending: false, dictating: false, audioTranscribing: false, recordingStarting: false,
    microphoneRequesting: false, recordingRef, recordingSessionRef, speechRef, transcriptionAbortRef,
    MAX_VOICE_RECORDING_MS: 90000, MAX_VOICE_RECORDING_BYTES: 3 * 1024 * 1024,
    window: { isSecureContext: true, MediaRecorder: Recorder, setTimeout: () => 5, clearTimeout: () => {} },
    navigator: { mediaDevices: { getUserMedia: async () => stream } },
    Blob, AbortController,
    setError(value) { state.error = value; },
    setMicrophoneFeedback() {},
    setRecordingStarting(value) { state.starting = value; },
    setDictating(value) { state.recording = value; },
    setMicrophonePermission(value) { state.permission = value; },
    setMicrophoneHelpOpen() {},
    setAudioTranscribing(value) { state.transcribing = value; },
    setInput(update) { state.input = update(state.input); },
    sessionToken: 'token-only-in-test',
    blobBase64: async () => 'fake-base64-for-test',
    apiRequest: async (...args) => { sent.push(args); return { transcript: 'Reparación de la cámara uno' }; },
  };
  const start = runInNewContext('(' + capture.trim() + ')', context);
  return { start, recordingRef, recordingSessionRef, sent, state, getStopped: () => stopped };
}

test('el navegador sin SpeechRecognition puede activar MediaRecorder con su permiso', async () => {
  const h = harness();
  assert.equal(h.recordingRef.current, null);
  await h.start();
  assert.equal(h.state.permission, 'granted');
  assert.equal(h.state.recording, true);
  assert.equal(h.sent.length, 0, 'never transcribe before the recording ends');
  assert.equal(h.recordingRef.current.recorder.state, 'recording');
  const recorder = h.recordingRef.current.recorder;
  recorder.ondataavailable({ data: new Blob([new Uint8Array(350)], { type: 'audio/webm' }) });
  recorder.stop();
  await recorder.onstop();
  assert.equal(h.getStopped(), 1);
  assert.equal(h.state.recording, false);
  assert.equal(h.state.transcribing, false);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0][0], 'assistant.chat');
  assert.equal(h.sent[0][1].assistantAction, 'speech.transcribe');
  assert.equal(h.sent[0][1].mimeType, 'audio/webm');
  assert.match(h.state.input, /Reparación de la cámara uno/);
});

test('una cancelación no envía audio ni altera el texto', async () => {
  const h = harness();
  await h.start();
  const capture = h.recordingRef.current;
  capture.cancelled = true;
  h.recordingSessionRef.current += 1;
  capture.recorder.ondataavailable({ data: new Blob([new Uint8Array(350)], { type: 'audio/webm' }) });
  capture.recorder.stop();
  await capture.recorder.onstop();
  assert.equal(h.sent.length, 0);
  assert.equal(h.state.input, '');
  assert.equal(h.getStopped(), 1);
});

test('el micrófono no queda deshabilitado cuando hay MediaRecorder sin reconocimiento nativo', () => {
  assert.match(page, /!speechSupported && !recordingSupported/);
  assert.match(page, /function startDictation\(\) \{[\s\S]*?if \(recordingSupported\) \{\s*void startRecordedDictation\(\)/);
  assert.match(page, /function startNativeDictation\(\)/);
  assert.match(page, /speech\.transcribe/);
  assert.match(page, /Iniciar dictado/);
  assert.match(page, /transmite al backend de DMS y a Gemini/);
});
