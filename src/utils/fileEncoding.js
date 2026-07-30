function fileAbortError() {
  const error = new Error('La lectura del archivo fue cancelada.');
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
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
    reader.onerror = () => finish(reject, reader.error || new Error('No fue posible leer el archivo.'));
    reader.onabort = () => finish(reject, fileAbortError());
    signal?.addEventListener('abort', handleSignalAbort, { once: true });

    try {
      reader.readAsDataURL(file);
    } catch (error) {
      finish(reject, error);
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
