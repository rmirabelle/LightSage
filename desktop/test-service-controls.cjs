const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

(async () => {
  const handlers = new Map(), children = [], timers = new Map(), revealed = [];
  let window, pairing = false, fetchGate, startupEnabled = false, rejectStartupWrite = false;
  const app = new EventEmitter();
  Object.assign(app, { setName() {}, setAppUserModelId() {}, requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(), getLoginItemSettings: () => ({ openAtLogin: startupEnabled }),
    setLoginItemSettings: value => { if (!rejectStartupWrite) startupEnabled = value.openAtLogin; },
    quit() {}, isPackaged: true });
  class Window extends EventEmitter {
    constructor() {
      super(); window = this; this.url = ''; this.loads = 0;
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, { mainFrame: {}, setWindowOpenHandler() {}, getURL: () => this.url });
    }
    removeMenu() {} show() {} restore() {} focus() {}
    async loadFile() {}
    async loadURL(url) { this.url = url; this.webContents.mainFrame.url = url; this.loads++; }
  }
  const electron = { app, BrowserWindow: Window, shell: { showItemInFolder: file => revealed.push(file) },
    Tray: class extends EventEmitter { setToolTip() {} setContextMenu() {} },
    Menu: { buildFromTemplate: value => value }, nativeImage: { createFromPath() {} },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    session: { defaultSession: { setPermissionRequestHandler() {}, cookies: { set: async () => {}, get: async () => [] } } } };
  function fork() {
    const child = new EventEmitter(); child.pid = 100 + children.length; child.connected = true;
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.sent = [];
    child.send = (message, callback) => { child.sent.push(message); callback?.(); };
    child.kill = () => { child.killed = true; child.emit('close'); };
    children.push(child); return child;
  }
  const context = vm.createContext({
    require: name => name === 'electron' ? electron : name === 'node:child_process' ? { fork } :
      name === 'node:fs' ? { appendFileSync() {} } : name === 'node:fs/promises' ? { readFile: async () => 'test-access-code' } : require(name),
    __dirname, process: { on() {}, argv: [], execPath: '', exit() {} }, console,
    fetch: async () => { if (fetchGate) await fetchGate; return { ok: true, json: async () => ({ state: pairing ? 'pairing' : 'idle' }) }; },
    AbortSignal, Buffer, URL,
    setTimeout: (fn, ms) => { const token = { unref() {} }; timers.set(token, { fn, ms }); return token; },
    clearTimeout: token => timers.delete(token),
  });
  new vm.Script(readFileSync(path.join(__dirname, 'main.cjs'), 'utf8'), {
    filename: path.join(__dirname, 'main.cjs'), importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
  }).runInContext(context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(children.length, 1);
  const event = () => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
  const call = action => handlers.get('desktop:' + action)(event());
  const ready = async child => { for (const listener of child.listeners('message')) await listener({ type: 'ready' }); };
  await ready(children[0]);
  assert.equal(call('status').serviceState, 'running');
  assert.equal(window.loads, 1);
  assert.equal(handlers.get('desktop:startup')(event(), true), true);
  assert.equal(call('status').startup, true);
  rejectStartupWrite = true;
  assert.throws(() => handlers.get('desktop:startup')(event(), false), /Windows did not save/);
  rejectStartupWrite = false;
  assert.throws(() => handlers.get('desktop:startup')(event(), 'true'), /Expected boolean/);
  const expectedLogPath = path.resolve(__dirname, '../tools/matter-probe/.state/desktop.log');
  assert.equal(call('status').logPath, expectedLogPath);
  call('show-log'); assert.deepEqual(revealed, [expectedLogPath]);
  assert.throws(() => handlers.get('desktop:show-log')({ sender: {} }), /Untrusted/);
  assert.equal(revealed.length, 1, 'Untrusted callers cannot open Explorer');
  await assert.rejects(handlers.get('desktop:stop')({ sender: {} }), /Untrusted/);
  pairing = true;
  await assert.rejects(call('stop'), /pairing/);
  assert.equal(children[0].sent.length, 0);
  pairing = false;
  await call('stop');
  assert.equal(call('status').serviceState, 'stopping');
  assert.equal(children[0].sent[0].type, 'shutdown');
  const loadCount = window.loads;
  await ready(children[0]); assert.equal(window.loads, loadCount, 'Late ready must not reload while stopping');
  children[0].emit('close');
  assert.equal(call('status').serviceState, 'stopped');
  assert.equal(call('status').pid, null); assert.equal(call('status').readyAt, null);
  for (const [token, timer] of [...timers]) { timers.delete(token); timer.fn(); }
  assert.equal(children.length, 1, 'Intentional stop does not restart');
  await call('start'); await call('start');
  assert.equal(children.length, 2, 'Start is idempotent');
  await ready(children[1]); assert.equal(call('status').serviceState, 'running');
  await call('restart'); children[1].emit('close');
  const restartTimer = [...timers].find(([, timer]) => timer.ms === 1000);
  assert(restartTimer); timers.delete(restartTimer[0]); restartTimer[1].fn();
  assert.equal(children.length, 3);
  await ready(children[2]);
  children[2].emit('close');
  assert.equal(call('status').serviceState, 'restarting', 'Unexpected exit still retries');
  await call('stop');
  for (const [token, timer] of [...timers]) { timers.delete(token); timer.fn(); }
  assert.equal(children.length, 3, 'Stop cancels a pending crash retry');
  await call('start'); await ready(children[3]);
  let release; fetchGate = new Promise(resolve => { release = resolve; });
  const pendingStop = call('stop');
  await assert.rejects(call('restart'), /already in progress/);
  release(); await pendingStop;
  children[3].emit('close');
  assert.equal(call('status').serviceState, 'stopped');
  console.log('PASS: service status, trusted controls, pairing guard, graceful stop, explicit start, restart, crash recovery, late readiness, and concurrent actions.');
})().catch(error => { console.error(error); process.exitCode = 1; });
