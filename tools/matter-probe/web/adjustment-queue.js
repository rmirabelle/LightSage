export class AdjustmentQueue {
  items = [];
  running = false;
  constructor({ execute, changed = () => {}, idle = () => {}, failed = () => {} }) {
    Object.assign(this, { execute, changed, idle, failed });
  }
  get pending() { return this.running || this.items.length > 0; }
  enqueue(request, key) {
    const value = structuredClone(request);
    return new Promise(resolve => {
      const last = this.items.at(-1);
      // Only adjacent unsent slider/wheel updates can replace each other.
      // A power or mode change remains an ordering barrier.
      if (key && last?.key === key) { last.request = value; last.resolve.push(resolve); }
      else this.items.push({ request: value, key, resolve: [resolve] });
      this.changed(true);
      if (!this.running) void this.drain();
    });
  }
  async drain() {
    this.running = true;
    let latest;
    while (this.items.length) {
      const item = this.items.shift();
      let result;
      try { result = await this.execute(item.request); latest = result; }
      catch (error) {
        this.failed(error);
        if (error.disconnected || error.status === 401) {
          for (const queued of this.items.splice(0)) queued.resolve.forEach(resolve => resolve());
        }
      }
      item.resolve.forEach(resolve => resolve(result));
    }
    this.running = false;
    this.changed(false);
    this.idle(latest);
  }
}
