import assert from 'node:assert/strict';
import { Peer } from '@matter/protocol';
import { reportedAddresses, alternateAddress, switchAddressFamily, refreshReportedAddresses } from './address-fallback.mjs';

const hex = text => Uint8Array.from(text.match(/../g), byte => parseInt(byte, 16));
const interfaces = [{
  name: 'WIFI_STA_DEF',
  iPv4Addresses: [hex('0a00001a')],
  iPv6Addresses: [hex('2601058b0001264c3e0f02fffe19a608'), hex('fe800000000000003e0f02fffe19a608')],
}];
const reported = reportedAddresses(interfaces, 21);
assert.deepEqual(reported, { ipv4: ['10.0.0.26'], ipv6: ['fe80:0:0:0:3e0f:2ff:fe19:a608%21'] }, 'Read IPv4 and link-local IPv6 from General Diagnostics');
assert.deepEqual(reportedAddresses([{ iPv4Addresses: [hex('00000000')], iPv6Addresses: [] }], 21).ipv4, [], 'Skip an empty IPv4 address');
assert.deepEqual(reportedAddresses(interfaces, undefined).ipv6, [], 'Without a LAN adapter number, offer no IPv6 address');

const ipv6 = { type: 'udp', ip: 'fe80::3e0f:2ff:fe19:a608%21', port: 5540 };
assert.deepEqual(alternateAddress(ipv6, reported), { type: 'udp', ip: '10.0.0.26', port: 5540 }, 'IPv6 failed: try IPv4');
assert.deepEqual(alternateAddress({ type: 'udp', ip: '10.0.0.26', port: 5540 }, reported), { type: 'udp', ip: 'fe80:0:0:0:3e0f:2ff:fe19:a608%21', port: 5540 }, 'IPv4 failed: try IPv6');
assert.equal(alternateAddress({ type: 'udp', ip: '10.0.0.26', port: 5540 }, { ipv4: ['10.0.0.26'], ipv6: [] }), undefined, 'No other family: keep the address');
assert.equal(alternateAddress(ipv6, { ipv4: [], ipv6: [] }), undefined);

const peer = { descriptor: { operationalAddress: { ...ipv6 } } };
const client = {
  state: { commissioning: { peerAddress: { nodeId: 1n } }, generalDiagnostics: { networkInterfaces: interfaces } },
  env: { maybeGet: type => type === Peer ? peer : undefined },
};
const controller = { node: { peers: [client] } };
assert.equal(switchAddressFamily(controller, 1n, 21), '10.0.0.26');
assert.equal(peer.descriptor.operationalAddress.ip, '10.0.0.26', 'The next connection uses IPv4');
assert.equal(switchAddressFamily(controller, 1n, 21), 'fe80:0:0:0:3e0f:2ff:fe19:a608%21', 'The next failure goes back to IPv6');
assert.equal(switchAddressFamily(controller, 2n, 21), undefined, 'An unknown light changes nothing');
assert.equal(switchAddressFamily({}, 1n, 21), undefined, 'A simulated controller changes nothing');
let reads = 0;
refreshReportedAddresses({ getRootClusterClient: () => ({ getNetworkInterfacesAttribute: async fresh => { assert.equal(fresh, true); reads++; } }) });
refreshReportedAddresses({ getRootClusterClient: () => { throw new Error('offline'); } });
refreshReportedAddresses({});
await new Promise(resolve => setImmediate(resolve));
assert.equal(reads, 1, 'A connection refreshes the reported addresses; failures stay quiet');
console.log('PASS: a failed light alternates between its IPv6 and IPv4 addresses.');
