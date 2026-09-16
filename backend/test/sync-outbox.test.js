import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyncOutbox } from '../src/core/sync-outbox.js';

function change(resource, entityId, operation = 'UPSERT', sourceRoute = 'test.update') {
  return { resource, entityId, operation, sourceRoute };
}

test('outbox dedupes repeated aggregate mutations and flushes them in one append', async () => {
  const batches = [];
  const outbox = createSyncOutbox({
    maxEvents: 10,
    append: async (batch) => {
      batches.push(batch.map((item) => ({ ...item })));
      return batch;
    },
  });

  await outbox.enqueue([change('ticket', 'B-1', 'UPSERT', 'first')]);
  await outbox.enqueue([
    change('ticket', 'B-1', 'UPSERT', 'latest'),
    change('ticket', 'B-2'),
  ]);

  assert.equal(outbox.snapshot().pending, 2);
  await outbox.flush();
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 2);
  assert.equal(batches[0].find((item) => item.entityId === 'B-1').sourceRoute, 'latest');
  assert.equal(outbox.snapshot().pending, 0);
});

test('outbox stays bounded and flushes once the configured event limit is reached', async () => {
  const sizes = [];
  const outbox = createSyncOutbox({
    maxEvents: 2,
    append: async (batch) => {
      sizes.push(batch.length);
      return batch;
    },
  });

  await outbox.enqueue([change('ticket', 'B-1')]);
  const second = await outbox.enqueue([change('ticket', 'B-2')]);
  assert.equal(second.flushedBatches, 1);
  assert.deepEqual(sizes, [2]);
  assert.equal(outbox.snapshot().pending, 0);

  await outbox.enqueue([change('ticket', 'B-3')]);
  assert.equal(outbox.snapshot().pending, 1);
});

test('explicit drain includes changes queued while a previous append is in flight', async () => {
  const batches = [];
  let releaseFirst;
  const firstPending = new Promise((resolve) => { releaseFirst = resolve; });
  let calls = 0;
  const outbox = createSyncOutbox({
    maxEvents: 10,
    append: async (batch) => {
      calls += 1;
      batches.push(batch.map((item) => item.entityId));
      if (calls === 1) await firstPending;
      return batch;
    },
  });

  await outbox.enqueue([change('ticket', 'B-1')]);
  const draining = outbox.flush();
  await Promise.resolve();
  await outbox.enqueue([change('ticket', 'B-2')]);
  releaseFirst();
  await draining;

  assert.deepEqual(batches, [['B-1'], ['B-2']]);
  assert.equal(outbox.snapshot().pending, 0);
});

test('flush failure invokes unsafe fallback and never rethrows after business confirmation', async () => {
  const failures = [];
  const outbox = createSyncOutbox({
    maxEvents: 10,
    append: async () => { throw new Error('quota'); },
    onFailure: async (error, batch) => failures.push({ message: error.message, size: batch.length }),
  });

  await outbox.enqueue([change('ticket', 'B-1')]);
  const result = await outbox.flush();
  assert.equal(result.unsafe, true);
  assert.deepEqual(failures, [{ message: 'quota', size: 1 }]);
  assert.equal(outbox.snapshot().pending, 0);
  assert.equal(outbox.snapshot().failures, 1);
});
