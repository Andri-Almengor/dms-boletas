export class AsyncSemaphore {
  constructor({ name = 'semaphore', max = 1, queueLimit = 100, timeoutMs = 15000 } = {}) {
    this.name = String(name || 'semaphore');
    this.max = Math.max(1, Number(max) || 1);
    this.queueLimit = Math.max(0, Number(queueLimit) || 0);
    this.timeoutMs = Math.max(0, Number(timeoutMs) || 0);
    this.active = 0;
    this.queue = [];
  }

  busyError(code, message) {
    const error = new Error(message);
    error.code = code;
    error.status = 503;
    error.semaphoreLane = this.name;
    error.details = {
      lane: this.name,
      active: this.active,
      waiting: this.queue.length,
      max: this.max,
      queueLimit: this.queueLimit,
      timeoutMs: this.timeoutMs,
    };
    return error;
  }

  abortedError() {
    const error = new Error('La solicitud fue cancelada antes de entrar al servidor.');
    error.code = 'QUEUE_ABORTED';
    error.status = 499;
    error.semaphoreLane = this.name;
    return error;
  }

  acquire({ signal } = {}) {
    if (signal?.aborted) return Promise.reject(this.abortedError());

    if (this.active < this.max) {
      this.active += 1;
      return Promise.resolve(this.releaseFactory());
    }
    if (this.queue.length >= this.queueLimit) {
      return Promise.reject(this.busyError(
        'SERVER_BUSY',
        'El servidor está ocupado. Intente nuevamente en unos segundos.',
      ));
    }
    return new Promise((resolve, reject) => {
      const entry = {
        resolve,
        reject,
        timer: null,
        signal,
        onAbort: null,
      };

      const cleanup = () => {
        if (entry.timer) clearTimeout(entry.timer);
        entry.timer = null;
        if (entry.signal && entry.onAbort) entry.signal.removeEventListener('abort', entry.onAbort);
        entry.onAbort = null;
      };

      const removeFromQueue = () => {
        const index = this.queue.indexOf(entry);
        if (index >= 0) this.queue.splice(index, 1);
      };

      if (signal) {
        entry.onAbort = () => {
          removeFromQueue();
          cleanup();
          reject(this.abortedError());
        };
        signal.addEventListener('abort', entry.onAbort, { once: true });
      }

      if (this.timeoutMs > 0) {
        entry.timer = setTimeout(() => {
          removeFromQueue();
          cleanup();
          reject(this.busyError(
            'SERVER_BUSY_TIMEOUT',
            'La solicitud esperó demasiado porque el servidor está ocupado.',
          ));
        }, this.timeoutMs);
        entry.timer.unref?.();
      }
      this.queue.push(entry);
    });
  }

  releaseFactory() {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.active = Math.max(0, this.active - 1);
      this.drain();
    };
  }

  drain() {
    while (this.active < this.max && this.queue.length) {
      const entry = this.queue.shift();
      if (entry.timer) clearTimeout(entry.timer);
      if (entry.signal && entry.onAbort) entry.signal.removeEventListener('abort', entry.onAbort);
      entry.timer = null;
      entry.onAbort = null;
      if (entry.signal?.aborted) {
        entry.reject(this.abortedError());
        continue;
      }
      this.active += 1;
      entry.resolve(this.releaseFactory());
    }
  }

  snapshot() {
    return {
      lane: this.name,
      active: this.active,
      waiting: this.queue.length,
      max: this.max,
      queueLimit: this.queueLimit,
    };
  }
}
