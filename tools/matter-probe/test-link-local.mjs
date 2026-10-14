import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lanScope, repairLinkLocalScopes } from './link-local.mjs';

const wifi = [
  { family: 'IPv4', address: '10.0.0.250', internal: false },
  { family: 'IPv6', address: '2601:58b:1:264c::704c', internal: false, scopeid: 0 },
  { family: 'IPv6', address: 'fe80::912e:bd4c:801f:b1b5', internal: false, scopeid: 19 },
];
const virtualSwitch = [
  { family: 'IPv4', address: '172.25.192.1', internal: false },
  { family: 'IPv6', address: 'fe80::22f7:4a91:63f1:6ca6', internal: false, scopeid: 51 },
];
assert.equal(lanScope({ 'vEthernet (Default Switch)': virtualSwitch, 'Wi-Fi': wifi }, undefined), 19, 'Choose the adapter on the routed home LAN');
assert.equal(lanScope({ 'Wi-Fi': wifi, 'vEthernet (Default Switch)': virtualSwitch }, 'vEthernet (Default Switch)'), 51, 'A configured adapter name wins');
assert.equal(lanScope({ 'Wi-Fi': wifi, Ethernet: wifi }, undefined), undefined, 'Two routed adapters are ambiguous; change nothing');
assert.equal(lanScope({ 'vEthernet (Default Switch)': virtualSwitch }, undefined), undefined);

const dir = await mkdtemp(join(tmpdir(), 'lightsage-scope-'));
try {
  const file = name => join(dir, `nodes.${name}.endpoints.0.commissioning.addresses`);
  await writeFile(file('peer1'), JSON.stringify([{ type: 'udp', ip: 'fe80::3e0f:2ff:fe19:a608%20', port: 5540 }]));
  await writeFile(file('peer2'), JSON.stringify([{ type: 'udp', ip: 'fe80::3e0f:2ff:fe19:9134%19', port: 5540 }]));
  await writeFile(file('peer3'), JSON.stringify([{ type: 'udp', ip: '10.0.0.40', port: 5540 }]));
  await writeFile(join(dir, 'nodes.peer1.endpoints.0.commissioning.peerAddress'), '"fe80::1%20"');
  assert.equal(await repairLinkLocalScopes(dir, 19), 1);
  assert.deepEqual(JSON.parse(await readFile(file('peer1'), 'utf8')), [{ type: 'udp', ip: 'fe80::3e0f:2ff:fe19:a608%19', port: 5540 }]);
  assert.equal(JSON.parse(await readFile(file('peer3'), 'utf8'))[0].ip, '10.0.0.40', 'IPv4 addresses have no adapter number');
  assert.equal(await readFile(join(dir, 'nodes.peer1.endpoints.0.commissioning.peerAddress'), 'utf8'), '"fe80::1%20"', 'Only address lists change');
  assert.equal(await repairLinkLocalScopes(dir, 19), 0, 'A second pass changes nothing');
  assert.equal(await repairLinkLocalScopes(dir, undefined), 0, 'An unknown adapter changes nothing');
  assert.equal(await repairLinkLocalScopes(join(dir, 'missing'), 19), 0);
} finally { await rm(dir, { recursive: true, force: true }); }
console.log('PASS: saved link-local light addresses follow the current LAN adapter number.');
