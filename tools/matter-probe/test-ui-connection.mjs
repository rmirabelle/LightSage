import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Execute the real API, pairing, and room render functions with a minimal DOM.
// This reproduces offline navigation without a controller or physical bulbs.
const source = await readFile(new URL('./web/app.js', import.meta.url), 'utf8');
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const elements = new Map(), locks = [], messages = [];
const stored = new Map();
function node() {
  return { options: [], dataset: {}, classList: { toggle() {}, remove() {} },
    setAttribute() {}, replaceChildren(...items) { this.options = items; }, querySelector: () => node() };
}
const room = id => ({ id, name: id, available: true, members: [], on: true });
const catalog = { lights: [], allRooms: room('all-rooms'), groups: [room('kitchen'), room('bedroom')] };
let context;
context = vm.createContext({
  connected: false, connectionPhase: 'starting', connectionVersion: 0, requestTimedOut: false, desktopServiceState: 'unknown', window: {}, navigator: { onLine: true },
  serviceInfo: null, document: { createElement: () => node() },
  selected: 'all-rooms', state: null, catalog, wheelDragging: false, colorSending: false, roomColorProposal: null, showingRoomLights:false,
  sceneUI: undefined, scheduleUI: undefined, gradientUI: undefined, gradientErrors: new Set(), viewModes: new Map(),
  Option: function(text, value) { return { text, value }; },
  $: id => { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); },
  renderManagement() {}, renderLights() {}, renderBulbControl() {}, controlsFor: value => value,
  distinctWheelColors: () => [], wheel: { draw() {}, drawPoints() {} }, fitWheels() {},
  message: (text, error = false) => messages.push({text, error}), showPairingAlert() {}, openPairedBulb() {},
  lock: () => locks.push(context.connected),
  loadingRequests: 0, showLoading() {}, AbortSignal, screenStack: [], closeScreen() {},
  localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) },
  fetch: async () => ({ ok: true, status: 200, json: async () => structuredClone(catalog) }),
  observedPairingId: undefined, pairedBulbToOpen: undefined, shownPairingErrors: new Set(),
  pairingActive: false, pairingLoading: false,
});
vm.runInContext([
  source.match(/function disconnect\(\) \{[^}]+\}/)[0],
  between('function connectionPending()', 'function blocked('),
  between('async function api(', 'function render(value)'),
  between('function render(value)', 'async function run('),
  between('function updatePairing(', 'async function manage('),
  between('function renderRoomView()', "$('add-device').onclick"),
].join('\n'), context);

context.render(catalog);
assert.equal(elements.get('room-panel').hidden,false);
elements.get('lights-button').onclick();
assert.equal(elements.get('room-panel').hidden,true);
assert.equal(elements.get('room-lights-panel').hidden,false,'Empty room still opens the inline list');
context.selected='kitchen'; context.render(catalog);
assert.equal(elements.get('room-lights-panel').hidden,false,'Room changes preserve list mode');
elements.get('lights-button').onclick();
assert.equal(elements.get('room-panel').hidden,false);
assert.equal(elements.get('room-lights-panel').hidden,true);
assert.equal(context.screenStack.length,0,'Lights toggle does not open a separate screen');
assert.deepEqual(messages.at(-1), {text:'', error:false}, 'Initial connection is silent');
assert.equal(locks.at(-1), false, 'Controls stay disabled while connecting');
assert.equal(context.unavailableLabel(), 'Connecting…');
await context.api('/api/state'); assert.equal(context.connected, true);
assert(stored.has('lightsage-last-catalog'));
context.render(catalog); assert.equal(locks.at(-1), true);
context.fetch = async () => { throw Error('Service stopped'); };
await assert.rejects(context.api('/api/state'), /Lighting service unreachable/);
context.fetch = async () => { throw new DOMException('Timed out', 'TimeoutError'); };
await assert.rejects(context.api('/api/scenes', {}), /did not answer in time/, 'A slow service is not reported as unreachable');
context.fetch = async () => { throw Error('Service stopped'); };
await assert.rejects(context.api('/api/state'), /Lighting service unreachable/);
locks.length = 0;
for (const selected of ['kitchen', 'bedroom', 'all-rooms']) {
  context.selected = selected;
  context.render(catalog);
  assert.equal(context.connected, false);
}
assert(locks.every(connected => !connected), 'Cached room changes never unlock controls');
assert.equal(messages.at(-1).error, true, 'A failed connection is an alert');
vm.runInContext(between('// Paint the last known rooms immediately', "if ('serviceWorker' in navigator"), context);
assert.equal(context.connected, false, 'Offline cold start restores rooms without connecting');
assert.equal(elements.get('offline-startup').hidden, true);
assert.equal(elements.get('light').hidden, false);
context.updatePairing({ state: 'idle' }); assert.equal(context.connected, false);
context.fetch = async () => ({ ok: true, status: 200, json: async () => ({ state: 'idle' }) });
await context.api('/api/pairing'); assert.equal(context.connected, false, 'Pairing heartbeat cannot enable stale room state');

let finish;
context.fetch = () => new Promise(resolve => { finish = resolve; });
const oldRequest = context.api('/api/state');
context.disconnect();
finish({ ok: true, status: 200, json: async () => catalog }); await oldRequest;
assert.equal(context.connected, false, 'Late response cannot reverse a newer disconnect');
context.fetch = async () => ({ ok: true, status: 200, json: async () => catalog });
await context.api('/api/state'); context.render(catalog);
assert.equal(context.connected, true); assert.equal(locks.at(-1), true);
context.window.lightSageDesktop = {}; context.desktopServiceState = 'stopped'; context.disconnect();
await context.api('/api/state'); context.render(catalog);
assert.equal(context.connected, false, 'Known stopped desktop service stays disabled');
context.desktopServiceState = 'running'; await context.api('/api/state');
assert.equal(context.connected, true);
context.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: 'Sign in' }) });
await assert.rejects(context.api('/api/state'), /Sign in/);
assert.equal(context.connected, false);
assert.equal(stored.has('lightsage-last-catalog'), false, 'Expired sessions clear saved room data');
delete context.window.lightSageDesktop;
context.navigator.onLine = false;
assert.equal(context.unavailableLabel(), 'No network connection');
let requests = 0;
context.fetch = async () => { requests++; return { ok: true, status: 200, json: async () => catalog }; };
await assert.rejects(context.api('/api/state'), /No network connection/);
assert.equal(requests, 0, 'Offline devices do not wait for failed requests');
context.poll = () => { requests++; };
vm.runInContext(between('function networkChanged()', "window.addEventListener('offline'"), context);
context.connected = true; context.networkChanged();
assert.equal(context.connected, false, 'Offline event disables controls immediately');
context.navigator.onLine = true; context.networkChanged();
assert.equal(context.unavailableLabel(), 'Reconnecting…');
assert.equal(messages.at(-1).error, false, 'Retry after network restoration is neutral');
assert.equal(messages.at(-1).text, '', 'Retry does not show connection chatter');
assert.equal(context.connected, false, 'Online event does not assume the service is reachable');
assert.equal(requests, 1, 'Online event triggers a retry');
await context.api('/api/state'); assert.equal(context.connected, true);
context.window.lightSageDesktop = {}; context.desktopServiceState = 'stopped';
assert.equal(context.unavailableLabel(), 'Lighting service stopped', 'Only desktop IPC confirms intentional stop');
context.window.location = { hostname: '10.0.0.250', port: '3443', protocol: 'https:' };
elements.get('login').hidden = true;
context.disconnect(); context.connection(); context.renderConnectionDialog();
assert.match(elements.get('connection-explanation').textContent, /service is stopped/);
assert.match(elements.get('connection-recovery').options[0].textContent, /click Start/);
assert.equal(elements.get('connection-uptime-row').hidden, true);
delete context.window.lightSageDesktop;
context.navigator.onLine = false;
context.renderConnectionDialog();
assert.match(elements.get('connection-explanation').textContent, /no network connection/);
context.navigator.onLine = true;
context.renderConnectionDialog();
assert.match(elements.get('connection-explanation').textContent, /cannot tell whether/);
context.connectionPhase = 'starting'; context.renderConnectionDialog();
assert.match(elements.get('connection-explanation').textContent, /No connection failure/);
assert.equal(elements.get('connection-recovery').options.length, 0);
context.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ...catalog, service: { address: '10.0.0.250', port: 3443, uptimeSeconds: 90061 } }) });
await context.api('/api/state'); context.connection(); context.renderConnectionDialog();
assert.equal(elements.get('connection-address').textContent, '10.0.0.250');
assert.equal(elements.get('connection-port').textContent, '3443');
assert.equal(elements.get('connection-uptime').textContent, '1d 1h 1m 1s');
assert.equal(elements.get('connection-uptime-row').hidden, false);
assert.equal(elements.get('connection-detail-status').dataset.state, 'running');
context.disconnect(); elements.get('login').hidden = false; context.renderConnectionDialog();
assert.match(elements.get('connection-explanation').textContent, /needs to sign in/);
assert.equal(elements.get('connection-uptime-row').hidden, true);
console.log('PASS: connection state, offline controls, and service dialog details and recovery guidance.');
