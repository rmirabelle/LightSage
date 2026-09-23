import assert from 'node:assert/strict';
import { Lighting } from './lighting.mjs';

const lighting = new Lighting();
lighting.nodeIds = new Map([['1', 1n], ['2', 2n], ['3', 3n]]);
lighting.settings = { version: 2, lights: {}, groups: { room: { name: 'Living Room', members: ['1', '2'] } } };
let persisted, offline, failWrite = false, reads = 0;
lighting.save = async () => { if (failWrite) throw Error('Disk full'); persisted = JSON.stringify(lighting.settings); };
const values = new Map([
  ['1', { on: true, level: 72, mode: 0, hue: 140, saturation: 195 }],
  ['2', { on: false, level: 231, mode: 2, mireds: 300 }],
  ['3', { on: true, level: 101, mode: 1, x: 30000, y: 22000 }],
]);
const original = structuredClone(values), writes = [];
for (const id of lighting.nodeIds.keys()) {
  lighting.settings.lights[id] = { name: `Light ${id}`, restore: null, owner: null };
  const available = () => { if (offline === id) throw Error('Offline'); };
  lighting.bulbs.set(id, {
    raw: async () => { available(); return structuredClone(values.get(id)); },
    read: async () => { reads++; available(); return { id, name: `Light ${id}`, ...values.get(id), raw: structuredClone(values.get(id)) }; },
    restore: async value => { available(); writes.push(id); values.set(id, structuredClone(value)); },
    setColor: async (hue, saturation) => { available(); Object.assign(values.get(id), { mode: 0, hue: Math.round(hue / 360 * 254), saturation: Math.round(saturation / 100 * 254) }); },
    transitionColor: async () => { available(); }, stopColorTransition: async () => {},
  });
}
assert.deepEqual((await lighting.catalog()).scenes, []);
reads = 0;
await lighting.scene({ type: 'create', target: 'room', name: 'Movie' });
assert.equal(reads, 0, 'Saving confirmed settings and returning the UI state require no device reads');
const room = lighting.sceneList()[0];
assert.equal(lighting.settings.sceneSelections.room, room.id);
assert.equal((await lighting.catalog()).scenes.find(s=>s.id===room.id).dirty, false);
assert.equal(room.count, 2); assert.equal(writes.length, 0); assert.deepEqual(values, original);
lighting.catalogSnapshots.delete('3'); reads = 0;
await lighting.scene({ type: 'create', target: 'all-rooms', name: 'Evening' });
assert.equal(reads, 1, 'Only the light with missing state is read, once');
reads = 0;
const house = lighting.sceneList().find(scene => scene.target === 'all-rooms');
const savedResult = await lighting.scene({ type: 'replace', id: house.id });
assert.equal(reads, 0, 'Overwriting ALL ROOMS reuses all confirmed observations');
assert.equal(savedResult.state.scenes.find(scene=>scene.id===house.id).dirty, false);
assert.equal(house.count, 3);
const restarted = new Lighting(); restarted.settings = JSON.parse(persisted); restarted.nodeIds = lighting.nodeIds;
assert.deepEqual(restarted.sceneList(), lighting.sceneList());
assert.deepEqual(restarted.settings.scenes[house.id].lights['3'].raw, original.get('3'));
await assert.rejects(lighting.scene({ type: 'create', target: 'room', name: ' movie ' }), /already exists/);
await assert.rejects(lighting.scene({ type: 'create', target: '1', name: 'Wrong scope' }), /Choose a room/);
await assert.rejects(lighting.scene({ type: 'create', target: 'room', name: '  ' }), /scene name/);

values.get('1').level = 1; values.get('2').on = true; values.get('3').level = 5;
assert.equal((await lighting.catalog()).scenes.find(s=>s.id===room.id).dirty, true);
let result = await lighting.scene({ type: 'apply', id: room.id });
assert.equal(result.state.scenes.find(s=>s.id===room.id).dirty, false);
assert(result.outcomes.every(outcome => outcome.ok));
assert.deepEqual(values.get('1'), original.get('1')); assert.deepEqual(values.get('2'), original.get('2'));
assert.equal(values.get('3').level, 5, 'Room leaves other lights alone');
await lighting.scene({ type: 'apply', id: house.id }); assert.deepEqual(values, original);

offline = '2';
await lighting.catalog(); // The controller has observed the lost connection.
const beforeFailure = JSON.stringify(lighting.settings.scenes);
await assert.rejects(lighting.scene({ type: 'replace', id: room.id }), /Scene was not saved.*Light 2/);
assert.equal(JSON.stringify(lighting.settings.scenes), beforeFailure);
lighting.settings.lights['2'].restore = original.get('2');
await assert.rejects(lighting.scene({ type: 'apply', id: room.id }), /Restore Full White/);
await assert.rejects(lighting.scene({ type: 'create', target: 'all-rooms', name: 'Blocked' }), /Restore Full White/);
lighting.settings.lights['2'].restore = null;
result = await lighting.scene({ type: 'apply', id: room.id });
assert.deepEqual(result.outcomes.map(outcome => outcome.ok), [true, false]);
offline = undefined; writes.length = 0;
await lighting.scene({ type: 'apply', id: room.id, ids: ['2'] }); assert.deepEqual(writes, ['2']);
await assert.rejects(lighting.scene({ type: 'apply', id: room.id, ids: ['3'] }), /saved scene lights/);

lighting.settings.groups.room.members = ['1'];
assert(lighting.sceneList().find(scene => scene.id === room.id).membershipChanged);
writes.length = 0;
await assert.rejects(lighting.scene({ type: 'apply', id: room.id }), /room’s lights have changed/);
assert.equal(writes.length, 0);
await lighting.scene({ type: 'replace', id: room.id });
assert.equal(lighting.sceneList().find(scene => scene.id === room.id).count, 1);
assert.equal(lighting.settings.scenes[house.id].lights['2'].raw.on, false, 'House snapshot is independent');

lighting.nodeIds.set('4', 4n); lighting.settings.lights['4'] = { name: 'New bulb', restore: null };
assert(lighting.sceneList().find(scene => scene.id === house.id).membershipChanged);
writes.length = 0; result = await lighting.scene({ type: 'apply', id: house.id }); assert(!writes.includes('4'));
assert.equal(result.state.scenes.find(s=>s.id===house.id).dirty, false, 'Restoring ALL ROOMS clears dirty despite the extra light');
assert.equal(result.state.scenes.find(s=>s.id===house.id).active, true);
lighting.nodeIds.delete('4'); delete lighting.settings.lights['4'];
const gradient = { start: { hue: 0, saturation: 100 }, end: { hue: 180, saturation: 70 }, duration: 10000, repeat: 'alternate' };
await lighting.gradients.start('room', ['1'], gradient);
await lighting.scene({ type: 'create', target: 'room', name: 'Sunset' });
const sunset = lighting.sceneList().find(scene => scene.name === 'Sunset');
assert(sunset.hasGradient); assert.deepEqual(lighting.settings.scenes[sunset.id].lights['1'].gradient, gradient);
await lighting.gradients.stop(['1']);
result = await lighting.scene({ type: 'apply', id: sunset.id }); assert(result.outcomes[0].ok); assert(lighting.gradients.state('1'));
await lighting.scene({ type: 'apply', id: room.id }); assert.equal(lighting.gradients.state('1'), null);
lighting.music.bulbs.set('1', {});
await assert.rejects(lighting.scene({ type: 'create', target: 'room', name: 'Music' }), /Stop Music/);
lighting.music.bulbs.clear();

failWrite = true;
await assert.rejects(lighting.scene({ type: 'rename', id: room.id, name: 'Lost rename' }), /Disk full/);
assert.equal(lighting.settings.scenes[room.id].name, 'Movie');
failWrite = false;
await lighting.scene({ type: 'rename', id: room.id, name: 'Reading' });
assert.equal(lighting.settings.scenes[room.id].name, 'Reading');
writes.length = 0;
await lighting.scene({ type: 'delete', id: room.id }); assert.equal(writes.length, 0);
assert(!lighting.settings.scenes[room.id]);
await assert.rejects(lighting.scene({ type: 'apply', id: room.id }), /no longer exists/);
await lighting.close(); await restarted.close();
console.log('PASS: scene snapshots, scopes, restart persistence, per-bulb restoration, failures/retry, Full White and Music guards, membership changes, gradients, rename/delete, and save rollback.');
