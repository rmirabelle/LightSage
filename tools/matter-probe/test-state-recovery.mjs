import assert from 'node:assert/strict';
import { Lighting } from './lighting.mjs';

const lighting = new Lighting();
lighting.stateReadTimeoutMs = 20;
lighting.nodeIds = new Map([['1', 1n], ['2', 2n]]);
lighting.settings = { lights: { '1': { name: 'Slow', restore: null }, '2': { name: 'Healthy', restore: null } }, groups: {} };
let finish, calls = 0;
const stalled = new Promise(resolve => { finish = resolve; });
lighting.read = async id => {
  if (id === '1') { calls++; return stalled; }
  return { id, name: 'Healthy', available: true, on: true };
};
let catalog = await lighting.serial(() => lighting.catalog());
assert.equal(catalog.lights[0].available, false);
assert.match(catalog.lights[0].error, /not responding/);
assert.equal(catalog.lights[1].available, true);
assert.equal(await lighting.serial(() => 'queue remains usable'), 'queue remains usable');
await lighting.catalog();
assert.equal(calls, 1, 'timeouts must not start duplicate Matter reads');
finish({ id: '1', available: true });
await new Promise(resolve => setImmediate(resolve));
assert.equal(lighting.catalogReads.size, 0);
lighting.read = async id => ({ id, available: true });
catalog = await lighting.catalog();
assert(catalog.lights.every(light => light.available));
lighting.read = async () => { throw new Error('Session lost'); };
catalog = await lighting.catalog();
assert(catalog.lights.every(light => !light.available));
assert.equal(lighting.catalogReads.size, 0, 'failed reads must allow subsequent retries');
console.log('PASS: bounded bulb reads, healthy bulb state, unblocked queue, deduplicated retries, and recovery.');

const recovering = new Lighting();
recovering.stateReadTimeoutMs = 10;
recovering.nodeIds = new Map([['9', 9n]]);
recovering.bulbs.set('9', { stale: true });
let rejectStale, disconnects = 0, connects = 0, restored = false;
const stale = new Promise((_, reject) => { rejectStale = reject; });
recovering.read = async () => restored ? { id: '9', available: true } : stale;
recovering.controller = {
  async disconnectNode(id, force) {
    assert.equal(id, 9n); assert.equal(force, true);
    disconnects++; rejectStale(new Error('Operation aborted'));
  },
  async getNode() { return { connect(options) {
    assert.equal(options.autoSubscribe, false); connects++; restored = true;
  } }; },
};
await assert.rejects(recovering.catalogRead('9'), /not responding/);
await new Promise(resolve => setImmediate(resolve));
assert.equal(recovering.bulbs.has('9'), false, 'discard stale cluster wrappers');
assert.equal(disconnects, 1);
assert.equal(connects, 1);
assert.equal((await recovering.catalogRead('9')).available, true, 'next automatic refresh reads the recovered bulb');
recovering.recoverBulb('9');
await new Promise(resolve => setImmediate(resolve));
assert.equal(disconnects, 1, 'repeated refreshes must not create a reconnect storm');
console.log('PASS: stalled read cancellation, per-bulb automatic reconnection, next-poll recovery, and reconnect throttling.');
recovering.catalog = async () => ({ lights: [{ id: '9', available: restored }] });
assert.equal((await recovering.retryBulb('9')).lights[0].available, true);
assert.equal(disconnects, 2, 'explicit Retry bypasses the automatic recovery cooldown');
await assert.rejects(recovering.retryBulb('missing'), /Unknown light/);
console.log('PASS: manual retry forces a fresh connection and validates bulb identity.');

const replaced = new Lighting();
replaced.stateReadTimeoutMs = 10;
replaced.nodeIds = new Map([['13', 13n]]);
let settleOld, settleNew, readCount = 0;
const oldRead = new Promise(resolve => { settleOld = resolve; });
const newRead = new Promise(resolve => { settleNew = resolve; });
replaced.read = () => ++readCount === 1 ? oldRead : newRead;
replaced.controller = {
  async disconnectNode() {}, // initialization waiter survives the disconnect
  async getNode() { return { connect() {} }; },
};
await assert.rejects(replaced.catalogRead('13'), /not responding/);
await new Promise(resolve => setImmediate(resolve));
const fresh = replaced.catalogRead('13');
await new Promise(resolve => setImmediate(resolve));
assert.equal(readCount, 2, 'next poll must not reuse the pre-reconnect read');
settleOld({ id: '13', available: true, stale: true });
await new Promise(resolve => setImmediate(resolve));
assert.equal(replaced.catalogReads.size, 1, 'late old completion must not remove the new read');
settleNew({ id: '13', available: true });
assert.deepEqual(await fresh, { id: '13', available: true });
console.log('PASS: reconnect replaces an unresolved read and isolates its late completion.');

const started = [], release = [];
const batch = {
  nodeIds: new Map([['1', 1n], ['2', 2n]]),
  recoverBulb(id, force) { assert.equal(force, true); started.push(id); return new Promise(resolve => release.push(resolve)); },
  catalog() { return 'refreshed'; },
};
const retry = Lighting.prototype.retryBulbs.call(batch, ['1', '2', '1']);
assert.deepEqual(started, ['1', '2'], 'all distinct bulbs start recovery before waiting');
release.forEach(resolve => resolve());
assert.equal(await retry, 'refreshed');
started.length = 0;
await assert.rejects(Lighting.prototype.retryBulbs.call(batch, ['1', 'missing']));
assert.deepEqual(started, [], 'validate entire batch before reconnecting any bulb');
console.log('PASS: parallel batch retry, deduplication, and all-or-nothing validation.');
