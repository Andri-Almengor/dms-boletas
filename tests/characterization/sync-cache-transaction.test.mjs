import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSyncFixture, loadSyncManager } from '../helpers/load-sync-fixture.mjs';

const state = { generation: 'g1', cursor: 10, cacheScope: 'u:1', schemaVersion: 1 };
const key = 'u:1|boletas.list|{}';
async function fixture() {
  const core = await loadSyncFixture();
  await core.setOfflineMeta('state', state);
  await core.cacheResponse(key, { items: [{ BoletaUID: 'B1', Titulo: 'old' }] });
  await core.cacheResponse('u:2|boletas.list|{}', { private: 'other-user' });
  return core;
}
const options = () => ({ stateKey: 'state', expectedState: state, nextState: { ...state, cursor: 11 }, cachePrefix: 'u:1|', predicate: () => true });

test('sync transaction commits cache and cursor together and isolates other users', async () => {
  const core = await fixture();
  const result = await core.commitSyncCacheUpdate({ ...options(), updater: () => ({ items: [{ BoletaUID: 'B1', Titulo: 'new' }] }) });
  assert.equal(result.committed, true);
  assert.equal((await core.getOfflineMeta('state')).value.cursor, 11);
  assert.equal((await core.readCachedResponse(key)).items[0].Titulo, 'new');
  assert.deepEqual(await core.readCachedResponse('u:2|boletas.list|{}'), { private: 'other-user' });
});

test('patch failure rolls back every response and cursor', async () => {
  const core = await fixture();
  await core.cacheResponse('u:1|boletas.list|{"page":2}', { items: [] });
  let seen = 0;
  await assert.rejects(core.commitSyncCacheUpdate({ ...options(), updater: () => {
    if (++seen === 2) throw new Error('broken cache');
    return { changed: true };
  } }), /broken cache/);
  assert.equal((await core.getOfflineMeta('state')).value.cursor, 10);
  assert.equal((await core.readCachedResponse(key)).items[0].Titulo, 'old');
});

test('concurrent stale delta and snapshot cannot overwrite a newer committed state', async () => {
  const core = await fixture();
  const first = core.commitSyncCacheUpdate({ ...options(), updater: () => ({ newer: true }) });
  const stale = core.commitSyncCacheUpdate({ ...options(), snapshotKey: key, snapshotData: { stale: true } });
  const results = await Promise.all([first, stale]);
  assert.deepEqual(results.map((r) => r.committed), [true, false]);
  assert.deepEqual(await core.readCachedResponse(key), { newer: true });
});

test('reconciliation replaces one query and invalidates sibling queries atomically', async () => {
  const core = await fixture();
  const sibling = 'u:1|tickets.list|{"status":"FINALIZADA"}';
  await core.cacheResponse(sibling, { obsolete: true });
  await core.commitSyncCacheUpdate({
    ...options(), nextState: { ...state, generation: 'g2', cursor: 3 },
    replaceResource: true, snapshotKey: key, snapshotData: { correct: true },
  });
  assert.deepEqual(await core.readCachedResponse(key), { correct: true });
  assert.equal(await core.readCachedResponse(sibling), null);
  assert.equal((await core.getOfflineMeta('state')).value.generation, 'g2');
});

test('no-change revisit does not rewrite responses or emit React updates', async () => {
  const core = await loadSyncFixture();
  let calls = [];
  const delta = { ...state, resource: 'ticket', enabled: true, fullSnapshotRequired: false, upserts: [], removed: [], invalidated: [], counts: null };
  const manager = await loadSyncManager(core, async (route, payload) => {
    calls.push(route);
    if (route === 'sync.delta') return { ...delta, fullSnapshotRequired: !payload.generation, snapshotCursor: 10 };
    return { items: [{ BoletaUID: 'B1', Estado: 'PENDIENTE' }], total: 1 };
  });
  const opts = { resource: 'ticket', userId: '1', permissions: [] };
  const snapshot = await manager.requestSynchronizedCollection(['boletas.list'], {}, 'token', opts);
  let emits = 0;
  manager.subscribeSyncResource('ticket', () => { emits += 1; });
  const before = await core.getOfflineMeta('incremental-sync:ticket:1:ztntfp');
  assert.ok(before);
  calls = [];
  const revisit = await manager.requestSynchronizedCollection(['boletas.list'], {}, 'token', { ...opts, forceSync: true });
  assert.deepEqual(revisit, snapshot);
  assert.deepEqual(calls, ['sync.delta']);
  assert.equal(emits, 0);
  assert.deepEqual(await core.getOfflineMeta('incremental-sync:ticket:1:ztntfp'), before);
});
