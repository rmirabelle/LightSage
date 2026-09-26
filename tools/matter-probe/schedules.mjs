import { randomUUID } from 'node:crypto';

/**
 * Schedules run on this PC's local clock. A run that is more than GRACE_MS
 * late (PC asleep, service stopped, controller busy) is skipped, never
 * performed late. Each entry runs at most once per local calendar date,
 * which also prevents a second run in the repeated hour after daylight saving.
 */
export const GRACE_MS = 2 * 60000;
const actions = ['scene', 'on', 'off'];
const minutes = entry => entry.hour * 60 + entry.minute;
/**
 * Entries at the same time run one after another in this order. Entries saved
 * before ordering existed have no order number and run after numbered ones.
 */
export const scheduleOrder = (a, b) => minutes(a) - minutes(b) || (a.order ?? Infinity) - (b.order ?? Infinity) || a.id.localeCompare(b.id);
const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function validEntry(settings, input) {
  const target = input?.target;
  if (target !== 'all-rooms' && !Object.hasOwn(settings.groups, target)) throw Error('Choose a room or ALL ROOMS.');
  if (!actions.includes(input.action)) throw Error('Choose Load scene, Power on, or Power off.');
  let sceneId = null;
  if (input.action === 'scene') {
    const scene = Object.hasOwn(settings.scenes ?? {}, input.sceneId) ? settings.scenes[input.sceneId] : null;
    if (!scene || scene.target !== target) throw Error('Choose a scene saved for this room.');
    sceneId = scene.id;
  }
  const { hour, minute, days } = input;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) throw Error('Choose a valid time.');
  if (!Array.isArray(days) || !days.length || days.some(day => !Number.isInteger(day) || day < 0 || day > 6)) throw Error('Choose at least one day.');
  return { target, action: input.action, sceneId, hour, minute, days: [...new Set(days)].sort() };
}
export function dueOccurrence(entry, now) {
  if (!entry.enabled) return null;
  // Check yesterday too, so an 11:59 PM entry still runs after midnight.
  for (const offset of [0, -1]) {
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, entry.hour, entry.minute);
    const late = now - at;
    if (late < 0 || late > GRACE_MS || !entry.days.includes(at.getDay())) continue;
    // A new or edited entry never runs for a time that already passed.
    if (at < new Date(entry.updatedAt)) continue;
    if (entry.lastRun?.date === dateKey(at)) continue;
    return at;
  }
  return null;
}
export const schedules = {
  scheduleList() {
    const settings = this.settings;
    return Object.values(settings.schedules ?? {}).map(entry => {
      const room = entry.target === 'all-rooms' ? 'ALL ROOMS' : settings.groups[entry.target]?.name;
      const scene = entry.action === 'scene' ? settings.scenes?.[entry.sceneId] : null;
      const problem = !room ? 'This room was deleted.' : entry.action === 'scene' && !scene ? 'This scene was deleted.' : null;
      return { ...structuredClone(entry), roomName: room ?? 'Deleted room', sceneName: scene?.name ?? null, problem };
    }).sort(scheduleOrder);
  },
  async schedule(command) {
    if (!command || !['create', 'update', 'enable', 'move', 'delete'].includes(command.type)) throw Error('Unknown schedule action.');
    const next = structuredClone(this.settings);
    next.schedules ??= {};
    const existing = Object.hasOwn(next.schedules, command.id) ? next.schedules[command.id] : null;
    if (command.type !== 'create' && !existing) throw Error('This schedule no longer exists.');
    const updatedAt = new Date().toISOString();
    if (command.type === 'delete') delete next.schedules[existing.id];
    else if (command.type === 'move') {
      if (![-1, 1].includes(command.direction)) throw Error('direction must be -1 or 1');
      const group = Object.values(next.schedules).filter(entry => minutes(entry) === minutes(existing)).sort(scheduleOrder);
      const from = group.indexOf(existing), to = from + command.direction;
      if (to < 0 || to >= group.length) throw Error('This action cannot move further.');
      [group[from], group[to]] = [group[to], group[from]];
      group.forEach((entry, index) => { entry.order = index; });
    } else if (command.type === 'enable') {
      if (typeof command.enabled !== 'boolean') throw Error('enabled must be boolean');
      Object.assign(existing, { enabled: command.enabled, updatedAt });
    } else {
      const id = existing?.id ?? randomUUID();
      const order = existing?.order ?? Math.max(-1, ...Object.values(next.schedules).map(entry => entry.order ?? -1)) + 1;
      next.schedules[id] = { id, ...validEntry(next, command), order, enabled: existing?.enabled ?? true, updatedAt, lastRun: existing?.lastRun ?? null };
    }
    await this.commitSettings(next);
    return { state: await this.catalog({ cachedOnly: true }) };
  },
  async runSchedule(id, at, version, { blocked = () => null, now = () => new Date() } = {}) {
    const entry = this.settings.schedules?.[id];
    // Do nothing if the entry was deleted, paused, or edited while it waited in the queue.
    if (!entry || !entry.enabled || entry.updatedAt !== version || entry.lastRun?.date === dateKey(at)) return;
    let ok = false, message;
    const reason = blocked();
    if (reason) message = `Skipped: ${reason}`;
    else if (now() - at > GRACE_MS) message = 'Skipped: the controller was busy at the scheduled time.';
    else try {
      let outcomes;
      if (entry.action === 'scene') {
        const scene = this.settings.scenes?.[entry.sceneId];
        if (!scene) throw Error('This scene was deleted.');
        ({ outcomes } = await this.applyScene(scene));
      } else {
        /**
         * Room commands skip lights marked unavailable. No app may have polled
         * for hours, so check those lights again before giving up on them.
         */
        const stale = this.members(entry.target).filter(member => this.availability.get(member) === false);
        if (stale.length) await this.catalog({ refreshIds: stale });
        ({ outcomes } = await this.command({ type: 'power', on: entry.action === 'on', target: entry.target }));
      }
      const failed = outcomes.filter(outcome => !outcome.ok);
      ok = failed.length === 0;
      message = ok ? `${outcomes.length} ${outcomes.length === 1 ? 'light' : 'lights'} changed.`
        : `${outcomes.length - failed.length} of ${outcomes.length} lights changed. ${failed.map(outcome => `${outcome.name}: ${outcome.error}`).join(' ')}`;
    } catch (error) { message = error.message; }
    const next = structuredClone(this.settings);
    if (!next.schedules?.[id]) return;
    next.schedules[id].lastRun = { at: now().toISOString(), date: dateKey(at), ok, message };
    await this.commitSettings(next);
    const label = `${entry.target === 'all-rooms' ? 'ALL ROOMS' : this.settings.groups[entry.target]?.name} ${entry.action === 'scene' ? `scene ${this.settings.scenes?.[entry.sceneId]?.name ?? '(deleted)'}` : `power ${entry.action}`}`;
    (ok ? console.log : console.warn)(`Schedule ${label}: ${message}`);
  },
};

export class Scheduler {
  running = new Set();
  constructor(lighting, { blocked = () => null, now = () => new Date(), intervalMs = 15000 } = {}) {
    Object.assign(this, { lighting, blocked, now, intervalMs });
  }
  start() { this.timer = setInterval(() => void this.tick(), this.intervalMs); this.timer.unref?.(); void this.tick(); }
  stop() { clearInterval(this.timer); }
  tick() {
    const now = this.now();
    const runs = [];
    // Queue due entries in list order; the lighting queue runs them one at a time.
    for (const entry of Object.values(this.lighting.settings?.schedules ?? {}).sort(scheduleOrder)) {
      const at = dueOccurrence(entry, now);
      if (!at || this.running.has(entry.id)) continue;
      this.running.add(entry.id);
      runs.push(this.lighting.serial(() => this.lighting.runSchedule(entry.id, at, entry.updatedAt, this))
        .catch(error => console.warn(`Schedule failed: ${error.message}`))
        .finally(() => this.running.delete(entry.id)));
    }
    return Promise.all(runs);
  }
}
