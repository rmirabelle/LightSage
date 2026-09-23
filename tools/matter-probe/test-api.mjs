import { request } from 'node:https';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const ca = await readFile(new URL('./.state/tls/root.crt', import.meta.url));
const code = (await readFile(new URL('./.state/access-code.txt', import.meta.url), 'utf8')).trim();
let cookie;
function call(path, body, origin = 'https://127.0.0.1:3443') {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: 3443, path, ca,
      method: body ? 'POST' : 'GET', headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), 'Content-Type': 'application/json' } }, res => {
      let text = '';
      res.on('data', chunk => text += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}
assert.equal((await call('/api/light')).status, 401);
for (const endpoint of ['/api/pairing', '/api/manage', '/api/identify']) assert.equal((await call(endpoint, {})).status, 401);
assert.equal((await call('/api/link-code', {})).status, 401);
assert.equal((await call('/api/session', { code: 'incorrect' })).status, 401);
assert.equal((await call('/api/session', { code }, 'https://untrusted.example')).status, 403);
const auth = await call('/api/session', { code });
assert.equal(auth.status, 200);
assert.match(auth.headers['set-cookie'][0], /HttpOnly/);
assert.match(auth.headers['set-cookie'][0], /Secure/);
cookie = auth.headers['set-cookie'][0].split(';')[0];
assert.equal((await call('/api/pairing')).status, 200);
assert.equal((await call('/api/pairing', { name: 'Test', room: '', code: 'invalid' })).status, 400);
assert.equal((await call('/api/manage', { type: 'createRoom', name: 'Nope' }, 'https://untrusted.example')).status, 403);
const state = await call('/api/light');
assert.equal(state.status, 200);
assert.equal(typeof state.data.name, 'string');
assert.equal(typeof state.data.fullWhite, 'boolean');
const catalog = await call('/api/state');
assert.equal(catalog.status, 200);
assert(catalog.data.lights.length > 0);
const ids = catalog.data.lights.map(light => light.id);
assert.equal(new Set(ids).size, ids.length);
assert.deepEqual(catalog.data.allRooms.members.map(light => light.id), ids);
assert(catalog.data.groups.every(group => group.members.every(light => ids.includes(light.id))));
assert.equal((await call('/api/command', { type: 'power', on: false }, 'https://untrusted.example')).status, 403);
const link = await call('/api/link-code', {});
assert.equal(link.status, 200);
assert.match(link.data.code, /^\d{6}$/);
cookie = undefined;
const linked = await call('/api/session', { code: link.data.code });
assert.equal(linked.status, 200);
assert.match(linked.headers['set-cookie'][0], /=v2\./);
assert.match(linked.headers['set-cookie'][0], /Max-Age=34560000/);
assert.equal((await call('/api/session', { code: link.data.code })).status, 401);
cookie = linked.headers['set-cookie'][0].split(';')[0];
assert.equal((await call('/api/state')).status, 200);
console.log(`PASS: trusted local TLS, authentication, cross-origin rejection, ${ids.length}-bulb catalog, ALL ROOMS, and single-use device linking with a persistent session.`);
