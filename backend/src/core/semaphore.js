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

  acquire() {
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
      const entry = { resolve, reject, timer: null };
      if (this.timeoutMs > 0) {
        entry.timer = setTimeout(() => {
          const index = this.queue.indexOf(entry);
          if (index >= 0) this.queue.splice(index, 1);
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
