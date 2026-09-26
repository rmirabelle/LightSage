import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isIP } from 'node:net';
import { Seconds } from '@matter/general';
import { PeerSet } from '@matter/protocol';

const execute = promisify(execFile);

// Govee prefixes observed on this installation's H6006 and H6013 bulbs.
// Try both IP families when commissioning advertisements are absent. A prefix is only a candidate filter:
// setup-code authentication, never a name or MAC, selects the actual bulb.
export function neighborCandidates(neighbors) {
  const devices = new Map();
  for (const neighbor of neighbors) {
    const mac = String(neighbor.LinkLayerAddress ?? '').replaceAll(':', '-').toUpperCase();
    if (!/^(?:5C-E7-53|3C-0F-02|DC-B4-D9)(?:-[0-9A-F]{2}){3}$/.test(mac)) continue;
    if (!Number.isInteger(neighbor.InterfaceIndex) || neighbor.InterfaceIndex <= 0) continue;
    const bytes = mac.split('-').map(value => parseInt(value, 16));
    const eui = [bytes[0] ^ 2, bytes[1], bytes[2], 255, 254, bytes[3], bytes[4], bytes[5]];
    const groups = Array.from({ length: 4 }, (_, i) => ((eui[i * 2] << 8) | eui[i * 2 + 1]).toString(16));
    const key = `${mac}%${neighbor.InterfaceIndex}`;
    if (!devices.has(key)) devices.set(key, new Set());
    const addresses = devices.get(key);
    const ip = neighbor.IPAddress;
    if (typeof ip === 'string' && isIP(ip) === 4 && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) addresses.add(ip);
    addresses.add(`fe80::${groups.join(':')}%${neighbor.InterfaceIndex}`);
  }
  return [...devices.values()].map(addresses => [...addresses]);
}

export async function localCandidates() {
  if (process.platform !== 'win32') return [];
  const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "@(Get-NetNeighbor -ErrorAction Stop | Where-Object { $_.State -ne 'Permanent' -and $_.State -ne 'Unreachable' } | Select-Object LinkLayerAddress,InterfaceIndex,IPAddress) | ConvertTo-Json -Compress",
  ], { windowsHide: true, timeout: 2000, maxBuffer: 128 * 1024 });
  const values = JSON.parse(stdout || '[]');
  return neighborCandidates(Array.isArray(values) ? values : [values]);
}

export async function commissionCandidates(addresses, controller, options) {
  let winner;
  const attempts = addresses.map(candidate => ({ addresses: Array.isArray(candidate) ? candidate : [candidate], abort: new AbortController() }));
  const results = await Promise.allSettled(attempts.map(async attempt => {
    const node = await controller.node.peers.forDescriptor({
      addresses: attempt.addresses.map(ip => ({ ip, port: 5540, type: 'udp' })),
    });
    if (node.lifecycle?.isCommissioned) return undefined;
    await controller.node.peers.runCommissioning(node, () => node.commission({
      ...options, fabric: controller.fabric,
      autoSubscribe: false, autoStateInitialize: false,
      timeout: Seconds(3), abort: attempt.abort.signal,
      continueCommissioningAfterPase: () => {
        if (winner) return false;
        winner = attempt;
        for (const other of attempts) if (other !== attempt) other.abort.abort();
        return true;
      },
    }));
    return node.peerAddress.nodeId;
  }));
  if (!winner) {
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status !== 'rejected') continue;
      const reason = result.reason;
      console.warn(`Local pairing candidate ${attempts[i].addresses.join(', ')}: ${reason?.constructor?.name ?? 'Error'}: ${String(reason?.message ?? 'Failed').replaceAll(String(options.passcode), '[redacted]').slice(0, 300)}`);
    }
    return undefined;
  }
  const result = results[attempts.indexOf(winner)];
  if (result.status === 'rejected') throw result.reason;
  await controller.fabric.persist();
  await controller.connectNode(result.value, { autoSubscribe: false });
  return result.value;
}

export async function commissionLocalCandidates(controller, options) {
  let candidates;
  try { candidates = await localCandidates(); }
  catch { return undefined; } // Standard Matter discovery remains available.
  if (!candidates.length) return undefined;
  const pairedAddresses = new Set(controller.getCommissionedNodes().map(id =>
    controller.node.env.get(PeerSet).get(controller.fabric.addressOf(id))?.descriptor.operationalAddress?.ip));
  candidates = candidates.filter(addresses => !addresses.some(ip => pairedAddresses.has(ip))).slice(0, 16);
  if (!candidates.length) return undefined;
  return commissionCandidates(candidates, controller, options);
}
