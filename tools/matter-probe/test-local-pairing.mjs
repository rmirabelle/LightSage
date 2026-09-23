import assert from 'node:assert/strict';
import { neighborCandidates, commissionCandidates } from './local-pairing.mjs';

const record = { LinkLayerAddress: '5C-E7-53-AB-D5-AC', InterfaceIndex: 18 };
assert.deepEqual(neighborCandidates([record, record,
  { ...record, LinkLayerAddress: '00-11-22-33-44-55' },
  { ...record, InterfaceIndex: '18;whoami' },
]), [['fe80::5ee7:53ff:feab:d5ac%18']]);
assert.deepEqual(neighborCandidates([
  { ...record, LinkLayerAddress: '3C-0F-02-17-D4-44' },
  { ...record, LinkLayerAddress: 'DC-B4-D9-EF-E4-E4' },
]), [['fe80::3e0f:2ff:fe17:d444%18'], ['fe80::deb4:d9ff:feef:e4e4%18']]);
assert.deepEqual(neighborCandidates([
  { ...record, IPAddress: '10.0.0.224' },
  { ...record, IPAddress: 'fe80::5ee7:53ff:feab:d5ac%18' },
  { ...record, IPAddress: '10.0.0.224' },
  { ...record, IPAddress: '8.8.8.8' },
  { ...record, IPAddress: '10.invalid' },
]), [['10.0.0.224', 'fe80::5ee7:53ff:feab:d5ac%18']], 'group both IP families for one device, deduplicate, and reject public or malformed IPv4');
let commissioned = 0, persisted = 0;
const calls = [];
const descriptors = [];
const controller = {
  fabric: { async persist() { persisted++; } }, async connectNode() {},
  node: { peers: {
    async runCommissioning(node, action) { return action(); },
    async forDescriptor({ addresses }) {
      descriptors.push(addresses);
      const ip = addresses[0].ip;
      return { peerAddress: { nodeId: 11n }, async commission(options) {
        calls.push(ip);
        if (ip === 'wrong') throw Error('Incorrect key confirmation');
        await new Promise(resolve => setImmediate(resolve));
        if (!options.continueCommissioningAfterPase()) throw Error('Another candidate won');
        if (ip === 'fails-after-auth') throw Error('Certificate failure');
        commissioned++;
      } };
    },
  } },
};
assert.equal(await commissionCandidates(['wrong', 'correct', 'also-correct'], controller, { passcode: 123 }), 11n);
assert.equal(commissioned, 1, 'only the authenticated winner may be commissioned');
assert.equal(persisted, 1);
assert.equal(calls.length, 3, 'wrong code on one device must not cancel another device');
assert.equal(await commissionCandidates(['wrong'], controller, {}), undefined);
assert.equal(await commissionCandidates([], controller, {}), undefined);
await assert.rejects(commissionCandidates(['fails-after-auth'], controller, {}), /Certificate failure/);
assert.equal(await commissionCandidates([['10.0.0.224', 'fe80::deb4:d9ff:feef:e4e4%18']], controller, {}), 11n);
assert.deepEqual(descriptors.at(-1).map(address => address.ip), ['10.0.0.224', 'fe80::deb4:d9ff:feef:e4e4%18'], 'both addresses reach the SDK in one commissioning attempt');
console.log('PASS: grouped local IPv4/IPv6 candidates, setup-code selection, single commissioning winner, and failed candidate isolation.');
