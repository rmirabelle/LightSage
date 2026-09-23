import { Lighting } from './lighting.mjs';
import assert from 'node:assert/strict';
const lighting = new Lighting();
lighting.settings = { version: 2, lights: {}, groups: { 'dining-room': { name: 'Dining Room', members: ['1', '2'] } } };
lighting.nodeIds = new Map([['1', 1n], ['2', 2n]]);
let persisted;
lighting.save = async () => { persisted = structuredClone(lighting.settings); };
let failRead = false;
let failRestore = false;
// Hold each bulb's level command until both bulbs have started it. A serial
// implementation times out, so this verifies overlap without timing a fast run.
let levelStarts = 0;
let releaseLevels;
const levelsStarted = new Promise(resolve => { releaseLevels = resolve; });
for (const id of ['1', '2']) {
  const record = { name: `Dining ${id}`, restore: null, owner: null };
  lighting.settings.lights[id] = record;
  let state = { on: id === '1', level: id === '1' ? 18 : 180, mode: 2, mireds: id === '1' ? 370 : 200 };
  lighting.bulbs.set(id, {
    raw: async () => { if (id === '2' && failRead) throw new Error('Offline'); return structuredClone(state); },
    read: async () => ({ id, name: record.name, on: state.on, brightness: state.level / 254 * 100, colorMode: state.mode, kelvin: 1e6 / state.mireds, fullWhite: !!record.restore }),
    setWhite: async mireds => { state.mode = 2; state.mireds = mireds; },
    setLevel: async level => {
      if (++levelStarts === 2) releaseLevels();
      let timeout;
      try {
        await Promise.race([levelsStarted, new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Group level commands did not overlap')), 2000);
        })]);
      } finally { clearTimeout(timeout); }
      state.level = level;
    },
    power: { on: async () => { state.on = true; }, off: async () => { state.on = false; } },
    restore: async saved => { if (id === '2' && failRestore) throw new Error('Offline'); state = structuredClone(saved); },
  });
}
failRead = true;
await assert.rejects(lighting.command({ target: 'dining-room', type: 'fullWhite', enabled: true }), /Offline/);
assert.equal(lighting.settings.lights['1'].restore, null);
assert.equal((await lighting.bulbs.get('1').raw()).level, 18);
failRead = false;
const white = await lighting.command({ target: 'dining-room', type: 'fullWhite', enabled: true });
assert(white.outcomes.every(item => item.ok));
for (const bulb of lighting.bulbs.values()) {
  const state = await bulb.raw();
  assert.equal(state.mireds, 227);
  assert.equal(state.mode, 2);
  assert.equal(state.level, 254);
  assert.equal(state.on, true);
}
failRestore = true;
const partial = await lighting.command({ target: 'dining-room', type: 'fullWhite', enabled: false });
assert.deepEqual(partial.outcomes.map(item => item.ok), [true, false]);
assert.equal(persisted.lights['1'].restore, null);
assert.equal(persisted.lights['2'].restore.level, 180);
assert.equal(partial.state.groups[0].fullWhite, true);
failRestore = false;
const retry = await lighting.command({ target: 'dining-room', type: 'fullWhite', enabled: false });
assert(retry.outcomes.every(item => item.ok));
assert.equal(persisted.lights['2'].restore, null);
assert.equal((await lighting.bulbs.get('2').raw()).on, false);
console.log('PASS: parallel bulb commands, snapshot preflight abort, partial restore persistence, and retry without losing originals.');
