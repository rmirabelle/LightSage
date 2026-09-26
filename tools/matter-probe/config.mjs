import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
export const stateDir = process.env.LIGHTSAGE_STATE_DIR || fileURLToPath(new URL('./.state/', import.meta.url));
export const stateFile = name => join(stateDir, name);
export function localAddresses(interfaces = networkInterfaces()) {
  return [...new Set(Object.values(interfaces).flat().filter(v => v && !v.internal && v.family === 'IPv4').map(v => v.address))];
}
export const addresses = localAddresses();
export const phoneAddress = addresses.find(ip => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) || addresses[0] || '127.0.0.1';
export const hostsFor = port => ['localhost', '127.0.0.1', ...addresses].map(host => `${host}:${port}`);

function port(name, fallback) { const value = Number(process.env[name] || fallback); if (!Number.isInteger(value) || value < 1024 || value > 65535) throw Error('Invalid port: ' + name); return value; }
export const httpPort = port('LIGHTSAGE_HTTP_PORT', 3442);
export const httpsPort = port('LIGHTSAGE_HTTPS_PORT', 3443);
export const setupPort = port('LIGHTSAGE_SETUP_PORT', 3444);
