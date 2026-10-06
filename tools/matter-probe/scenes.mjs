import { randomUUID } from 'node:crypto';
import { gradientConfig } from './gradients.mjs';

function label(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 60) throw Error('Use a scene name between 1 and 60 characters.');
  return value.trim();
}
function validSnapshot(value) {
  const integer = (key, min, max) => Number.isInteger(value?.[key]) && value[key] >= min && value[key] <= max;
  return typeof value?.on === 'boolean' && integer('level', 0, 254) &&
    (value.mode === 0 && integer('hue', 0, 254) && integer('saturation', 0, 254) ||
     value.mode === 1 && integer('x', 0, 65279) && integer('y', 0, 65279) ||
     value.mode === 2 && integer('mireds', 1, 65279));
}
function unlocked(lighting, ids) {
  if (ids.some(id => lighting.settings.lights[id]?.restore || lighting.settings.lights[id]?.owner)) {
    throw Error('Restore Full White on the affected lights before saving or applying a scene.');
  }
}

export function matchesSceneLight(saved, light) {
  if (!light?.available || !light.raw || light.fullWhite || light.music) return false;
  const raw = light.raw;
  if (saved.raw.ble) return raw.ble?.mode === 2 && ['on','brightnessByte'].every(key=>raw.ble[key]===saved.raw.ble[key]) && raw.ble.rgb.every((v,i)=>v===saved.raw.ble.rgb[i]);
  if (raw.on !== saved.raw.on || raw.level !== saved.raw.level) return false;
  if (saved.gradient || light.gradient) {
    return !!saved.gradient && !!light.gradient && ['duration', 'repeat'].every(key => saved.gradient[key] === light.gradient[key]) &&
      ['start', 'end'].every(end => ['hue', 'saturation'].every(key => saved.gradient[end][key] === light.gradient[end][key]));
  }
  if (raw.mode !== saved.raw.mode) return false;
  const keys = raw.mode === 0 ? ['hue', 'saturation'] : raw.mode === 1 ? ['x', 'y'] : ['mireds'];
  return keys.every(key => raw[key] === saved.raw[key]);
}
export const scenes = {
  sceneList(lights = []) {
    return Object.values(this.settings.scenes ?? {}).map(scene => {
      const current = scene.target === 'all-rooms' ? [...this.nodeIds.keys()] : this.settings.groups[scene.target]?.members ?? [];
      const saved = Object.keys(scene.lights);
      const membershipChanged = current.length !== saved.length || current.some(id => !saved.includes(id));
      // ALL ROOMS restores the saved lights only; adding a light does not
      // prevent that saved scene from becoming clean after it is restored.
      const scopeChanged = scene.target !== 'all-rooms' && membershipChanged;
      const active = !scopeChanged && saved.length > 0 && saved.every(id => matchesSceneLight(scene.lights[id], lights.find(light => light.id === id)));
      const selected = this.settings.sceneSelections?.[scene.target] === scene.id;
      const known = saved.length > 0 && saved.every(id => lights.find(light => light.id === id)?.available);
      return { id: scene.id, name: scene.name, target: scene.target, count: saved.length,
        membershipChanged,
        active, selected, dirty: selected && !active && (scopeChanged || known),
        hasGradient: Object.values(scene.lights).some(light => light.gradient), updatedAt: scene.updatedAt };
    });
  },
  async scene(command) {
    if (!command || !['create', 'replace', 'rename', 'delete', 'apply'].includes(command.type)) throw Error('Unknown scene action.');
    const existing = Object.hasOwn(this.settings.scenes ?? {}, command.id) ? this.settings.scenes[command.id] : null;
    if (command.type !== 'create' && !existing) throw Error('This scene no longer exists.');
    if (command.type === 'apply') return this.applyScene(existing, command.ids);
    const next = structuredClone(this.settings);
    next.scenes ??= {};
    if (command.type === 'delete') {
      delete next.scenes[existing.id];
      if (next.sceneSelections?.[existing.target] === existing.id) delete next.sceneSelections[existing.target];
    }
    else {
      const target = existing?.target ?? command.target;
      if (target !== 'all-rooms' && !Object.hasOwn(this.settings.groups, target)) throw Error('Choose a room or ALL ROOMS.');
      const name = command.type === 'replace' ? existing.name : label(command.name);
      if (Object.values(next.scenes).some(scene => scene.id !== existing?.id && scene.target === target && scene.name.toLowerCase() === name.toLowerCase())) throw Error('A scene with this name already exists here.');
      let lights = existing?.lights;
      if (command.type === 'create' || command.type === 'replace') {
        const ids = this.members(target);
        if (!ids.length) throw Error('Add lights to this room before saving a scene.');
        unlocked(this, ids);
        if (ids.some(id => this.music.state(id))) throw Error('Stop Music before saving a scene. Music scenes are not supported yet.');
        // Save the controller's last confirmed state (also used by the UI).
        // Polls and control responses keep it current; only missing or failed
        // observations require device I/O here. Never save a partial scene.
        const results = await Promise.allSettled(ids.map(async id => {
          const cached = this.catalogSnapshots.get(id);
          const observed = cached?.available && this.availability.get(id) !== false && validSnapshot(cached.raw)
            ? cached : await this.catalogRead(id);
          this.catalogSnapshots.set(id, structuredClone(observed));
          this.availability.set(id, true);
          const raw = structuredClone(observed.raw);
          const active = this.gradients.state(id);
          const gradient = active ? gradientConfig(active) : null;
          if (gradient && raw) Object.assign(raw, { mode: 0, hue: Math.round(gradient.start.hue / 360 * 254), saturation: Math.round(gradient.start.saturation / 100 * 254) });
          if (!validSnapshot(raw)) throw Error('Current settings could not be read completely.');
          return [id, { raw, gradient }];
        }));
        const failed = ids.filter((id, index) => results[index].status === 'rejected');
        if (failed.length) throw Error(`Scene was not saved. Could not read: ${failed.map(id => this.settings.lights[id].name).join(', ')}. Reconnect these lights and try again.`);
        lights = Object.fromEntries(results.map(result => result.value));
      }
      const id = existing?.id ?? randomUUID();
      next.scenes[id] = { id, name, target, lights, updatedAt: new Date().toISOString() };
      if (command.type === 'create' || command.type === 'replace') {
        next.sceneSelections ??= {};
        next.sceneSelections[target] = id;
      }
    }
    await this.commitSettings(next);
    return { state: await this.catalog({ cachedOnly: true }) };
  },
  async applyScene(scene, retryIds) {
    const savedIds = Object.keys(scene.lights);
    const current = this.members(scene.target);
    // Moving a bulb must never make a room scene reach into another room.
    if (scene.target !== 'all-rooms' && (current.length !== savedIds.length || current.some(id => !savedIds.includes(id)))) {
      throw Error('This room’s lights have changed. Set the room how you like it, then replace this scene with current settings.');
    }
    if (retryIds !== undefined && (!Array.isArray(retryIds) || !retryIds.length || retryIds.some(id => !savedIds.includes(id)))) throw Error('Choose saved scene lights to retry.');
    const ids = retryIds === undefined ? savedIds : [...new Set(retryIds)];
    unlocked(this, ids);
    for (const id of ids) {
      if (!validSnapshot(scene.lights[id].raw)) throw Error('This scene has invalid saved settings. Replace it with current settings.');
      if (scene.lights[id].gradient) gradientConfig(scene.lights[id].gradient);
    }
    await this.music.stop(ids);
    await this.gradients.stop(ids);
    const outcomes = await Promise.all(ids.map(async id => {
      const name = this.settings.lights[id]?.name ?? `Light ${id}`;
      /**
       * Scenes run inside the serial queue. A missing light can make a Matter
       * connect wait for minutes, which blocks every later request. Skip lights
       * already known to be down (an explicit retry still tries them), and give
       * the rest a deadline.
       */
      if (retryIds === undefined && this.availability.get(id) === false) return { id, name, ok: false, error: 'Light unavailable.' };
      let timer;
      try {
        await Promise.race([(async () => {
          const bulb = await this.bulb(id);
          await bulb.restore(scene.lights[id].raw);
          const gradient = scene.lights[id].gradient;
          if (gradient) {
            await this.gradients.start(scene.target, [id], gradient);
            if (!this.gradients.state(id)) throw Error(this.gradients.errors.get(id) ?? 'Gradient could not be started.');
          }
        })(), new Promise((_, reject) => {
          timer = setTimeout(() => {
            this.availability.set(id, false);
            this.recoverBulb(id);
            reject(Error('Light is not responding.'));
          }, this.sceneLightTimeoutMs ?? 10000);
        })]);
        return { id, name, ok: true };
      } catch (error) { return { id, name, ok: false, error: error.message }; }
      finally { clearTimeout(timer); }
    }));
    if (outcomes.every(outcome => outcome.ok) && ids.length === savedIds.length) {
      const next = structuredClone(this.settings);
      next.sceneSelections ??= {};
      next.sceneSelections[scene.target] = scene.id;
      await this.commitSettings(next);
    }
    return { outcomes, state: await this.catalog({ refreshIds: outcomes.filter(outcome => outcome.ok).map(outcome => outcome.id) }) };
  },
};
