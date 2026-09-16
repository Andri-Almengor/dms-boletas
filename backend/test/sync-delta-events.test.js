import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dedupeSyncEvents,
  selectSyncResourceEvents,
} from '../src/core/sync-delta-events.js';

function event(row, entityId, resource = 'ticket', operation = 'UPSERT') {
  return {
    __rowNumber: row,
    Resource: resource,
    EntityID: entityId,
    Operation: operation,
  };
}

test('dedupeSyncEvents keeps only the latest event for each entity and preserves cursor order', () => {
  const result = dedupeSyncEvents([
    event(12, 'B-1'),
    event(13, 'B-2'),
    event(14, 'B-1'),
    event(15, 'M-1', 'maintenance'),
  ], 'ticket');

  assert.deepEqual(result.map((item) => [item.__rowNumber, item.EntityID]), [
    [13, 'B-2'],
    [14, 'B-1'],
  ]);
});

test('targeted detail returns notModified when only other tickets changed', () => {
  const result = selectSyncResourceEvents([
    event(20, 'B-1'),
    event(21, 'B-2'),
  ], 'ticket', 'B-9');

  assert.equal(result.targeted, true);
  assert.equal(result.notModified, true);
  assert.deepEqual(result.events, []);
});

test('targeted detail returns only the requested ticket latest event', () => {
  const result = selectSyncResourceEvents([
    event(30, 'B-7'),
    event(31, 'B-8'),
    event(32, 'B-7'),
  ], 'ticket', 'B-7');

  assert.equal(result.targeted, true);
  assert.equal(result.notModified, false);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].__rowNumber, 32);
  assert.equal(result.events[0].EntityID, 'B-7');
});

test('collection selection still returns all deduped resource events', () => {
  const result = selectSyncResourceEvents([
    event(40, 'B-1'),
    event(41, 'B-2'),
    event(42, 'B-1'),
  ], 'ticket');

  assert.equal(result.targeted, false);
  assert.equal(result.notModified, false);
  assert.deepEqual(result.events.map((item) => item.EntityID), ['B-2', 'B-1']);
});
