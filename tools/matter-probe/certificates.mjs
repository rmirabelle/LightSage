import forge from 'node-forge';
import { randomBytes, X509Certificate } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

async function read(file) { try { return await readFile(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
async function save(file, value) { await writeFile(`${file}.tmp`, value, { mode: 0o600 }); await rename(`${file}.tmp`, file); }
function certificate(keys, name, days) {
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01' + randomBytes(16).toString('hex');
  cert.validity.notBefore = new Date(Date.now() - 300000);
  cert.validity.notAfter = new Date(Date.now() + days * 86400000);
  cert.setSubject([{ name: 'commonName', value: name }]);
  return cert;
}
export async function ensureCertificates(stateDir, addresses) {
  const dir = join(stateDir, 'tls'); await mkdir(dir, { recursive: true });
  let rootPem = await read(join(dir, 'root.crt')), rootKeyPem = await read(join(dir, 'root.key'));
  if (Boolean(rootPem) !== Boolean(rootKeyPem)) throw Error('The local certificate authority is incomplete. Restore its certificate and key from backup.');
  if (!rootPem) {
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const root = certificate(keys, 'LightSage Local CA', 3650); root.setIssuer(root.subject.attributes);
    root.setExtensions([{ name: 'basicConstraints', cA: true, critical: true, pathLenConstraint: 0 }, { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true }]);
    root.sign(keys.privateKey, forge.md.sha256.create());
    rootPem = forge.pki.certificateToPem(root); rootKeyPem = forge.pki.privateKeyToPem(keys.privateKey);
    await save(join(dir, 'root.key'), rootKeyPem); await save(join(dir, 'root.crt'), rootPem);
  }
  const root = forge.pki.certificateFromPem(rootPem), rootKey = forge.pki.privateKeyFromPem(rootKeyPem);
  if (root.validity.notAfter < new Date()) throw Error('The LightSage certificate authority has expired.');
  const ips = [...new Set(['127.0.0.1', ...addresses])];
  const existing = await read(join(dir, 'server.crt')), existingKey = await read(join(dir, 'server.key'));
  if (existing && existingKey) {
    const cert = new X509Certificate(existing);
    if (Date.parse(cert.validTo) > Date.now() + 30 * 86400000 && ips.every(ip => cert.checkIP(ip)) && cert.checkHost('localhost') && cert.verify(new X509Certificate(rootPem).publicKey)) return;
  }
  const keys = forge.pki.rsa.generateKeyPair(2048), cert = certificate(keys, 'LightSage Local', 365);
  cert.setIssuer(root.subject.attributes);
  cert.setExtensions([{ name: 'basicConstraints', cA: false, critical: true }, { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true }, { name: 'extKeyUsage', serverAuth: true }, { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, ...ips.map(ip => ({ type: 7, ip }))] }]);
  cert.sign(rootKey, forge.md.sha256.create());
  await save(join(dir, 'server.key'), forge.pki.privateKeyToPem(keys.privateKey));
  await save(join(dir, 'server.crt'), forge.pki.certificateToPem(cert));
}
