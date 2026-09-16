import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const apiSource = readFileSync(new URL('../../src/api.js', import.meta.url), 'utf8');
const activitySource = readFileSync(new URL('../../src/services/mediaActivity.js', import.meta.url), 'utf8');
const largeUploadSource = readFileSync(new URL('../../src/services/largeEvidenceUpload.js', import.meta.url), 'utf8');
const syncSource = readFileSync(new URL('../../src/services/syncManager.js', import.meta.url), 'utf8');

test('media priority: la capa HTTP marca solo escrituras de media y libera en finally', () => {
  assert.match(apiSource, /function isMediaUploadRoute\(route\)/);
  assert.match(apiSource, /const mediaRoute = \['evidence', 'evidencia', 'images', 'imagenes', 'signature', 'firma', 'attachments', 'adjuntos'\]/);
  assert.match(apiSource, /const releaseMedia = isMediaUploadRoute\(route\) \? beginMediaUpload\(\) : null/);
  assert.match(apiSource, /finally \{\s*releaseMedia\?\.\(\);\s*\}/s);
});

test('media priority: una carga grande conserva una sola ventana activa durante todos sus chunks', () => {
  assert.match(largeUploadSource, /return withMediaUploadPriority\(async \(\) => \{/);
  assert.match(largeUploadSource, /while \(offset < file\.size\)/);
  assert.match(activitySource, /activeTransfers \+= 1/);
  assert.match(activitySource, /activeTransfers = Math\.max\(0, activeTransfers - 1\)/);
  assert.match(activitySource, /dms-media-upload-idle/);
});

test('media priority: sync SWR de bajo nivel no compite con uploads activos', () => {
  const scheduleBlock = syncSource.match(/function scheduleSync\(options\) \{[\s\S]*?\n\}/)?.[0] || '';
  const detailBlock = syncSource.match(/function scheduleDetailSync\(options\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(scheduleBlock, /isMediaUploadActive\(\)/);
  assert.match(detailBlock, /isMediaUploadActive\(\)/);
});

test('background sync: intervalo conservador, visible, online y sesión vigente', () => {
  assert.match(syncSource, /VITE_INCREMENTAL_SYNC_INTERVAL_MS \|\| 60_000/);
  assert.match(syncSource, /document !== 'undefined' && document\.hidden/);
  assert.match(syncSource, /!onlineNow\(\) \|\| isMediaUploadActive\(\)/);
  assert.match(syncSource, /currentSessionToken\(\)/);
  assert.match(syncSource, /window\.addEventListener\('focus'/);
  assert.match(syncSource, /window\.addEventListener\('online'/);
  assert.match(syncSource, /window\.addEventListener\('dms-media-upload-idle'/);
});

test('background sync: reutiliza recursos conocidos y sincroniza secuencialmente', () => {
  assert.match(syncSource, /const knownResourceSync = new Map\(\)/);
  assert.match(syncSource, /rememberResourceSync\(\{ resource, routes, payload, sessionToken, userId, permissions \}\)/);
  assert.match(syncSource, /for \(const \[key, options\] of knownResourceSync\.entries\(\)\)/);
  assert.match(syncSource, /await synchronizeResource\(\{ \.\.\.options, signal: undefined \}\)/);
  assert.doesNotMatch(syncSource, /Promise\.all\([^\n]*knownResourceSync/);
});
