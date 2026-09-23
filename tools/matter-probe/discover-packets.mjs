// Read-only Matter DNS-SD diagnostics. No controller, pairing, or cloud access.
import '@matter/nodejs';
import { Environment, Network, MdnsSocket, DnsMessageType, DnsRecordType, DnsRecordClass, Logger, LogLevel } from '@matter/general';

const seconds = Number(process.argv[2] ?? 20);
if (!Number.isFinite(seconds) || seconds < 1 || seconds > 60) throw new Error('Use a duration from 1 to 60 seconds.');
Logger.defaultLogLevel = LogLevel.ERROR;
const socket = await MdnsSocket.create(Environment.default.get(Network), { netInterface: process.argv[3] ?? 'Wi-Fi' });
socket.registerRelevantNames('diagnostics', 'all');
const seen = new Set();
const hosts = new Set();
socket.receipt.on(message => {
  const records = [...message.answers, ...message.additionalRecords];
  const matter = records.filter(record => record.name.toLowerCase().includes('._matter'));
  for (const record of matter) if (record.recordType === DnsRecordType.SRV) hosts.add(record.value.target.toLowerCase());
  const relevant = records.filter(record => matter.includes(record) || hosts.has(record.name.toLowerCase()));
  if (!relevant.length) return;
  const result = {
    source: message.sourceIp, interface: message.sourceIntf,
    records: relevant.map(record => ({
      name: record.name, type: DnsRecordType[record.recordType],
      value: record.recordType === DnsRecordType.TXT
        ? record.value.map(value => new TextDecoder().decode(value)) : record.value,
    })),
  };
  const key = JSON.stringify(result);
  if (!seen.has(key)) { seen.add(key); console.log(key); }
});
async function query() {
  await socket.send({ messageType: DnsMessageType.Query, queries: [
    { name: '_matterc._udp.local', recordType: DnsRecordType.PTR, recordClass: DnsRecordClass.IN },
  ] });
}
let interval;
try {
  console.log(`Listening for Matter advertisements for ${seconds}s (IPv4 and IPv6).`);
  await query();
  interval = setInterval(() => query().catch(error => console.error(error.message)), 2000);
  await new Promise(resolve => setTimeout(resolve, seconds * 1000));
  console.log(`Received ${seen.size} distinct Matter responses.`);
} finally {
  clearInterval(interval);
  await socket.close();
}
