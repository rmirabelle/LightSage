// Metadata discovery shares existing sessions, never a second Matter controller.
export class DetailsPrefetch {
  activeUntil = 0;
  quietUntil = 0;
  running = false;
  stopped = false;
  retries = new Map();
  constructor(lighting, { idle = () => true, now = Date.now } = {}) {
    this.lighting = lighting; this.idle = idle; this.now = now;
  }
  touch() { this.activeUntil = this.now() + 15000; }
  foreground() { this.quietUntil = this.now() + 2000; }
  ready() {
    const l = this.lighting;
    return !this.stopped && this.now() < this.activeUntil && this.now() >= this.quietUntil && this.idle() &&
      !l.serialPending && !l.catalogReads.size && !l.recoveries.size && !l.music.token && !l.gradients.jobs.size;
  }
  start() { this.timer ??= setInterval(() => { void this.tick(); }, 2000); this.timer.unref?.(); }
  stop() { this.stopped = true; clearInterval(this.timer); }
  async tick() {
    if (this.running || !this.ready()) return;
    const l = this.lighting;
    const id = [...l.nodeIds.keys()].find(id => !Object.keys(l.settings.lights[id].details?.fields ?? {}).length &&
      l.availability.get(id) === true && l.bulbs.has(id) && (this.retries.get(id) ?? 0) <= this.now());
    if (!id) return;
    this.running = true;
    this.retries.set(id, this.now() + 60000);
    const bulb = l.bulbs.get(id);
    try {
      const details = await bulb.details({ beforeRead: async () => {
        // Yield between attributes. A command already in flight is allowed to
        // settle, but no more reads begin while controls or animations are busy.
        await new Promise(resolve => setTimeout(resolve, 100));
        if (!this.ready() || l.bulbs.get(id) !== bulb) throw Error('Background details paused');
      } });
      if (this.stopped || !Object.keys(details.fields).length || l.bulbs.get(id) !== bulb) return;
      // Only the small settings commit joins the queue; device I/O never does.
      await l.serial(async () => {
        if (this.stopped || !l.settings.lights[id] || l.settings.lights[id].details) return;
        const next = structuredClone(l.settings);
        next.lights[id].details = details;
        await l.commitSettings(next);
      });
    } catch { /* Missing/offline information is retried later without UI alerts. */ }
    finally { this.running = false; }
  }
}
