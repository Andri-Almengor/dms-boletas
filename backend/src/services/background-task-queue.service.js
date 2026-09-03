function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

export function createBackgroundTaskQueue({
  name = 'background',
  maxConcurrent = 1,
  queueLimit = 100,
  onError = null,
} = {}) {
  const concurrency = positiveInteger(maxConcurrent, 1);
  const limit = Math.max(0, Number(queueLimit) || 0);
  const queue = [];
  const keys = new Set();
  const idleWaiters = new Set();
  let active = 0;
  let started = 0;
  let completed = 0;
  let failed = 0;
  let rejected = 0;
  let deduplicated = 0;
  let maximumQueued = 0;

  function resolveIdle() {
    if (active || queue.length) return;
    for (const resolve of idleWaiters) resolve(true);
    idleWaiters.clear();
  }

  function snapshot() {
    return {
      name,
      active,
      queued: queue.length,
      maxConcurrent: concurrency,
      queueLimit: limit,
      started,
      completed,
      failed,
      rejected,
      deduplicated,
      maximumQueued,
    };
  }

  function drain() {
    while (active < concurrency && queue.length) {
      const entry = queue.shift();
      active += 1;
      started += 1;

      Promise.resolve()
        .then(entry.task)
        .then(
          (result) => {
            completed += 1;
            entry.onResult?.(result);
          },
          (error) => {
            failed += 1;
            entry.onFailure?.(error);
            onError?.(error, entry.meta || null);
          },
        )
        .finally(() => {
          active = Math.max(0, active - 1);
          if (entry.key) keys.delete(entry.key);
          drain();
          resolveIdle();
        });
    }
  }

  function enqueue(task, { key = '', meta = null, onResult = null, onFailure = null } = {}) {
    if (typeof task !== 'function') throw new TypeError('La tarea en segundo plano debe ser una función.');
    const normalizedKey = String(key || '').trim();
    if (normalizedKey && keys.has(normalizedKey)) {
      deduplicated += 1;
      return { accepted: true, deduplicated: true, snapshot: snapshot() };
    }
    if (queue.length >= limit) {
      rejected += 1;
      return { accepted: false, reason: 'QUEUE_FULL', snapshot: snapshot() };
    }

    if (normalizedKey) keys.add(normalizedKey);
    queue.push({ task, key: normalizedKey, meta, onResult, onFailure });
    maximumQueued = Math.max(maximumQueued, queue.length);
    queueMicrotask(drain);
    return { accepted: true, deduplicated: false, snapshot: snapshot() };
  }

  async function waitForIdle(timeoutMs = 10_000) {
    if (!active && !queue.length) return true;
    return new Promise((resolve) => {
      let settled = false;
      let timer = null;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        idleWaiters.delete(onIdle);
        if (timer) clearTimeout(timer);
        resolve(value);
      };
      const onIdle = () => finish(true);
      idleWaiters.add(onIdle);
      timer = timeoutMs > 0
        ? setTimeout(() => finish(false), timeoutMs)
        : null;
      timer?.unref?.();
    });
  }

  return {
    enqueue,
    snapshot,
    waitForIdle,
  };
}
