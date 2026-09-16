export function createSyncOutbox({ append, onFailure = async () => {}, maxEvents = 250 } = {}) {
  if (typeof append !== 'function') throw new TypeError('sync outbox requires append');
  const limit = Math.max(1, Number(maxEvents || 1));
  const pending = new Map();
  let flushPromise = null;
  let flushes = 0;
  let failures = 0;
  let appendedEvents = 0;

  function keyFor(change = {}) {
    const resource = String(change.resource || '').trim();
    const entityId = String(change.entityId || '').trim();
    return resource && entityId ? `${resource}:${entityId}` : '';
  }

  async function persist(batch) {
    try {
      const result = await append(batch);
      flushes += 1;
      appendedEvents += batch.length;
      return { ok: true, unsafe: false, batchSize: batch.length, result };
    } catch (error) {
      failures += 1;
      try { await onFailure(error, batch); } catch { /* generation/process fallback remains authoritative */ }
      return { ok: false, unsafe: true, batchSize: batch.length, error };
    }
  }

  async function flush({ drain = true } = {}) {
    let last = { ok: true, unsafe: false, batchSize: 0, result: [] };
    do {
      if (!flushPromise) {
        if (!pending.size) return last;
        const batch = [...pending.values()];
        pending.clear();
        flushPromise = persist(batch).finally(() => { flushPromise = null; });
      }
      last = await flushPromise;
      if (!last.ok || !drain) return last;
    } while (pending.size);
    return last;
  }

  async function enqueue(changes = []) {
    let accepted = 0;
    let flushedBatches = 0;
    for (const change of Array.isArray(changes) ? changes : []) {
      const key = keyFor(change);
      if (!key) continue;
      // Latest authoritative mutation wins for one aggregate until the outbox
      // is flushed. The final cursor still advances once for that aggregate.
      pending.set(key, change);
      accepted += 1;
      if (pending.size >= limit) {
        const flushed = await flush({ drain: false });
        flushedBatches += 1;
        if (!flushed.ok) {
          return { accepted, pending: pending.size, flushedBatches, unsafe: true };
        }
      }
    }
    return { accepted, pending: pending.size, flushedBatches, unsafe: false };
  }

  function snapshot() {
    return {
      pending: pending.size,
      flushing: Boolean(flushPromise),
      maxEvents: limit,
      flushes,
      failures,
      appendedEvents,
    };
  }

  return { enqueue, flush, snapshot };
}
