import test from 'node:test';
import assert from 'node:assert/strict';
import { observeSyncWrite, trackSyncWrites, confirmObservedSyncWrites, syncUnloggedRevision } from '../src/core/sync-write-observer.js';

test('background operational writes invalidate generations without another Sheets call', () => {
  const before = syncUnloggedRevision();
  observeSyncWrite(new Set(['Mantenimiento']));
  assert.equal(syncUnloggedRevision(), before + 1);
});

test('confirmed business + changelog does not invalidate incremental snapshots', async () => {
  const before = syncUnloggedRevision();
  await trackSyncWrites(async () => {
    observeSyncWrite(new Set(['Boletas']));
    observeSyncWrite(new Set(['BoletaAsignados']));
    confirmObservedSyncWrites();
  });
  assert.equal(syncUnloggedRevision(), before);
});

test('partial business failure and forgotten route event force reconciliation', async () => {
  const before = syncUnloggedRevision();
  await assert.rejects(trackSyncWrites(async () => {
    observeSyncWrite(new Set(['Boletas']));
    throw new Error('after first write');
  }));
  await trackSyncWrites(async () => { observeSyncWrite(new Set(['KnowledgeArticles'])); });
  assert.equal(syncUnloggedRevision(), before + 2);
});

test('changelog, sessions and audit alone do not cause full snapshots', async () => {
  const before = syncUnloggedRevision();
  await trackSyncWrites(async () => { observeSyncWrite(new Set(['SyncChanges', 'Sesiones', 'Auditoria'])); });
  assert.equal(syncUnloggedRevision(), before);
});

test('concurrent tracked actions cannot acknowledge each others unlogged writes', async () => {
  const before = syncUnloggedRevision();
  await Promise.all([
    trackSyncWrites(async () => { observeSyncWrite(new Set(['Boletas'])); await Promise.resolve(); confirmObservedSyncWrites(); }),
    trackSyncWrites(async () => { observeSyncWrite(new Set(['Boletas'])); await Promise.resolve(); }),
  ]);
  assert.equal(syncUnloggedRevision(), before + 1);
});

test('detached worker writes after response cannot inherit a stale acknowledgment', async () => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const before = syncUnloggedRevision();
  await trackSyncWrites(async () => {
    observeSyncWrite(new Set(['Boletas']));
    confirmObservedSyncWrites();
    setTimeout(() => { observeSyncWrite(new Set(['Boletas'])); finish(); }, 0);
  });
  await pending;
  assert.equal(syncUnloggedRevision(), before + 1);
});
