import { Peer } from '@matter/protocol';
import { GeneralDiagnostics } from '@matter/types/clusters';
import { lanScope } from './link-local.mjs';

/**
 * Some VPN apps (for example Proton VPN) turn off IPv6 on the Wi-Fi adapter
 * while they are connected. LightSage saves one IPv6 link-local address per
 * light, and the lights do not send mDNS announcements to the PC, so every
 * light then fails until IPv6 comes back. The lights also accept Matter over
 * IPv4. Each reconnection after a failure tries the other address family.
 * When a session starts, matter.js saves the address that worked.
 */
const isLinkLocal = bytes => bytes?.length === 16 && bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80;
const ipv6Text = bytes => Array.from({ length: 8 }, (_, i) => ((bytes[2 * i] << 8) | bytes[2 * i + 1]).toString(16)).join(':');

/** Addresses that a light reports in its General Diagnostics network interfaces. */
export function reportedAddresses(networkInterfaces, scope) {
  const ipv4 = [], ipv6 = [];
  for (const network of networkInterfaces ?? []) {
    for (const bytes of network?.iPv4Addresses ?? []) if (bytes?.length === 4 && bytes.some(Boolean)) ipv4.push([...bytes].join('.'));
    if (scope) for (const bytes of network?.iPv6Addresses ?? []) if (isLinkLocal(bytes)) ipv6.push(`${ipv6Text(bytes)}%${scope}`);
  }
  return { ipv4, ipv6 };
}

/** The address to try next: the first one of the other address family. */
export function alternateAddress(current, reported) {
  const ip = current?.ip;
  const next = typeof ip === 'string' && ip.includes(':') ? reported.ipv4[0] : reported.ipv6[0];
  return next && next !== ip ? { type: 'udp', ip: next, port: current?.port ?? 5540 } : undefined;
}

/**
 * Saved network interfaces can be old: a light can report 0.0.0.0, or get a
 * new IPv4 address from the router. A fresh read updates the saved copy.
 */
export function refreshReportedAddresses(node) {
  void Promise.resolve().then(() => node.getRootClusterClient(GeneralDiagnostics)?.getNetworkInterfacesAttribute(true)).catch(() => {});
}

/** Point a light at its other address family. Returns the new address, or undefined. */
export function switchAddressFamily(controller, nodeId, scope = lanScope()) {
  const client = [...controller?.node?.peers ?? []].find(peer => String(peer.state?.commissioning?.peerAddress?.nodeId) === String(nodeId));
  const peer = client?.env?.maybeGet?.(Peer);
  if (!peer?.descriptor) return undefined;
  const next = alternateAddress(peer.descriptor.operationalAddress, reportedAddresses(client.state.generalDiagnostics?.networkInterfaces, scope));
  if (next) peer.descriptor.operationalAddress = next;
  return next?.ip;
}
