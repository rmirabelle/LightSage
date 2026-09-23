import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const listeners = new Map(), cached = new Map(), deleted = [];
let networkCalls = 0, installed = false, claimed = false, failInstall = false;
const cache = {
  addAll: async files => {
    if (failInstall) throw Error('Offline during installation');
    for (const file of files) cached.set(file, { file, cached: true });
  },
  match: async file => cached.get(file),
};
const context = vm.createContext({
  URL, location: { origin: 'https://10.0.0.250:3443' },
  self: { LIGHTSAGE_BUILD: 'test', addEventListener: (name, handler) => listeners.set(name, handler),
    skipWaiting: async () => { installed = true; }, clients: { claim: async () => { claimed = true; } } },
  caches: { open: async () => cache, keys: async () => ['lightsage-shell-v9', 'lightsage-shell-v10-test', 'unrelated-cache'],
    delete: async key => deleted.push(key) },
  fetch: () => { networkCalls++; return new Promise(() => {}); },
});
vm.runInContext(await readFile(new URL('./web/sw.js', import.meta.url), 'utf8'), context);
async function lifecycle(name) {
  let work; listeners.get(name)({ waitUntil: value => { work = value; } }); await work;
}
await lifecycle('install'); assert(installed);
await lifecycle('activate'); assert(claimed);
assert.deepEqual(deleted, ['lightsage-shell-v9']);
async function request(path, method = 'GET', origin = 'https://10.0.0.250:3443') {
  let response;
  listeners.get('fetch')({ request: { method, url: origin + path }, respondWith: value => { response = value; } });
  if (!response) return null;
  let timer;
  try { return await Promise.race([response, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Offline shell waited for network')), 100); })]); }
  finally { clearTimeout(timer); }
}
for (const asset of ['/', '/app.js', '/style.css', '/scene-controls.js', '/music-controls.js']) {
  assert.equal((await request(asset)).cached, true);
}
assert.equal((await request('/?homescreen=1')).file, '/');
assert.equal((await request('/logo.png?v=different')).file, '/logo.png?v=transparent-1');
assert.equal(networkCalls, 0, 'Warm offline launch never waits on the network');
async function readiness() {
  let work, result;
  listeners.get('message')({ data: { type: 'offline-status' }, ports: [{ postMessage: value => { result = value; } }], waitUntil: value => { work = value; } });
  await work; return result;
}
assert.equal((await readiness()).complete, true);
const cachedScript = cached.get('/app.js'); cached.delete('/app.js');
assert.equal((await readiness()).complete, false, 'Readiness must check the actual saved files');
cached.set('/app.js', cachedScript);
assert.equal(await request('/api/state'), null, 'API results are never served from shell cache');
assert.equal(await request('/api/command', 'POST'), null);
assert.equal(await request('/', 'GET', 'http://127.0.0.1:3442'), null, 'Desktop hot reload bypasses the shell cache');
installed = false; failInstall = true;
await assert.rejects(lifecycle('install'), /Offline during installation/);
assert.equal(installed, false, 'Incomplete shell must not take over');
console.log('PASS: instant offline shell, canonical URL matching, API exclusion, desktop reload bypass, complete installation, and scoped cache cleanup.');
