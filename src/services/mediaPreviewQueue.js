const MAX_CONCURRENT_PREVIEWS = 3;

let active = 0;
let sequence = 0;
const pending = [];
const entries = new Map();

function abortError(reason) {
  if (reason instanceof Error) return reason;
  const error = new Error('La carga de la evidencia fue cancelada.');
  error.name = 'AbortError';
  return error;
}

function removePending(entry) {
  const index = pending.indexOf(entry);
  if (index >= 0) pending.splice(index, 1);
}

function cleanupSubscriber(entry, subscriber) {
  if (subscriber.signal && subscriber.onAbort) {
    subscriber.signal.removeEventListener('abort', subscriber.onAbort);
  }
  entry.subscribers.delete(subscriber);
}

function cancelIfUnused(entry) {
  if (entry.subscribers.size) return;
  if (!entry.started) {
    removePending(entry);
    if (entries.get(entry.key) === entry) entries.delete(entry.key);
    return;
  }
  entry.controller.abort();
}

function settle(entry, method, value) {
  for (const subscriber of [...entry.subscribers]) {
    cleanupSubscriber(entry, subscriber);
    if (!subscriber.settled) {
      subscriber.settled = true;
      subscriber[method](value);
    }
  }
}

function pump() {
  while (active < MAX_CONCURRENT_PREVIEWS && pending.length) {
    pending.sort((left, right) => right.priority - left.priority || left.sequence - right.sequence);
    const entry = pending.shift();
    if (!entry || entry.started || !entry.subscribers.size) continue;

    entry.started = true;
    active += 1;
    Promise.resolve()
      .then(() => entry.task(entry.controller.signal))
      .then(
        (value) => settle(entry, 'resolve', value),
        (error) => settle(entry, 'reject', error),
      )
      .finally(() => {
        active = Math.max(0, active - 1);
        if (entries.get(entry.key) === entry) entries.delete(entry.key);
        pump();
      });
  }
}

export function scheduleMediaPreview(key, task, { signal, priority = 0 } = {}) {
  if (typeof task !== 'function') throw new TypeError('task debe ser una función.');
  if (signal?.aborted) return Promise.reject(abortError(signal.reason));

  const normalizedKey = String(key || `preview-${++sequence}`);
  let entry = entries.get(normalizedKey);
  if (!entry) {
    entry = {
      key: normalizedKey,
      task,
      priority: Number(priority) || 0,
      sequence: ++sequence,
      started: false,
      controller: new AbortController(),
      subscribers: new Set(),
    };
    entries.set(normalizedKey, entry);
    pending.push(entry);
  } else if (!entry.started) {
    entry.priority = Math.max(entry.priority, Number(priority) || 0);
  }

  return new Promise((resolve, reject) => {
    const subscriber = {
      resolve,
      reject,
      signal,
      settled: false,
      onAbort: null,
    };

    subscriber.onAbort = () => {
      if (subscriber.settled) return;
      subscriber.settled = true;
      cleanupSubscriber(entry, subscriber);
      reject(abortError(signal?.reason));
      cancelIfUnused(entry);
      pump();
    };

    entry.subscribers.add(subscriber);
    signal?.addEventListener('abort', subscriber.onAbort, { once: true });
    pump();
  });
}

export function mediaPreviewQueueSnapshot() {
  return {
    active,
    pending: pending.length,
    inflight: entries.size,
    maxConcurrent: MAX_CONCURRENT_PREVIEWS,
  };
}

export function resetMediaPreviewQueueForTests() {
  for (const entry of entries.values()) entry.controller.abort();
  pending.splice(0, pending.length);
  entries.clear();
  active = 0;
}

export const MEDIA_PREVIEW_QUEUE_POLICY = Object.freeze({
  maxConcurrent: MAX_CONCURRENT_PREVIEWS,
});
