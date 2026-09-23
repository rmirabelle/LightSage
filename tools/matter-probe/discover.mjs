// Discovery only: no controller, pairing, DCL, OTA, HTTP, or cloud API.
import '@matter/nodejs';
import { Environment, Seconds } from '@matter/general';
import { CommissionableMdnsScanner, MdnsService } from '@matter/protocol';

const seconds = Number(process.argv[2] ?? 20);
if (!Number.isFinite(seconds) || seconds < 1 || seconds > 60) {
  throw new Error('Discovery duration must be between 1 and 60 seconds.');
}
const networkInterface = process.argv[3];
const mdns = new MdnsService(Environment.default, { networkInterface });
let scanner;
try {
  await mdns.construction;
  scanner = new CommissionableMdnsScanner(mdns.names);
  console.log(`Scanning locally for pairable Matter devices for ${seconds}s...`);
  const devices = await scanner.findCommissionableDevicesContinuously(
    {},
    device => console.log(JSON.stringify(device, (_, v) =>
      typeof v === 'bigint' ? v.toString() : v, 2)),
    Seconds(seconds),
  );
  console.log(`Found ${devices.length} pairable device(s).`);
  if (!devices.length) {
    console.log('This does not establish incompatibility. Check pairing mode and local multicast connectivity.');
  }
} finally {
  await scanner?.close();
  await mdns.close();
}
