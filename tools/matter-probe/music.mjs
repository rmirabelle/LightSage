import { randomUUID } from 'node:crypto';

export class Music {
  bulbs = new Map();
  token = null;
  errors = new Map();
  sequence = -1;
  lastFrame = 0;
  metrics = new Map();
  frames = 0;
  summary() {
    return {active:!!this.token,target:this.target,frames:this.frames,bulbs:[...this.metrics].map(([id,value])=>({id,...value,meanCommandMs:value.commands ? Math.round(value.totalMs/value.commands) : null}))};
  }
  constructor(lighting, { now = Date.now } = {}) { this.lighting = lighting; this.now = now; }
  state(id) { return this.bulbs.has(id) ? {target:this.target} : null; }
  async start(target, ids) {
    await this.stop([...this.bulbs.keys()]);
    this.metrics.clear(); this.frames = 0;
    for (const id of ids) this.metrics.set(id,{commands:0,totalMs:0,maxCommandMs:0,replaced:0});
    const prepared = await Promise.allSettled(ids.map(async id => {
      const bulb = await this.lighting.bulb(id), saved = await bulb.raw();
      if (!Number.isInteger(saved.level) || typeof saved.on !== 'boolean') throw Error('Cannot read initial brightness.');
      return {id, bulb, saved, pending:null, sending:null, lastLevel:null};
    }));
    prepared.forEach((result, index) => {
      this.errors.delete(ids[index]);
      if (result.status === 'fulfilled') this.bulbs.set(ids[index], result.value);
      else this.errors.set(ids[index], `Music unavailable for ${this.lighting.settings.lights[ids[index]].name}: ${result.reason.message}`);
    });
    if (!this.bulbs.size) throw Error('No lights are ready for Music.');
    this.target = target; this.token = randomUUID(); this.sequence = -1; this.lastFrame = this.now();
    const token = this.token;
    this.expiring = false;
    this.watchdog = setInterval(() => {
      if (this.now() - this.lastFrame <= 2500 || this.expiring) return;
      this.expiring = true;
      void this.lighting.serial(() => this.token === token ? this.stop([...this.bulbs.keys()]) : undefined).catch(error => console.warn('Music cleanup:',error.message));
    }, 500);
    this.watchdog.unref?.();
    console.log(`Music started for ${target} (${this.bulbs.size} lights).`);
    return { token:this.token, bulbs:this.bulbs.size, skipped:ids.filter(id=>!this.bulbs.has(id)) };
  }
  frame({token, sequence, level}) {
    if (!this.token || token !== this.token || this.expiring) throw Error('Music session ended. Tap Music to start again.');
    if (!Number.isSafeInteger(sequence) || sequence < 0 || !Number.isFinite(level) || level < 0 || level > 1) throw Error('Invalid audio level.');
    if (sequence <= this.sequence) return {accepted:false};
    this.sequence = sequence; this.lastFrame = this.now();
    this.frames++;
    for (const entry of this.bulbs.values()) {
      if (entry.pending) this.metrics.get(entry.id).replaced++;
      entry.pending = {level:Math.max(1,Math.round((0.04 + level * 0.96) * Math.max(25,entry.saved.level))),at:this.now()};
      if (!entry.sending) {
        entry.sending = this.drain(entry).finally(() => { entry.sending = null; });
      }
    }
    return {accepted:true, bulbs:this.bulbs.size, errors:[...this.errors.values()]};
  }
  async drain(entry) {
    while (this.bulbs.get(entry.id) === entry && entry.pending) {
      const frame = entry.pending; entry.pending = null;
      if (this.now() - frame.at > 300 || frame.level === entry.lastLevel) continue;
      try {
        const started=performance.now();
        await entry.bulb.musicLevel(frame.level);
        const elapsed=Math.round(performance.now()-started), metric=this.metrics.get(entry.id);
        metric.commands++; metric.totalMs+=elapsed; metric.maxCommandMs=Math.max(metric.maxCommandMs,elapsed);
        entry.lastLevel = frame.level;
      } catch (error) {
        this.bulbs.delete(entry.id);
        this.errors.set(entry.id, `Music stopped for ${this.lighting.settings.lights[entry.id].name}: ${error.message}`);
        console.warn(this.errors.get(entry.id));
        entry.pending = null;
      }
    }
  }
  async stop(ids, restore = true) {
    const entries = ids.map(id=>this.bulbs.get(id)).filter(Boolean);
    for (const entry of entries) { this.bulbs.delete(entry.id); entry.pending = null; }
    if (!this.bulbs.size) { clearInterval(this.watchdog); this.token = null; }
    await Promise.all(entries.map(async entry => {
      await entry.sending;
      if (!restore) return;
      try {
        await entry.bulb.setLevel(entry.saved.level);
        await (entry.saved.on ? entry.bulb.power.on() : entry.bulb.power.off());
      } catch (error) { this.errors.set(entry.id, `Couldn’t restore ${this.lighting.settings.lights[entry.id].name} after Music: ${error.message}`); }
    }));
    if (entries.length) console.log(`Music stopped for ${entries.length} lights.`);
    if (entries.length && !this.token) console.log(`Music diagnostics: ${JSON.stringify(this.summary())}`);
  }
  close() { clearInterval(this.watchdog); this.token = null; this.bulbs.clear(); }
}
