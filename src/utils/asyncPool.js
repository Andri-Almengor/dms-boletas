function abortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error('La operación fue cancelada.');
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

export async function mapWithConcurrency(items = [], concurrency = 3, worker, { signal } = {}) {
  if (typeof worker !== 'function') throw new TypeError('Se requiere una función de trabajo.');
  const list = Array.from(items || []);
  if (!list.length) return [];

  const results = new Array(list.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, Number(concurrency) || 1), list.length);

  async function run() {
    while (true) {
      if (signal?.aborted) throw abortError(signal);
      const index = nextIndex;
      nextIndex += 1;
      if (index >= list.length) return;
      results[index] = await worker(list[index], index);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => run()));
  return results;
}
