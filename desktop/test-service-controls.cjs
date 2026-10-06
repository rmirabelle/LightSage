const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

(async () => {
  const handlers = new Map(), children = [], timers = new Map(), revealed = [];
  let window, pairing = false, fetchGate, startupEnabled = false, rejectStartupWrite = false;
  let automaticWorker = false, failNextWorker = false, cancelDialog = false, recoveryCommits = 0, recoveryRollbacks = 0;
  const recovery = { recoverPendingRestore() {}, validateBackup: async () => ({counts:{lights:21,rooms:5,scenes:11}}), prepareRestore: async () => ({counts:{lights:21,rooms:5,scenes:11},previous:'rollback-copy',commit:async()=>{recoveryCommits++;},rollback:()=>{recoveryRollbacks++;}}) };
  let quitCalls = 0;
  const app = new EventEmitter();
  Object.assign(app, { setName() {}, setAppUserModelId() {}, requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(), getLoginItemSettings: () => ({ openAtLogin: startupEnabled }),
    setLoginItemSettings: value => { if (!rejectStartupWrite) startupEnabled = value.openAtLogin; },
    quit() { quitCalls++; }, isPackaged: true, getPath: () => __dirname, getVersion: () => '0.1.5' });
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
  const electron = { dialog: { showOpenDialog: async () => ({canceled:cancelDialog,filePaths:['selected-backup']}), showMessageBox: async () => ({response:1}) }, app, BrowserWindow: Window, shell: { showItemInFolder: file => revealed.push(file) },
    Tray: class extends EventEmitter { setToolTip() {} setContextMenu() {} },
    Menu: { buildFromTemplate: value => value }, nativeImage: { createFromPath() {} },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    session: { defaultSession: { setPermissionRequestHandler() {}, cookies: { set: async () => {}, get: async () => [] } } } };
  function fork() {
    const child = new EventEmitter(); child.pid = 100 + children.length; child.connected = true;
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.sent = [];
    child.send = (message, callback) => { child.sent.push(message); callback?.(); if (automaticWorker && message.type === 'shutdown') setImmediate(() => child.emit('close')); };
    child.kill = () => { child.killed = true; child.emit('close'); };
    children.push(child);
    if (automaticWorker) setImmediate(() => { if (failNextWorker) { failNextWorker=false; child.emit('close'); } else child.emit('message',{type:'ready'}); });
    return child;
  }
  const context = vm.createContext({
    require: name => name === './message-dialog.cjs' ? electron.dialog.showMessageBox : name === './restore-state.cjs' ? recovery : name === './backup-state.cjs' ? {backupState:async()=>({backup:'verified-backup',counts:{lights:21,rooms:5,scenes:11}})} : name === 'electron' ? electron : name === 'node:child_process' ? { fork } :
      name === 'node:fs' ? { appendFileSync() {}, mkdirSync() {} } : name === 'node:fs/promises' ? { readFile: async () => 'test-access-code' } : require(name),
    __dirname, process: { on() {}, argv: [], resourcesPath: path.resolve(__dirname, '..'), env: {}, execPath: '', exit() {} }, console,
    fetch: async () => { if (fetchGate) await fetchGate; return { ok: true, json: async () => ({ state: pairing ? 'pairing' : 'idle' }) }; },
    AbortSignal, Buffer, URL,
    setTimeout: (fn, ms) => { const token = { unref() {} }; timers.set(token, { fn, ms }); return token; },
    clearTimeout: token => timers.delete(token),
    setInterval: () => ({ unref() {} }),
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
  const expectedLogPath = path.resolve(__dirname, 'controller/desktop.log');
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
  await assert.rejects(handlers.get('desktop:restore')({sender:{}}), /Untrusted/);
  cancelDialog=true; assert.equal((await call('restore')).canceled,true); cancelDialog=false;
  automaticWorker=true;
  await call('restore'); assert.equal(recoveryCommits,1); assert.equal(call('status').serviceState,'running');
  pairing=true; await assert.rejects(call('restore'),/pairing/); pairing=false;
  await call('backup'); assert.equal(recoveryCommits,1);
  await new Promise(resolve=>setImmediate(resolve));
  failNextWorker=true; await assert.rejects(call('restore'),/could not start/);
  assert.equal(recoveryRollbacks,1); assert.equal(recoveryCommits,1);
  await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(handlers.get('desktop:quit')({sender:{}}), /Untrusted/);
  await assert.rejects(handlers.get('desktop:update')({sender:{}}), /Untrusted/);
  assert.equal(quitCalls,0);
  pairing=true; await assert.rejects(call('quit'),/pairing/); pairing=false;
  automaticWorker=false;
  const lastWorker=children.at(-1);
  const pendingQuit=call('quit');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(lastWorker.sent.at(-1).type,'shutdown');
  assert.equal(quitCalls,0,'Exit waits for controller shutdown');
  await assert.rejects(call('restore'),/current service action/);
  lastWorker.emit('close'); await pendingQuit;
  assert.equal(quitCalls,1); assert.equal(lastWorker.killed,undefined,'Exit does not force-kill the controller');
  await call('quit'); assert.equal(quitCalls,2,'Exit also works with service stopped');
  window.webContents.mainFrame.url=require('node:url').pathToFileURL(path.join(__dirname,'starting.html')).href;
  await call('quit'); assert.equal(quitCalls,3,'Exit works from startup recovery screen');
  console.log('PASS: exit authorization, pairing guard, graceful shutdown, operation exclusion, stopped service, and startup screen.');
  console.log('PASS: recovery authorization, cancellation, pairing guard, backup stop/restart, restore startup, and rollback after failed startup.');
  console.log('PASS: service status, trusted controls, pairing guard, graceful stop, explicit start, restart, crash recovery, late readiness, and concurrent actions.');
})().catch(error => { console.error(error); process.exitCode = 1; });
