import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const deltaSource = await readFile(new URL('../src/services/sync-delta.service.js', import.meta.url), 'utf8');
const managerSource = await readFile(new URL('../../src/services/syncManager.js', import.meta.url), 'utf8');

function functionSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing ${endMarker}`);
  return source.slice(start, end);
}

function assertOrder(source, markers, label) {
  let previous = -1;
  for (const marker of markers) {
    const index = source.indexOf(marker);
    assert.notEqual(index, -1, `${label}: missing ${marker}`);
    assert.ok(index > previous, `${label}: ${marker} must occur after the previous snapshot step`);
    previous = index;
  }
}

test('backend drains the sync outbox before exposing generation, cursor or delta rows', () => {
  const build = functionSlice(deltaSource, 'export async function buildSyncDelta', '\n}');
  assertOrder(build, [
    'await flushSyncOutbox()',
    'await getSyncDescriptor()',
    'await readSyncChangesAfter(',
  ], 'buildSyncDelta');
});

test('initial collection snapshot captures cursor before reading authoritative data and committing IndexedDB', () => {
  const request = functionSlice(
    managerSource,
    'export async function requestSynchronizedCollection',
    'export async function requestSynchronizedDetail',
  );
  const initialSnapshot = request.slice(request.indexOf('let snapshotBasis = state;'));
  assertOrder(initialSnapshot, [
    'await probeSnapshot(resource, sessionToken, signal)',
    'await authoritativeRequest(routes, payload, sessionToken, signal)',
    'await core.commitSyncCacheUpdate(',
    'scheduleSync(',
  ], 'collection snapshot');
});

test('initial detail snapshot uses the same cursor-before-snapshot ordering', () => {
  const request = functionSlice(
    managerSource,
    'export async function requestSynchronizedDetail',
    'export async function readSynchronizedCollectionCache',
  );
  const initialSnapshot = request.slice(request.indexOf('let snapshotBasis = state;'));
  assertOrder(initialSnapshot, [
    'await probeSnapshot(resource, sessionToken, signal, targetId)',
    'await authoritativeRequest(routes, payload, sessionToken, signal)',
    'await core.commitSyncCacheUpdate(',
    'scheduleDetailSync(',
  ], 'detail snapshot');
});
