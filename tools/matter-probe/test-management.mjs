import assert from 'node:assert/strict';
import { Lighting } from './lighting.mjs';
import { Seconds } from '@matter/general';
import { PairingJob } from './pairing-job.mjs';

assert.equal(new PairingJob({}).timeoutMs, 20000);
const lighting = new Lighting();
lighting.nodeIds = new Map([['1', 1n], ['2', 2n]]);
lighting.settings = { version: 2, lights: { '1': { name: 'R', restore: null, owner: null }, '2': { name: 'L', restore: null, owner: null } }, groups: { dining: { name: 'Dining', members: ['1', '2'] } } };
let persisted, failSave = false, identifies = 0;
lighting.save = async () => { if (failSave) throw new Error('Disk failure'); persisted = structuredClone(lighting.settings); };
for (const id of lighting.nodeIds.keys()) lighting.bulbs.set(id, {
  name: lighting.settings.lights[id].name, record: lighting.settings.lights[id],
  async read() { return { id, name: this.name, available: true, fullWhite: !!this.record.restore }; },
  async identify() { identifies++; },
});
await lighting.manage({ type: 'createRoom', name: 'Office' });
const office = Object.keys(lighting.settings.groups).find(id => id !== 'dining');
const empty = (await lighting.catalog()).groups.find(group => group.id === office);
assert.equal(empty.available, false);
assert.equal(empty.kelvin, null);
await assert.rejects(lighting.manage({ type: 'createRoom', name: ' office ' }), /already exists/);
await lighting.manage({ type: 'saveBulb', id: '1', name: 'Desk', room: office });
assert.deepEqual(persisted.groups.dining.members, ['2']);
assert.deepEqual(persisted.groups[office].members, ['1']);
assert.equal((await lighting.read('1')).name, 'Desk');
await lighting.manage({ type: 'renameRoom', id: office, name: 'Study' });
lighting.settings.lights['2'].restore = { level: 20 };
lighting.settings.lights['2'].owner = 'dining';
await assert.rejects(lighting.manage({ type: 'saveBulb', id: '1', name: 'Desk', room: 'dining' }), /Restore Full White/);
await lighting.manage({ type: 'saveBulb', id: '2', name: 'Dining L', room: 'dining' });
assert.deepEqual(lighting.settings.lights['2'].restore, { level: 20 });
failSave = true;
await assert.rejects(lighting.manage({ type: 'saveBulb', id: '1', name: 'Lost', room: '' }), /Disk failure/);
assert.equal((await lighting.read('1')).name, 'Desk');
assert.deepEqual(lighting.settings.groups[office].members, ['1']);
failSave = false;
await lighting.manage({ type: 'saveBulb', id: '1', name: 'Desk', room: '' });
assert.deepEqual(lighting.settings.groups[office].members, []);
await lighting.identify('1'); assert.equal(identifies, 1);
await assert.rejects(lighting.identify('missing'), /Choose a light/);
assert.throws(() => lighting.pairInput({ name: 'New', room: '', code: '123' }), /Matter setup code/);
const input = lighting.pairInput({ name: 'New', room: '', code: '34970112332' });
let commissionArgs;
lighting.controller = { async commissionNode(args) { commissionArgs = args; return 3n; }, getCommissionedNodes() { return [1n, 2n, 3n]; } };
const paired = await lighting.pair(input);
assert.equal(paired.id, '3');
assert.equal(commissionArgs.discovery.timeout, Seconds(15));
assert.equal(persisted.lights['3'].name, 'New');
assert.equal(commissionArgs.discovery.discoveryCapabilities.ble, false);
assert.equal(commissionArgs.discovery.discoveryCapabilities.onIpNetwork, true);
assert.equal(commissionArgs.commissioning.onAttestationFailure([{ level: 'error' }]), false);
assert.equal(JSON.stringify(persisted).includes('34970112332'), false);
let finish;
const job = new PairingJob({ pairInput: value => value, serial: action => Promise.resolve().then(action), pair: () => new Promise(resolve => { finish = resolve; }) });
job.start({ code: 'private' });
assert.equal(job.status.state, 'pairing');
const jobStartedAt = job.status.startedAt;
assert.throws(() => job.start({}), /already/);
assert.equal(JSON.stringify(job.status).includes('private'), false);
await Promise.resolve(); finish({ id: '4' });
await new Promise(resolve => setImmediate(resolve));
assert.equal(job.status.state, 'succeeded');
assert.equal(job.status.startedAt, jobStartedAt);
const failedJob = new PairingJob({ pairInput: value => value, serial: action => Promise.resolve().then(action), pair: async () => { throw new Error('Pairing window closed'); } });
failedJob.start({});
await new Promise(resolve => setImmediate(resolve));
assert.equal(failedJob.status.state, 'failed');
assert.match(failedJob.status.message, /Pairing window closed/);
lighting.controller.commissionNode = async () => { throw new Error('Private protocol detail'); };
await assert.rejects(lighting.pair(input), /Pairing did not finish/);
assert.equal(lighting.nodeIds.has('3'), true);
assert.equal(persisted.lights['3'].name, 'New');
console.log('PASS: room membership, empty rooms, rename, override protection, save rollback, Identify, local pairing, and background job isolation.');

let recoveries = 0, lateFinish;
const stuckJob = new PairingJob({ pairInput: value => value, serial: action => Promise.resolve().then(action), pair: () => new Promise(resolve => { lateFinish = resolve; }) }, { timeoutMs: 15, onTimeout: () => { recoveries++; } });
stuckJob.start({});
await new Promise(resolve => setTimeout(resolve, 35));
assert.equal(stuckJob.status.state, 'failed');
assert.equal(stuckJob.status.recovering, true);
assert.equal(recoveries, 1);
assert.throws(() => stuckJob.start({}), /recovering/);
lateFinish({ id: '99' });
await new Promise(resolve => setImmediate(resolve));
assert.equal(stuckJob.status.state, 'failed', 'late completion must not overwrite timeout');
let releaseQueue, attempted = false;
const queuedJob = new PairingJob({ pairInput: value => value, serial: action => new Promise(resolve => { releaseQueue = resolve; }).then(action), pair: async () => { attempted = true; } }, { timeoutMs: 15 });
queuedJob.start({});
await new Promise(resolve => setTimeout(resolve, 35));
releaseQueue();
await new Promise(resolve => setImmediate(resolve));
assert.equal(attempted, false, 'expired queued work must never begin pairing');
console.log('PASS: overall pairing deadline, recovery lock, late result protection, and expired queued work.');

for(const address of ['8.8.8.8','example.com','127.0.0.1','10.0.0.999']) {
 assert.throws(()=>lighting.pairInput({name:'Test',room:'',code:'34970112332',address}),/private local IP/);
}
const direct = lighting.pairInput({name:'Test',room:'',code:'34970112332',address:'10.0.0.60'});
lighting.controller.commissionNode = async args => { commissionArgs=args; return 3n; };
await lighting.pair(direct);
assert.deepEqual(commissionArgs.discovery.knownAddress,{ip:'10.0.0.60',port:5540,type:'udp'});
assert.equal(commissionArgs.discovery.identifierData,undefined);
console.log('PASS: direct local-address pairing and rejection of public or invalid addresses.');

assert.equal(lighting.pairInput({name:'Test',room:'',code:'34970112332',address:'fe80::5ee7:53ff:fec1:431c%18'}).address,'fe80::5ee7:53ff:fec1:431c%18');

let fallbackCalls = 0;
lighting.controller.commissionNode = async () => { fallbackCalls++; return 3n; };
lighting.commissionLocal = async options => {
  assert.equal(options.passcode, input.passcode);
  assert.equal(options.onAttestationFailure([{level:'error'}]), false);
  return 3n;
};
await lighting.pair(input);
assert.equal(fallbackCalls, 0, 'authenticated local commissioning must not open a second pairing session');
lighting.commissionLocal = async () => undefined;
await lighting.pair(input);
assert.equal(fallbackCalls, 1, 'standard discovery remains available when local candidates do not authenticate');
lighting.commissionLocal = async () => { throw Error('Failed after authentication'); };
await assert.rejects(lighting.pair(input), /Pairing did not finish/);
assert.equal(fallbackCalls, 1, 'do not silently restart commissioning after an authenticated attempt fails');
console.log('PASS: automatic local pairing integration, no duplicate session, and standard discovery fallback.');
