// Diagnostic: query local neighbors for Matter DNS-SD; never authenticate or pair.
import dgram from 'node:dgram';
import { execFileSync } from 'node:child_process';
import { DnsCodec, DnsMessageType, DnsRecordType, DnsRecordClass } from '@matter/general';

const neighbors = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command',
  "@(Get-NetNeighbor -InterfaceAlias 'Wi-Fi' -AddressFamily IPv4 | Where-Object { $_.State -ne 'Permanent' -and $_.State -ne 'Unreachable' } | Select-Object IPAddress,LinkLayerAddress,InterfaceIndex) | ConvertTo-Json -Compress",
], { encoding: 'utf8', windowsHide: true }));
const sockets = [];
let responses = 0;
const seen = new Set();
for (const family of ['udp4', 'udp6']) {
  const socket = dgram.createSocket({ type: family, ipv6Only: family === 'udp6' });
  sockets.push(socket);
  socket.on('error', error => console.error(`${family}: ${error.message}`));
  socket.on('message', (bytes, remote) => {
    let message;
    try { message = DnsCodec.decode(bytes); } catch { return; }
    if (!message) return;
    const records = [...message.answers, ...message.additionalRecords];
    if (!records.some(record => record.name.toLowerCase().includes('._matter'))) return;
    const result = JSON.stringify({ source: remote.address, records: records.map(record => ({
      name: record.name, type: DnsRecordType[record.recordType],
      value: record.recordType === DnsRecordType.TXT ? record.value.map(value => new TextDecoder().decode(value)) : record.value,
    })) });
    if (!seen.has(result)) { seen.add(result); responses++; console.log(result); }
  });
  await new Promise(resolve => socket.bind(0, resolve));
}
const packet = DnsCodec.encode({ transactionId: 1234, messageType: DnsMessageType.Query,
  queries: ['_matterc._udp.local'].map(name => ({ name, recordType: DnsRecordType.PTR, recordClass: DnsRecordClass.IN, uniCastResponse: true })),
});
for (const neighbor of neighbors.slice(0, 64)) {
  sockets[0].send(packet, 5353, neighbor.IPAddress);
  const mac = neighbor.LinkLayerAddress.split('-').map(value => parseInt(value, 16));
  if (mac.length !== 6 || mac.some(value => !Number.isFinite(value)) || (mac[0] & 1)) continue;
  const eui = [mac[0] ^ 2, mac[1], mac[2], 255, 254, mac[3], mac[4], mac[5]];
  const parts = Array.from({ length: 4 }, (_, index) => ((eui[index * 2] << 8) | eui[index * 2 + 1]).toString(16));
  const address = `fe80::${parts.join(':')}%${neighbor.InterfaceIndex}`;
  sockets[1].send(packet, 5353, address, error => { if (error) console.error(`${address}: ${error.code}`); });
}
console.log(`Sent read-only Matter DNS-SD queries to ${neighbors.length} local neighbors over IPv4 and candidate IPv6 addresses.`);
await new Promise(resolve => setTimeout(resolve, 5000));
for (const socket of sockets) socket.close();
console.log(`Received ${responses} distinct Matter responses.`);
