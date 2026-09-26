import assert from 'node:assert/strict';
import { Lighting } from './lighting.mjs';

const lighting = new Lighting();
lighting.nodeIds = new Map([['1', 1n], ['2', 2n]]);
const raw = { on: true, level: 100, mode: 2, mireds: 300 };
lighting.settings = { lights: { '1': { name: 'Kitchen', restore: null }, '2': { name: 'Other room', restore: null, transport: 'bluetooth' } },
  groups: { kitchen: { name: 'Kitchen', members: ['1'] } },
  scenes: { dinner: { id: 'dinner', name: 'Dinner', target: 'kitchen', lights: { '1': { raw } } } } };
lighting.save = async () => {};
let on = true, reads = 0, finishOld, finishOther;
const old = new Promise(resolve => { finishOld = resolve; });
const other = new Promise(resolve => { finishOther = resolve; });
const observation = () => ({ id: '1', available: true, on, raw: { ...raw, on } });
lighting.catalogSnapshots.set('1', observation());
lighting.availability.set('1', true);
lighting.bulbs.set('1', {
  read: async () => ++reads === 1 ? old : observation(),
  power: { off: async () => { on = false; } },
  restore: async value => { on = value.on; },
});
lighting.bulbs.set('2', { read: () => other });
const promptly = async action => {
  let timer;
  try { return await Promise.race([action, new Promise((_, reject) => {
    timer = setTimeout(() => reject(Error('Action waited for unrelated background reads')), 500);
  })]); } finally { clearTimeout(timer); }
};

try {
  await promptly(lighting.pollCatalog());
  const refresh = lighting.backgroundRefresh;
  assert.equal(lighting.serialPending, 0);
  const result = await promptly(lighting.serial(() => lighting.command({ target: 'kitchen', type: 'power', on: false })));
  assert.equal(result.state.lights[0].on, false, 'confirmation must not reuse the unfinished pre-command read');
  assert.equal(reads, 2);
  const scene = await promptly(lighting.serial(() => lighting.scene({ type: 'apply', id: 'dinner' })));
  assert.equal(scene.state.scenes[0].active, true);
  await promptly(lighting.serial(() => lighting.scene({ type: 'delete', id: 'dinner' })));
  assert.deepEqual(lighting.settings.scenes, {});
  finishOld({ id: '1', available: true, on: false, raw: { ...raw, on: false } });
  finishOther({ id: '2', available: true });
  await refresh;
  assert.equal(lighting.catalogSnapshots.get('1').on, true, 'late polling must not overwrite confirmed command state');
  assert.equal(lighting.catalogSnapshots.has('2'), false, 'discard observations from an obsolete refresh');
  console.log('PASS: polling, power, scene apply and scene deletion remain responsive with stalled Matter/Bluetooth reads; stale polls cannot overwrite commands.');
} finally {
  finishOld(observation()); finishOther({ id: '2', available: true });
  await lighting.backgroundRefresh;
}

// A superseded failed poll must not tear down the session used by a command.
let fail;
const stale = new Lighting();
stale.read = () => new Promise((_, reject) => { fail = reject; });
let recoveries = 0;
stale.recoverBulb = () => { recoveries++; };
const pending = stale.catalogRead('1');
await stale.serial(async () => {});
fail(Error('Old session timed out'));
await assert.rejects(pending, /Old session/);
assert.equal(recoveries, 0);
assert.equal(stale.availability.has('1'), false);
console.log('PASS: superseded poll failures do not disconnect command sessions.');
