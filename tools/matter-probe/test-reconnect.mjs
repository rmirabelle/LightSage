import assert from 'node:assert/strict';
import { reconnect } from './reconnect.mjs';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

let lights = [{ id: '9', name: 'Island 3', available: false }, { id: '11', name: 'Island 1', available: true }];
const lighting = { async retryBulbs(ids) {
  assert.deepEqual(ids, ['9', '11']);
  return { lights, groups: [], allRooms: {} };
} };
let result = await reconnect(lighting, ['9', '11'], true);
assert.equal(result.recovery.restarting, true);
assert.match(result.recovery.message, /Island 3/);
assert.equal(result.lights[0].available, false, 'Starting recovery is not proof of availability');
result = await reconnect(lighting, ['9', '11'], false);
assert.equal(result.recovery.restarting, false, 'Never exit an unsupervised controller');
assert.match(result.recovery.message, /Restart the lighting service/);
lights = lights.map(light => ({ ...light, available: true }));
result = await reconnect(lighting, ['9', '11'], true);
assert.equal(result.recovery.restarting, false);
assert.match(result.recovery.message, /Fresh state confirmed for Island 3, Island 1/);
await assert.rejects(reconnect({ retryBulbs() { throw Error('Invalid bulbs'); } }, [], true), /Invalid bulbs/);
console.log('PASS: failed manual retry escalates only with supervision; success confirms fresh state; validation errors do not restart.');

// Exercise the actual HTTP route's restart scheduling without disconnecting
// real hardware. A hung shutdown must still release the supervised worker.
const source = await readFile(new URL('./server.mjs', import.meta.url), 'utf8');
const route = source.slice(source.indexOf("        if (pathname === '/api/reconnect'"), source.indexOf("        if (pathname === '/api/identify'"));
const timers = [], exits = [], replies = [];
let shutdowns = 0;
const context = vm.createContext({
  pathname: '/api/reconnect', req: { method: 'POST' }, res: {},
  body: async () => ({ ids: ['9', '11'] }),
  lighting: { ...lighting, serial: action => action() }, reconnect,
  pairing: { status: { state: 'idle' } }, connectionRestart: false, connectionRetry: false,
  process: { connected: true, exit: code => exits.push(code) },
  setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
  shutdown: () => { shutdowns++; return new Promise(() => {}); }, console: { warn() {} },
  reply: (_res, status, data) => replies.push({ status, data }),
});
lights[0].available = false;
await vm.runInContext(`(async () => { ${route} })()`, context);
assert.equal(replies[0].status, 200);
assert.equal(context.connectionRestart, true);
assert.equal(context.connectionRetry, false);
assert.equal(shutdowns, 0, 'Send retry feedback before shutting down');
assert.equal(timers[0].ms, 500);
timers[0].fn();
assert.equal(shutdowns, 1);
assert.equal(timers[1].ms, 2000);
timers[1].fn();
assert.deepEqual(exits, [75], 'A stuck shutdown cannot prevent recovery');
console.log('PASS: HTTP retry reports restart, resets its guard, and forces worker exit if shutdown stalls.');
