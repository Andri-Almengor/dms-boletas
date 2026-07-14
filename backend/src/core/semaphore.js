export class AsyncSemaphore {
  constructor(max = 1) {
    this.max = Math.max(1, Number(max) || 1);
    this.active = 0;
    this.queue = [];
  }

  acquire() {
    if (this.active < this.max) {
      this.active += 1;
      return Promise.resolve(this.releaseFactory());
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  releaseFactory() {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.active = Math.max(0, this.active - 1);
      const next = this.queue.shift();
      if (next) {
        this.active += 1;
        next(this.releaseFactory());
      }
    };
  }

  snapshot() {
    return { active: this.active, waiting: this.queue.length, max: this.max };
  }
}
