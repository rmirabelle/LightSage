import { stateDir, stateFile } from './config.mjs';
import '@matter/nodejs';
import { Environment, Logger, LogLevel } from '@matter/general';
import { CommissioningController } from '@project-chip/matter.js';
import { readFile, writeFile, rename, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Bulb } from './bulb.mjs';
import { H6159, stripCapabilities } from './h6159.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { management } from './management.mjs';
import { commissionLocalCandidates } from './local-pairing.mjs';
import { Gradients, gradientConfig } from './gradients.mjs';
import { Music } from './music.mjs';
import { scenes } from './scenes.mjs';
import { schedules } from './schedules.mjs';
const statePath = stateDir;
const settingsPath = stateFile('lightsage.json');
export class Lighting {
  tail = Promise.resolve();
  serialPending = 0;
  stateRevision = 0;
  backgroundRefresh;
  bulbs = new Map();
  catalogReads = new Map();
  catalogSnapshots = new Map();
  availability = new Map();
  recoveries = new Map();
  recoveryTimes = new Map();
  connectionGenerations = new Map();
  stateReadTimeoutMs = 8000;
  gradients = new Gradients(this);
  music = new Music(this);
  serial(action) {
    this.stateRevision++;
    this.serialPending++;
    const result = this.tail.then(action).finally(() => { this.serialPending--; });
    this.tail = result.catch(() => {}); return result;
  }
  async start() {
    globalThis.fetch = async () => { throw new Error('HTTP fetch disabled: local-only lighting service.'); };
    Logger.defaultLogLevel = LogLevel.ERROR;
    Logger.facilityLevels = { Discovery: LogLevel.INFO, ParallelPaseDiscovery: LogLevel.DEBUG, PaseClient: LogLevel.INFO };
    Environment.default.vars.set('storage.path', statePath);
    if (process.env.LIGHTSAGE_NETWORK_INTERFACE) Environment.default.vars.set('mdns.networkInterface', process.env.LIGHTSAGE_NETWORK_INTERFACE);
    let previous = { name: 'Dining R', restore: null };
    try { previous = JSON.parse(await readFile(settingsPath, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    this.settings = previous.version === 2 ? previous : { version: 2, lights: {
      '1': { name: previous.name, restore: previous.restore, owner: previous.restore ? '1' : null },
    }, groups: {} };
    if (previous.version !== 2) {
      try { await copyFile(settingsPath, `${settingsPath}.v1-backup`, 1); }
      catch (error) { if (!['ENOENT', 'EEXIST'].includes(error.code)) throw error; }
    }
    this.controller = new CommissioningController({
      environment: { environment: Environment.default, id: 'lightsage-probe' },
      autoConnect: false, adminFabricLabel: 'LightSage', enableOtaProvider: false,
    });
    await this.controller.start();
    this.commissionLocal = options => commissionLocalCandidates(this.controller, options);
    this.nodeIds = new Map(this.controller.getCommissionedNodes().map(id => [String(id), id]));
    for (const [id, record] of Object.entries(this.settings.lights)) if (record.transport === 'bluetooth' && record.model === 'H6159') this.nodeIds.set(id, id);
    for (const id of this.nodeIds.keys()) this.settings.lights[id] ??= { name: id === '2' ? 'Dining L' : `Light ${id}`, restore: null, owner: null };
    if (previous.version !== 2 && this.nodeIds.has('1') && this.nodeIds.has('2')) this.settings.groups['dining-room'] ??= { name: 'Dining Room', members: ['1', '2'] };
    await this.save();
  }
  async save() {
    await writeFile(`${settingsPath}.tmp`, JSON.stringify(this.settings, null, 2));
    await rename(`${settingsPath}.tmp`, settingsPath);
  }
  async details(id, refresh = false) {
    if (!this.nodeIds.has(id)) throw Error('Choose a known light.');
    const cached = () => this.settings.lights[id].details;
    if (!refresh && cached()) return structuredClone(cached());
    return this.serial(async () => {
      // Another queued request may have populated the cache while we waited.
      if (!refresh && cached()) return structuredClone(cached());
      let details = await (await this.bulb(id)).details();
      // Keep known identity even when an optional attribute fails. Only explicit
      // refreshes retry incomplete details; opening the page must stay fast.
      if (cached()) details = { ...details, fields:{...cached().fields,...details.fields},
        addresses:details.addresses.length ? details.addresses : cached().addresses };
      if (Object.keys(details.fields).length) {
        const next = structuredClone(this.settings);
        next.lights[id].details = structuredClone(details);
        await this.commitSettings(next);
      }
      return details;
    });
  }
  async bulb(id) {
    if (!this.nodeIds.has(id)) throw new Error('Unknown light.');
    await this.recoveries.get(id);
    if (!this.bulbs.has(id)) {
      if (this.settings.lights[id].transport === 'bluetooth') {
        this.bulbs.set(id, new H6159(id, this.settings.lights[id]));
        return this.bulbs.get(id);
      }
      const generation = this.connectionGenerations.get(id);
      const node = await this.controller.connectNode(this.nodeIds.get(id), { autoSubscribe: false });
      if (!node.initialized) await node.events.initialized;
      if (generation !== this.connectionGenerations.get(id)) throw new Error('Light connection was replaced.');
      this.bulbs.set(id, new Bulb(id, this.settings.lights[id], node));
    }
    return this.bulbs.get(id);
  }
  members(target = '1') {
    if (target === 'all-rooms') return [...this.nodeIds.keys()];
    if (this.settings.groups[target]) return this.settings.groups[target].members;
    if (this.nodeIds.has(target)) return [target];
    throw new Error('Unknown target.');
  }
  async read(id = '1') {
    const value = await (await this.bulb(id)).read();
    const record = this.settings.lights[id];
    return { ...value, available: true, blockedBy: record.owner && record.owner !== id ? (record.owner === 'all-rooms' ? 'ALL ROOMS' : this.settings.groups[record.owner]?.name ?? record.owner) : null };
  }
  async catalogRead(id) {
    const revision = this.stateRevision;
    // Keep one observation in flight per bulb even after a caller times out.
    // A deadline does not cancel Matter's underlying network operation.
    let pending = this.catalogReads.get(id);
    if (!pending) {
      pending = Promise.resolve().then(() => this.read(id));
      this.catalogReads.set(id, pending);
      const clear = () => { if (this.catalogReads.get(id) === pending) this.catalogReads.delete(id); };
      pending.then(clear, clear);
    }
    let timer;
    try {
      return await Promise.race([pending, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Light is not responding.')), this.settings?.lights?.[id]?.transport === 'bluetooth' ? 19000 : this.stateReadTimeoutMs);
      })]);
    } catch (error) {
      // A poll started before a command must not disconnect its live session.
      if (revision === this.stateRevision) {
        this.availability.set(id, false);
        this.recoverBulb(id);
      }
      throw error;
    } finally { clearTimeout(timer); }
  }
  recoverBulb(id, force = false) {
    if (this.settings?.lights?.[id]?.transport === 'bluetooth') return;
    if (this.recoveries.has(id)) return this.recoveries.get(id);
    if (!this.controller?.disconnectNode) return;
    const now = Date.now();
    if (!force && now - (this.recoveryTimes.get(id) ?? 0) < 15000) return;
    this.recoveryTimes.set(id, now);
    const recovery = Promise.resolve().then(async () => {
      const nodeId = this.nodeIds.get(id);
      // Force-close the failed session and cancel its outstanding reads. Keep
      // the fabric and saved bulb; this is reconnection, never re-pairing.
      await this.controller.disconnectNode(nodeId, true);
      this.connectionGenerations.set(id, (this.connectionGenerations.get(id) ?? 0) + 1);
      // A read waiting for initialization may never settle on disconnect.
      // Detach it only after closing the old connection so the next poll can
      // read the new one; the identity-checked cleanup cannot erase its successor.
      this.catalogReads.delete(id);
      this.bulbs.delete(id);
      const node = await this.controller.getNode(nodeId);
      node.connect({ autoSubscribe: false });
      console.log(`Reconnecting light ${id} after a failed state read.`);
    }).catch(error => console.warn(`Light ${id} reconnection failed: ${error.message}`));
    this.recoveries.set(id, recovery);
    void recovery.finally(() => this.recoveries.delete(id));
    return recovery;
  }
  async retryBulb(id) {
    if (!this.nodeIds.has(id)) throw new Error('Unknown light.');
    return this.retryBulbs([id]);
  }
  async retryBulbs(ids) {
    if (!Array.isArray(ids) || !ids.length || ids.some(id => !this.nodeIds.has(id))) throw new Error('Choose known lights to reconnect.');
    await Promise.all([...new Set(ids)].map(id => this.recoverBulb(id, true)));
    return this.catalog();
  }
  async pollCatalog() {
    // Polling never holds the mutation queue. Publish each observation as it
    // arrives so a missing device cannot hold up the rest of the house.
    if (!this.backgroundRefresh && !this.serialPending) {
      const revision = this.stateRevision;
      this.backgroundRefresh = Promise.all([...this.nodeIds.keys()].map(async id => {
        if (this.music.state(id)) return;
        try {
          const observed = await this.catalogRead(id);
          if (revision !== this.stateRevision || !this.nodeIds.has(id)) return;
          this.catalogSnapshots.set(id, structuredClone(observed));
          this.availability.set(id, true);
        } catch { /* catalogRead records failures and starts recovery. */ }
      })).finally(() => { this.backgroundRefresh = undefined; });
    }
    return this.catalog({ cachedOnly: true });
  }
  async catalog({ cachedOnly = false, refreshIds } = {}) {
    // Confirmation after a write must start a new read, not reuse an older
    // background observation that may have sampled the pre-command state.
    if (refreshIds) for (const id of refreshIds) this.catalogReads.delete(id);
    const lights = await Promise.all([...this.nodeIds.keys()].map(async id => {
      try {
        // Meter updates must not compete with repeated attribute reads from
        // other open clients. Keep the last observation's original timestamp.
        const cached = this.catalogSnapshots.get(id);
        if (cachedOnly || (refreshIds && !refreshIds.includes(id))) {
          if (cached?.available && this.availability.get(id) !== false) return structuredClone(cached);
          throw Error('Current settings are not available.');
        }
        if (this.music.state(id) && cached?.available) return structuredClone(cached);
        const observed = await this.catalogRead(id);
        this.catalogSnapshots.set(id, structuredClone(observed));
        return observed;
      }
      catch (error) {
        const known = this.catalogSnapshots.get(id);
        return { id, name: this.settings.lights[id].name, transport:this.settings.lights[id].transport, capabilities:this.settings.lights[id].transport === 'bluetooth' ? stripCapabilities : known?.capabilities, model: known?.model ?? this.settings.lights[id].model, vendorId: known?.vendorId, productId: known?.productId,
          available: false, error: error.message, fullWhite: !!this.settings.lights[id].restore };
      }
    }));
    for (const light of lights) {
      if (this.settings.lights[light.id].details) light.details = structuredClone(this.settings.lights[light.id].details);
      if (light.available && this.availability.get(light.id) !== true) {
        const status = this.availability.has(light.id) ? 'Recovered' : 'Connected';
        console.log(`${status} ${this.settings.lights[light.id].name} (light ${light.id}); fresh state confirmed at ${light.observedAt ?? new Date().toISOString()}.`);
      }
      this.availability.set(light.id, light.available);
      light.gradient = this.gradients.state(light.id);
      light.gradientError = this.gradients.errors.get(light.id) ?? null;
      light.music = this.music.state(light.id);
    }
    const groups = [['all-rooms', { name: 'ALL ROOMS', members: [...this.nodeIds.keys()] }], ...Object.entries(this.settings.groups)].map(([id, group]) => {
      const members = group.members.map(id => lights.find(light => light.id === id));
      const responding = members.filter(member => member?.available);
      const available = responding.length > 0;
      const common = key => available && responding.every(member => member[key] === responding[0][key]) ? responding[0][key] : null;
      const respondingIds = responding.map(member => member.id);
      const blocked = respondingIds.filter(member => this.settings.lights[member].owner && this.settings.lights[member].owner !== id);
      const gradients = responding.map(member => member.gradient);
      const gradient = gradients.find(Boolean) ?? null;
      const capabilities = Object.fromEntries(Object.keys(stripCapabilities).map(key=>[key,responding.some(member=>member.capabilities?.[key] !== false)]));
      return { id, name: group.name, members, available, capabilities, gradient, music:responding.find(member=>member.music)?.music ?? null, fullWhite: respondingIds.some(member => this.settings.lights[member].owner === id),
        blockedBy: blocked.length ? 'another Full White override' : null,
        on: available ? responding.some(member => member.on === true) : null, brightness: common('brightness'), kelvin: common('kelvin'), colorMode: common('colorMode'), hue: common('hue'), saturation: common('saturation'),
        observedAt: available ? new Date().toISOString() : null };
    });
    return { lights, allRooms: groups[0], groups: groups.slice(1), scenes: this.sceneList(lights), schedules: this.scheduleList() };
  }
  async command(command) {
    const target = command.target ?? '1';
    const allIds = this.members(target);
    const groupTarget = target === 'all-rooms' || !!this.settings.groups[target];
    const supported = id => !(this.settings.lights[id].transport === 'bluetooth' && ['temperature','fullWhite'].includes(command.type));
    if (!groupTarget && !supported(target)) throw Error('This strip supports RGB color and brightness; white-temperature and Full White are unavailable.');
    const ids = groupTarget ? allIds.filter(id => this.availability.get(id) !== false && supported(id)) : allIds;
    const skipped = allIds.filter(id => !ids.includes(id)).map(id => ({id, name:this.settings.lights[id].name, ok:false, skipped:true, error:supported(id)?'Light unavailable.':'This strip does not support this control.'}));
    if (command.type === 'fullWhite') {
      if (typeof command.enabled !== 'boolean') throw new Error('enabled must be boolean');
    } else if (!(command.type === 'power' && typeof command.on === 'boolean') &&
      !(command.type === 'brightness' && Number.isInteger(command.value) && command.value >= 1 && command.value <= 100) &&
      !(command.type === 'temperature' && Number.isInteger(command.value) && command.value >= 2700 && command.value <= 6500) &&
      !(command.type === 'color' && Number.isFinite(command.hue) && command.hue >= 0 && command.hue <= 360 && Number.isFinite(command.saturation) && command.saturation >= 0 && command.saturation <= 100)) throw new Error('Invalid command.');
    for (const id of ids) {
      const record = this.settings.lights[id];
      if (record.owner && record.owner !== target) throw new Error(`Restore ${record.name}'s existing override before using this target.`);
      if (record.restore && command.type !== 'fullWhite') throw new Error('Restore Full White before making other adjustments.');
    }
    await this.music.stop(allIds, command.type !== 'brightness');
    if (['power', 'color', 'temperature', 'fullWhite'].includes(command.type)) await this.gradients.stop(allIds);
    // Read all original states before changing any bulb. Retries retain snapshots.
    if (command.type === 'fullWhite' && command.enabled) {
      const snapshots = await Promise.allSettled(ids.filter(id => !this.settings.lights[id].restore).map(async id => {
        const saved = await (await this.bulb(id)).raw();
        if (![0, 1, 2].includes(saved.mode) || saved.level == null) throw new Error('Cannot safely snapshot current settings.');
        return [id, saved];
      }));
      const failure = snapshots.find(result => result.status === 'rejected');
      if (failure) throw failure.reason;
      for (const { value: [id, saved] } of snapshots) Object.assign(this.settings.lights[id], { restore: saved, owner: target });
      await this.save();
    }
    const outcomes = await Promise.all(ids.map(async id => {
      const record = this.settings.lights[id];
      try {
        if (command.type === 'fullWhite' && !command.enabled && !record.restore) {
          return { id, name: record.name, ok: true };
        }
        const bulb = await this.bulb(id);
        if (command.type === 'fullWhite' && command.enabled) {
          // Apply temperature last so power/level changes cannot replace the target white.
          const mireds = Math.round(1e6 / 4400);
          // These bulbs can acknowledge rapid commands before applying them.
          // Confirm each step before issuing the next, with bounded retries.
          const apply = async (action, matches) => {
            for (let attempt = 0; attempt < 3; attempt++) {
              await action();
              await delay(200);
              if (matches(await bulb.raw())) return;
            }
            throw new Error('Full White step not confirmed; restore settings retained.');
          };
          await apply(() => bulb.power.on(), value => value.on);
          await apply(() => bulb.setLevel(254), value => value.level === 254);
          await apply(() => bulb.setWhite(mireds), value => value.mode === 2 && value.mireds === mireds);
          const result = await bulb.raw();
          if (!result.on || result.level !== 254 || result.mode !== 2 || result.mireds !== mireds) throw new Error(`Full White not confirmed (power=${result.on}, level=${result.level}, mode=${result.mode}, mireds=${result.mireds}); restore settings retained.`);
        } else if (command.type === 'fullWhite') {
          await bulb.restore(record.restore);
        } else if (command.type === 'power') await (command.on ? bulb.power.on() : bulb.power.off());
        else if (command.type === 'brightness') await bulb.setLevel(Math.max(1, Math.round(command.value / 100 * 254)));
        else if (command.type === 'color') await bulb.setColor(command.hue, command.saturation);
        else await bulb.setWhite(Math.round(1e6 / command.value));
        return { id, name: record.name, ok: true };
      } catch (error) { return { id, name: record.name, ok: false, error: error.message }; }
    }));
    // Hardware runs concurrently; durable snapshot updates remain sequential so
    // writes to the shared settings file cannot race or discard failed restores.
    if (command.type === 'fullWhite' && !command.enabled) for (const outcome of outcomes) {
      const record = this.settings.lights[outcome.id];
      if (!outcome.ok || !record.restore) continue;
      const saved = record.restore;
      record.restore = null; record.owner = null;
      try { await this.save(); }
      catch (error) {
        record.restore = saved; record.owner = target;
        outcome.ok = false; outcome.error = error.message;
      }
    }
    if (!command.target) {
      if (!outcomes[0].ok) throw new Error(outcomes[0].error);
      return this.read();
    }
    return { outcomes: [...outcomes, ...skipped], state: await this.catalog({ refreshIds: ids }) };
  }
  async gradient(command) {
    const allIds = this.members(command.target);
    if (typeof command.enabled !== 'boolean') throw new Error('Choose Start or Stop.');
    if (!command.enabled) { await this.music.stop(allIds); await this.gradients.stop(allIds); return this.catalog(); }
    const config = gradientConfig(command);
    const ids = allIds.filter(id => this.availability.get(id) !== false && this.settings.lights[id].transport !== 'bluetooth');
    if (!ids.length) throw new Error('No available lights in this target.');
    for (const id of ids) if (this.settings.lights[id].restore || this.settings.lights[id].owner) throw new Error('Restore Full White before starting Gradient.');
    await this.music.stop(allIds);
    await this.gradients.start(command.target, ids, config);
    return this.catalog();
  }
  async startMusic(target) {
    const allIds = this.members(target), ids = allIds.filter(id=>this.availability.get(id) !== false && this.settings.lights[id].transport !== 'bluetooth');
    if (!ids.length) throw Error('No available lights in this target.');
    for (const id of ids) if (this.settings.lights[id].restore || this.settings.lights[id].owner) throw Error('Restore Full White before starting Music.');
    await this.gradients.stop(allIds);
    return this.music.start(target, ids);
  }
  async close() { this.music.close(); this.gradients.close(); await this.tail; await this.controller?.close(); }
}
Object.assign(Lighting.prototype, management);
Object.assign(Lighting.prototype, scenes);
Object.assign(Lighting.prototype, schedules);
