import assert from 'node:assert/strict';
import { Lighting } from './lighting.mjs';
import { Scheduler, dueOccurrence } from './schedules.mjs';

const lighting = new Lighting();
lighting.nodeIds = new Map([['1', 1n], ['2', 2n]]);
lighting.settings = { version: 2, lights: {}, groups: { room: { name: 'Living Room', members: ['1', '2'] } },
  scenes: { movie: { id: 'movie', name: 'Movie', target: 'room', lights: { '1': { raw: { on: true, level: 10, mode: 2, mireds: 300 } }, '2': { raw: { on: true, level: 10, mode: 2, mireds: 300 } } } } } };
let persisted;
lighting.save = async () => { persisted = JSON.stringify(lighting.settings); };
const power = new Map(), restored = [];
for (const id of lighting.nodeIds.keys()) {
  lighting.settings.lights[id] = { name: `Light ${id}`, restore: null, owner: null };
  power.set(id, false);
  lighting.bulbs.set(id, {
    power: { on: async () => power.set(id, true), off: async () => power.set(id, false) },
    read: async () => ({ id, name: `Light ${id}`, on: power.get(id), raw: { on: power.get(id), level: 10, mode: 2, mireds: 300 } }),
    restore: async value => { restored.push(id); power.set(id, value.on); },
  });
}

await assert.rejects(lighting.schedule({ type: 'create', target: 'nowhere', action: 'on', hour: 7, minute: 0, days: [1] }), /room/);
await assert.rejects(lighting.schedule({ type: 'create', target: 'all-rooms', action: 'scene', sceneId: 'movie', hour: 7, minute: 0, days: [1] }), /scene saved for this room/);
await assert.rejects(lighting.schedule({ type: 'create', target: 'room', action: 'on', hour: 24, minute: 0, days: [1] }), /valid time/);
await assert.rejects(lighting.schedule({ type: 'create', target: 'room', action: 'on', hour: 7, minute: 0, days: [] }), /at least one day/);

const every = [0, 1, 2, 3, 4, 5, 6];
await lighting.schedule({ type: 'create', target: 'room', action: 'off', hour: 22, minute: 30, days: every });
let result = await lighting.schedule({ type: 'create', target: 'room', action: 'on', hour: 7, minute: 5, days: every });
assert.deepEqual(result.state.schedules.map(entry => [entry.hour, entry.minute]), [[7, 5], [22, 30]], 'Listed in time order');
const [morning, night] = lighting.scheduleList();
assert.equal(morning.enabled, true); assert.equal(morning.roomName, 'Living Room');
// Pretend both entries were created last week.
for (const entry of Object.values(lighting.settings.schedules)) entry.updatedAt = new Date(2026, 8, 1).toISOString();

const at = (day, hour, minute, second = 0) => new Date(2026, 8, day, hour, minute, second);
assert.equal(dueOccurrence(lighting.settings.schedules[morning.id], at(21, 7, 4)), null, 'Not before the time');
assert.deepEqual(dueOccurrence(lighting.settings.schedules[morning.id], at(21, 7, 6)), at(21, 7, 5));
assert.equal(dueOccurrence(lighting.settings.schedules[morning.id], at(21, 7, 8)), null, 'Missed runs are skipped, not run late');

let now = at(21, 7, 5, 20);
const scheduler = new Scheduler(lighting, { now: () => now });
await scheduler.tick();
assert.deepEqual([...power.values()], [true, true]);
assert.equal(lighting.settings.schedules[morning.id].lastRun.ok, true);
power.set('1', false);
now = at(21, 7, 6); await scheduler.tick();
assert.equal(power.get('1'), false, 'Runs once per day');
now = at(22, 7, 5, 30); await scheduler.tick();
assert.equal(power.get('1'), true, 'Runs again the next day');

// Just after midnight, an 11:59 PM entry from yesterday still runs.
await lighting.schedule({ type: 'update', id: night.id, target: 'room', action: 'off', hour: 23, minute: 59, days: [2] });
lighting.settings.schedules[night.id].updatedAt = new Date(2026, 8, 1).toISOString();
now = at(23, 0, 0, 30); await scheduler.tick();
assert.deepEqual([...power.values()], [false, false], 'Tuesday 11:59 PM ran at 12:00 AM Wednesday');

// Paused entries and edits for a time already passed do not run.
await lighting.schedule({ type: 'enable', id: morning.id, enabled: false });
now = at(24, 7, 5, 30); await scheduler.tick();
assert.deepEqual([...power.values()], [false, false]);
await lighting.schedule({ type: 'enable', id: morning.id, enabled: true });
assert.equal(dueOccurrence(lighting.settings.schedules[morning.id], new Date(Date.now() + 1000)), null, 'Resuming does not run a passed time');

// Blocked controller records a skip.
lighting.settings.schedules[morning.id].updatedAt = new Date(2026, 8, 1).toISOString();
const blocked = new Scheduler(lighting, { now: () => now, blocked: () => 'a light was being paired.' });
now = at(25, 7, 5, 30); await blocked.tick();
assert.deepEqual([...power.values()], [false, false]);
assert.match(lighting.settings.schedules[morning.id].lastRun.message, /Skipped: a light was being paired/);

// Scenes, and deleted scenes.
const sceneEntry = (await lighting.schedule({ type: 'create', target: 'room', action: 'scene', sceneId: 'movie', hour: 8, minute: 0, days: every }))
  .state.schedules.find(entry => entry.action === 'scene');
assert.equal(sceneEntry.sceneName, 'Movie');
lighting.settings.schedules[sceneEntry.id].updatedAt = new Date(2026, 8, 1).toISOString();
now = at(25, 8, 0, 10); await scheduler.tick();
assert.deepEqual(restored.sort(), ['1', '2']);
assert.equal(lighting.settings.schedules[sceneEntry.id].lastRun.ok, true);
await lighting.scene({ type: 'delete', id: 'movie' });
assert.equal(lighting.scheduleList().find(entry => entry.id === sceneEntry.id).problem, 'This scene was deleted.');
now = at(26, 8, 0, 10); await scheduler.tick();
assert.equal(lighting.settings.schedules[sceneEntry.id].lastRun.ok, false);

// Saved and deleted.
assert.equal(Object.keys(JSON.parse(persisted).schedules).length, 3);
await lighting.schedule({ type: 'delete', id: sceneEntry.id });
assert.equal(lighting.scheduleList().length, 2);
await assert.rejects(lighting.schedule({ type: 'delete', id: sceneEntry.id }), /no longer exists/);
// Entries at the same time run in the listed order, which the user can change.
const ran = [];
const realRun = lighting.runSchedule;
lighting.runSchedule = function (id, ...rest) { ran.push(id); return realRun.call(this, id, ...rest); };
const first = (await lighting.schedule({ type: 'create', target: 'room', action: 'on', hour: 9, minute: 0, days: every })).state.schedules.find(entry => entry.hour === 9);
const second = (await lighting.schedule({ type: 'create', target: 'all-rooms', action: 'off', hour: 9, minute: 0, days: every })).state.schedules.filter(entry => entry.hour === 9)[1];
assert.deepEqual(lighting.scheduleList().filter(entry => entry.hour === 9).map(entry => entry.id), [first.id, second.id], 'New entries go last');
await assert.rejects(lighting.schedule({ type: 'move', id: first.id, direction: -1 }), /cannot move/);
await lighting.schedule({ type: 'move', id: second.id, direction: -1 });
assert.deepEqual(lighting.scheduleList().filter(entry => entry.hour === 9).map(entry => entry.id), [second.id, first.id]);
for (const id of [first.id, second.id]) lighting.settings.schedules[id].updatedAt = new Date(2026, 8, 1).toISOString();
now = at(27, 9, 0, 10); await scheduler.tick();
assert.deepEqual(ran, [second.id, first.id], 'Runs in the chosen order');
assert.deepEqual([...power.values()], [true, true], 'Power on ran last');
lighting.runSchedule = realRun;
console.log('Schedule tests passed.');
