export function gradientConfig(value) {
  const color = input => {
    if (!input || !Number.isFinite(input.hue) || input.hue < 0 || input.hue > 360 || !Number.isFinite(input.saturation) || input.saturation < 0 || input.saturation > 100) throw new Error('Choose valid gradient colors.');
    return { hue: input.hue, saturation: input.saturation };
  };
  if (![10000, 3000, 1000, 300].includes(value.duration)) throw new Error('Choose a gradient speed.');
  if (!['alternate', 'forward'].includes(value.repeat)) throw new Error('Choose a transition type.');
  return { start: color(value.start), end: color(value.end), duration: value.duration, repeat: value.repeat };
}

// One timer per animation, never an accumulating queue of frame commands.
// Bulbs interpolate using native Matter transitions; the desktop schedules legs.
export class Gradients {
  jobs = new Set();
  errors = new Map();
  constructor(lighting, { schedule = setTimeout, cancel = clearTimeout } = {}) {
    this.lighting = lighting; this.schedule = schedule; this.cancel = cancel;
  }
  state(id) {
    const job = [...this.jobs].find(job => job.ids.has(id));
    return job ? { ...job.config, target: job.target } : null;
  }
  async stop(ids) {
    const affected = new Set();
    const pending = [];
    for (const job of this.jobs) {
      const overlaps = ids.some(id => job.ids.has(id));
      for (const id of ids) if (job.ids.delete(id)) affected.add(id);
      if (overlaps && job.pending) pending.push(job.pending);
      if (!job.ids.size) { this.cancel(job.timer); this.jobs.delete(job); }
    }
    await Promise.allSettled(pending);
    for (const id of ids) this.errors.delete(id);
    const outcomes = await Promise.allSettled([...affected].map(async id => (await this.lighting.bulb(id)).stopColorTransition()));
    [...affected].forEach((id, index) => {
      if (outcomes[index].status === 'rejected') this.errors.set(id, `Animation stopped, but ${this.lighting.settings.lights[id].name} did not confirm stopping its current transition.`);
    });
    return outcomes;
  }
  async send(job, color, duration) {
    await Promise.all([...job.ids].map(async id => {
      try {
        const bulb = await this.lighting.bulb(id);
        if (!job.ids.has(id)) return;
        // Govee can acknowledge an instant color before applying it. Confirm
        // resets before issuing the next leg so the starting color isn't lost.
        if (duration === 0) await bulb.setColor(color.hue, color.saturation);
        else await bulb.transitionColor(color.hue, color.saturation, duration);
      }
      catch (error) {
        job.ids.delete(id);
        this.errors.set(id, `Gradient stopped for ${this.lighting.settings.lights[id].name}: ${error.message}`);
      }
    }));
    if (!job.ids.size) this.jobs.delete(job);
  }
  async start(target, ids, config) {
    await this.stop(ids);
    const job = { target, ids: new Set(ids), config, nextEnd: true };
    this.jobs.add(job);
    await this.send(job, config.start, 0);
    if (this.jobs.has(job)) await this.step(job);
  }
  async step(job) {
    if (!this.jobs.has(job)) return;
    if (job.config.repeat === 'forward' && !job.nextEnd) {
      await this.send(job, job.config.start, 0);
      job.nextEnd = true;
    }
    if (!this.jobs.has(job)) return;
    await this.send(job, job.nextEnd ? job.config.end : job.config.start, job.config.duration);
    job.nextEnd = !job.nextEnd;
    if (!this.jobs.has(job)) return;
    job.timer = this.schedule(() => {
      // Reads and unrelated bulbs must not stall animation. Stop removes ownership
      // and waits for this in-flight leg before a replacement command is issued.
      job.pending = this.step(job).catch(error => {
        for (const id of job.ids) this.errors.set(id, `Gradient stopped: ${error.message}`);
        this.jobs.delete(job);
      });
    }, job.config.duration);
    job.timer?.unref?.();
  }
  close() { for (const job of this.jobs) { this.cancel(job.timer); job.ids.clear(); } this.jobs.clear(); }
}
