import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { X509Certificate, createPrivateKey } from 'node:crypto';
import { ensureCertificates } from './certificates.mjs';
import { localAddresses } from './config.mjs';
const dir = await mkdtemp(join(tmpdir(), 'lightsage-install-'));
try {
  assert.deepEqual(localAddresses({ loop: [{family:'IPv4',internal:true,address:'127.0.0.1'}], ethernet: [{family:'IPv4',internal:false,address:'192.168.50.10'}], ipv6: [{family:'IPv6',internal:false,address:'::1'}] }), ['192.168.50.10']);
  await ensureCertificates(dir, ['192.168.50.10']);
  const read = file => readFile(join(dir, 'tls', file), 'utf8');
  const root = await read('root.crt'), server = await read('server.crt');
  const cert = new X509Certificate(server);
  assert(cert.verify(new X509Certificate(root).publicKey));
  assert(cert.checkPrivateKey(createPrivateKey(await read('server.key'))));
  assert(cert.checkIP('192.168.50.10')); assert(cert.checkIP('127.0.0.1')); assert(cert.checkHost('localhost'));
  assert(new X509Certificate(root).ca);
  await ensureCertificates(dir, ['192.168.50.10']); assert.equal(await read('server.crt'), server, 'Reuse valid certificates');
  await ensureCertificates(dir, ['192.168.50.11']); assert.equal(await read('root.crt'), root, 'Preserve phone trust when address changes');
  assert(new X509Certificate(await read('server.crt')).checkIP('192.168.50.11'));
  await rm(join(dir, 'tls', 'root.key'));
  await assert.rejects(ensureCertificates(dir, []), /incomplete/, 'Do not silently replace a damaged authority');
  console.log('PASS: fresh certificate setup, key matching, address detection, certificate reuse, IP changes, and incomplete authority protection.');
} finally { await rm(dir, { recursive: true, force: true }); }
