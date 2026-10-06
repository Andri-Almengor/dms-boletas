function fileAbortError() {
  const error = new Error('La lectura del archivo fue cancelada.');
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

export function normalizeFileReadError(error, file) {
  const name = String(file?.name || file?.fileName || 'la evidencia').trim() || 'la evidencia';
  const message = String(error?.message || '');
  const notReadable = error?.name === 'NotReadableError'
    || /requested file could not be read|not.?readable/i.test(message);

  if (!notReadable) {
    return error instanceof Error
      ? error
      : new Error('No fue posible leer el archivo.');
  }

  const normalized = new Error(
    `No se pudo leer “${name}” porque el navegador perdió acceso al archivo. Vuelva a tomar o seleccionar la evidencia y guárdela nuevamente.`,
  );
  normalized.name = 'NotReadableError';
  normalized.code = 'EVIDENCE_FILE_NOT_READABLE';
  normalized.cause = error;
  return normalized;
}

export function fileToBase64(file, { signal } = {}) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('No se recibió el archivo que se debe leer.'));
      return;
    }
    if (signal?.aborted) {
      reject(fileAbortError());
      return;
    }

    const reader = new FileReader();
    let settled = false;

    const cleanup = () => {
      reader.onload = null;
      reader.onerror = null;
      reader.onabort = null;
      signal?.removeEventListener('abort', handleSignalAbort);
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const handleSignalAbort = () => {
      try { reader.abort(); } catch { /* La lectura ya terminó. */ }
      finish(reject, fileAbortError());
    };

    reader.onload = () => finish(resolve, String(reader.result).split(',')[1] || '');
    reader.onerror = () => finish(
      reject,
      normalizeFileReadError(reader.error || new Error('No fue posible leer el archivo.'), file),
    );
    reader.onabort = () => finish(reject, fileAbortError());
    signal?.addEventListener('abort', handleSignalAbort, { once: true });

    try {
      reader.readAsDataURL(file);
    } catch (error) {
      finish(reject, normalizeFileReadError(error, file));
    }
  });
}

export async function mapFilesSequentially(items = [], mapper, { signal } = {}) {
  const results = [];
  for (let index = 0; index < items.length; index += 1) {
    if (signal?.aborted) throw fileAbortError();
    results.push(await mapper(items[index], index));
  }
  return results;
}


export async function mapFilesWithConcurrency(items = [], mapper, {
  signal,
  concurrency = 2,
} = {}) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(
    Math.max(1, Number(concurrency) || 1),
    Math.max(1, items.length),
  );

  async function worker() {
    while (nextIndex < items.length) {
      if (signal?.aborted) throw fileAbortError();
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
