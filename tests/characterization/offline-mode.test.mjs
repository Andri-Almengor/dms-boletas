import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasOfflineModePreference,
  isOfflineModeEnabled,
  preserveExistingOfflineQueue,
  setOfflineModeEnabled,
} from '../../src/services/offlineMode.js';

test('el modo offline permanece desactivado por defecto fuera del navegador', async () => {
  assert.equal(hasOfflineModePreference(), false);
  assert.equal(isOfflineModeEnabled(), false);
  assert.equal(await preserveExistingOfflineQueue(), false);
});

test('activar offline no inventa persistencia cuando localStorage no existe', () => {
  assert.equal(setOfflineModeEnabled(true), true);
  assert.equal(isOfflineModeEnabled(), false);
});
