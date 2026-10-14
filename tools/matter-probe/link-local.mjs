import { networkInterfaces } from 'node:os';
import { readdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Windows can renumber the Wi-Fi adapter after a driver update or a new
 * network profile. Saved link-local light addresses keep the old number
 * (fe80::...%18), and the lights cannot be reached through it. When mDNS
 * announcements do not arrive, Matter uses only these saved addresses.
 */
export function lanScope(interfaces = networkInterfaces(), name = process.env.LIGHTSAGE_NETWORK_INTERFACE) {
  const linkLocal = entries => entries?.find(v => v.family === 'IPv6' && !v.internal && /^fe80:/i.test(v.address));
  if (name) return linkLocal(interfaces[name])?.scopeid;
  // The home LAN gives a routable IPv6 address; virtual switches do not.
  const lan = Object.values(interfaces).filter(entries => linkLocal(entries) &&
    entries.some(v => v.family === 'IPv6' && !v.internal && /^[23]/.test(v.address)));
  return lan.length === 1 ? linkLocal(lan[0]).scopeid : undefined;
}

export async function repairLinkLocalScopes(storageDir, scope) {
  if (!Number.isInteger(scope) || scope <= 0) return 0;
  let files;
  try { files = await readdir(storageDir); }
  catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
  let repaired = 0;
  for (const file of files.filter(name => name.endsWith('.commissioning.addresses'))) {
    const path = join(storageDir, file);
    let addresses;
    try { addresses = JSON.parse(await readFile(path, 'utf8')); } catch { continue; }
    if (!Array.isArray(addresses)) continue;
    let changed = false;
    const next = addresses.map(address => {
      const match = typeof address?.ip === 'string' && address.ip.match(/^(fe80:[^%]*)%(\d+)$/i);
      if (!match || Number(match[2]) === scope) return address;
      changed = true;
      return { ...address, ip: `${match[1]}%${scope}` };
    });
    if (!changed) continue;
    await writeFile(`${path}.tmp`, JSON.stringify(next));
    await rename(`${path}.tmp`, path);
    repaired++;
  }
  return repaired;
}
