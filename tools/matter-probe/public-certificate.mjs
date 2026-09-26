import acme from 'acme-client';
import { X509Certificate } from 'node:crypto';
import { promises as dns, Resolver } from 'node:dns';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Optional publicly trusted certificate for phone access.
 *
 * The domain's DNS is hosted on Cloudflare. LightSage keeps the A record for the
 * phone hostname pointed at this PC's local address and answers the Let's Encrypt
 * DNS-01 challenge through the Cloudflare API. The PC never accepts connections
 * from the internet.
 */
const renewBeforeMs = 30 * 86400000;
const hostnamePattern = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

async function read(file) { try { return await readFile(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
async function save(file, value) { await writeFile(`${file}.tmp`, value, { mode: 0o600 }); await rename(`${file}.tmp`, file); }

export async function loadPublicHttps(stateDir) {
  const text = await read(join(stateDir, 'public-https.json'));
  if (!text) return null;
  const config = JSON.parse(text);
  const hostname = String(config.hostname ?? '').trim().toLowerCase();
  const cloudflareToken = String(config.cloudflareToken ?? '').trim();
  if (!hostnamePattern.test(hostname)) throw Error('public-https.json: hostname must be a full name such as lights.example.com.');
  if (!cloudflareToken) throw Error('public-https.json: cloudflareToken is missing.');
  return { hostname, cloudflareToken, zoneId: config.zoneId ? String(config.zoneId).trim() : undefined, staging: config.staging === true };
}

export async function readPublicCertificate(stateDir, hostname) {
  const cert = await read(join(stateDir, 'tls', 'public.crt')), key = await read(join(stateDir, 'tls', 'public.key'));
  if (!cert || !key) return null;
  const leaf = new X509Certificate(cert);
  if (!leaf.checkHost(hostname) || Date.parse(leaf.validTo) <= Date.now()) return null;
  return { cert, key, expires: Date.parse(leaf.validTo) };
}

export const needsRenewal = certificate => !certificate || certificate.expires - Date.now() < renewBeforeMs;

async function cloudflare(config, path, method = 'GET', body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: { Authorization: `Bearer ${config.cloudflareToken}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw Error(`Cloudflare rejected the request (${response.status}): ${data.errors?.map(e => e.message).join('; ') || 'no details'}`);
  }
  return data.result;
}

/** Find the Cloudflare zone that contains the hostname, trying each parent name. */
async function zone(config) {
  if (config.zone) return config.zone;
  if (config.zoneId) return config.zone = await cloudflare(config, `/zones/${config.zoneId}`);
  const labels = config.hostname.split('.');
  for (let i = 1; i < labels.length - 1; i++) {
    const [found] = await cloudflare(config, `/zones?name=${labels.slice(i).join('.')}`);
    if (found) return config.zone = found;
  }
  throw Error(`Cloudflare has no zone for ${config.hostname}. Check the token's zone access, or add "zoneId" to public-https.json.`);
}

const recordsNamed = async (config, type, name) => cloudflare(config, `/zones/${(await zone(config)).id}/dns_records?type=${type}&name=${name}`);

/** Keep the phone hostname pointed at this PC. The record must not be proxied: the address is local. */
export async function updateHostAddress(config, address) {
  const { id } = await zone(config);
  const [record, ...extra] = await recordsNamed(config, 'A', config.hostname);
  for (const old of extra) await cloudflare(config, `/zones/${id}/dns_records/${old.id}`, 'DELETE');
  if (record?.content === address && !record.proxied) return false;
  const body = { type: 'A', name: config.hostname, content: address, ttl: 300, proxied: false, comment: 'LightSage phone address' };
  if (record) await cloudflare(config, `/zones/${id}/dns_records/${record.id}`, 'PUT', body);
  else await cloudflare(config, `/zones/${id}/dns_records`, 'POST', body);
  return true;
}

/** Poll Cloudflare's own name servers so Let's Encrypt never checks before the record exists. */
async function waitForTxt(config, name, value, timeoutMs = 180000) {
  const servers = (await Promise.all((await zone(config)).name_servers.map(ns => dns.resolve4(ns).catch(() => [])))).flat();
  const resolver = new Resolver(); resolver.setServers(servers);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await new Promise(resolve => resolver.resolveTxt(name, (error, rows) => resolve(error ? [] : rows.map(r => r.join('')))));
    if (found.includes(value)) return;
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  throw Error(`Cloudflare did not publish ${name} within ${timeoutMs / 1000} seconds.`);
}

export async function obtainPublicCertificate(stateDir, config, log = console.log) {
  const dir = join(stateDir, 'tls'); await mkdir(dir, { recursive: true });
  const { id } = await zone(config), challengeName = `_acme-challenge.${config.hostname}`;
  let accountKey = await read(join(dir, 'acme-account.key'));
  if (!accountKey) { accountKey = (await acme.crypto.createPrivateKey()).toString(); await save(join(dir, 'acme-account.key'), accountKey); }
  const client = new acme.Client({ directoryUrl: acme.directory.letsencrypt[config.staging ? 'staging' : 'production'], accountKey });
  const [key, csr] = await acme.crypto.createCsr({ commonName: config.hostname });
  log(`Requesting a Let's Encrypt certificate for ${config.hostname}…`);
  const cert = await client.auto({
    csr,
    termsOfServiceAgreed: true,
    challengePriority: ['dns-01'],
    skipChallengeVerification: true,
    challengeCreateFn: async (_authz, _challenge, keyAuthorization) => {
      await cloudflare(config, `/zones/${id}/dns_records`, 'POST', { type: 'TXT', name: challengeName, content: `"${keyAuthorization}"`, ttl: 1, comment: 'LightSage certificate check' });
      await waitForTxt(config, challengeName, keyAuthorization);
    },
    challengeRemoveFn: async (_authz, _challenge, keyAuthorization) => {
      try {
        for (const record of await recordsNamed(config, 'TXT', challengeName)) {
          if (record.content.replace(/"/g, '') === keyAuthorization) await cloudflare(config, `/zones/${id}/dns_records/${record.id}`, 'DELETE');
        }
      } catch (error) { log(error.message); }
    },
  });
  await save(join(dir, 'public.key'), key.toString());
  await save(join(dir, 'public.crt'), cert);
  log(`Let's Encrypt certificate for ${config.hostname} saved.`);
  return readPublicCertificate(stateDir, config.hostname);
}
