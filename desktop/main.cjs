const { app, BrowserWindow, Tray, nativeImage, ipcMain, session, shell } = require('electron');
const { fork } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs/promises');
const { appendFileSync } = require('node:fs');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const controllerDir = path.join(root, 'tools', 'matter-probe');
const origin = 'http://127.0.0.1:3442';
const logPath = path.join(controllerDir, '.state/desktop.log');
const log = data => appendFileSync(logPath, `${new Date().toISOString()} ${data}\n`);
process.on('uncaughtException', error => { log(error.stack); app.exit(1); });
process.on('unhandledRejection', error => log(error.stack ?? error));
let window, tray, worker, retryTimer, quitting = false, stopped = false;
let status = 'Starting…', failures = 0;
let serviceState = 'starting', serviceWanted = true, serviceActionPending = false;
let readyAt = null;
let tested = false;
let stopFrontendWatch = () => {};
const startupArgs = [root, '--hidden'];
const startup = () => app.getLoginItemSettings({ path: process.execPath, args: startupArgs }).openAtLogin;
app.setName('LightSage');
app.setAppUserModelId('local.lightsage.desktop');
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => show());
  app.whenReady().then(initialize).catch(error => { log(error.stack); app.exit(1); });
}
function show() { if (window) { window.show(); window.restore(); window.focus(); } }
function updateTrayTooltip() {
  tray.setToolTip(`LightSage lighting service — ${status}`);
}
function setStartup(enabled) {
  app.setLoginItemSettings({ name: 'local.lightsage.desktop', enabled, openAtLogin: enabled, path: process.execPath, args: startupArgs });
  const saved = startup();
  log(`Start with Windows: requested=${enabled}, registered=${saved}`);
  updateTrayTooltip();
  if (saved !== enabled) throw new Error('Windows did not save the startup setting. Please try again.');
  return saved;
}
async function authenticate() {
  const code = (await fs.readFile(path.join(controllerDir, '.state/access-code.txt'), 'utf8')).trim();
  const { sessionTokens, cookieLifetimeSeconds } = await import(pathToFileURL(path.join(controllerDir, 'sessions.mjs')).href);
  await session.defaultSession.cookies.set({ url: origin, name: 'lightsage-local', value: sessionTokens(code).issue(), httpOnly: true, sameSite: 'strict', path: '/', expirationDate: Date.now() / 1000 + cookieLifetimeSeconds });
}
function startController() {
  if (quitting || !serviceWanted || worker) return;
  clearTimeout(retryTimer); retryTimer = undefined;
  readyAt = null;
  serviceState = 'starting';
  status = 'Starting…'; updateTrayTooltip();
  worker = fork(path.join(controllerDir, 'server.mjs'), [], { execPath: path.join(__dirname, 'runtime', 'node.exe'), cwd: controllerDir, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
  const current = worker;
  current.stdout.on('data', data => log(data.toString()));
  current.stderr.on('data', data => log(data.toString()));
  current.on('error', error => { log(error.stack); status = 'Could not start'; serviceState = 'error'; updateTrayTooltip(); });
  current.on('message', async message => {
    if (message.type !== 'ready' || current !== worker || quitting || !serviceWanted || serviceState !== 'starting') return;
    status = 'Running'; serviceState = 'running'; readyAt = Date.now(); failures = 0; updateTrayTooltip();
    try {
      await authenticate();
      if (current !== worker || !serviceWanted || serviceState !== 'running' || quitting) return;
      await window.loadURL(origin);
      if (process.argv.includes('--smoke-test') && !tested) {
        tested = true;
        void require('./smoke.cjs')({ window, getWorker: () => worker, app, controllerDir });
      }
    }
    catch (error) { log(error.stack); }
  });
  // close also fires when spawning fails before a process can emit exit.
  current.on('close', () => {
    if (current !== worker) return;
    worker = undefined;
    readyAt = null;
    if (quitting) { stopped = true; app.quit(); return; }
    if (!serviceWanted) { status = 'Stopped'; serviceState = 'stopped'; updateTrayTooltip(); return; }
    status = 'Stopped — restarting…'; serviceState = 'restarting'; updateTrayTooltip();
    retryTimer = setTimeout(startController, Math.min(30000, 1000 * 2 ** Math.min(failures++, 5)));
  });
}
async function initialize() {
  const icon = nativeImage.createFromPath(path.join(root, 'resource', 'icon-pack', 'windows', 'icon.ico'));
  tray = new Tray(icon); tray.on('click', show); updateTrayTooltip();
  window = new BrowserWindow({ title: 'LightSage', width: 1120, height: 850, minWidth: 900, minHeight: 600, show: false, icon, backgroundColor: '#222612', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  window.removeMenu();
  if (!app.isPackaged) {
    stopFrontendWatch = require('./frontend-watch.cjs')(root, () => {
      if (quitting || !readyAt || window.isDestroyed() || !window.webContents.getURL().startsWith(origin)) return;
      log('Frontend changed — reloading desktop UI.');
      window.webContents.reloadIgnoringCache();
    }, error => log(`Frontend watcher: ${error.message}`));
  }
  window.on('close', event => { if (!quitting) { event.preventDefault(); window.hide(); } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== origin) event.preventDefault(); });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const trusted = event => { if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || new URL(event.senderFrame.url).origin !== origin) throw new Error('Untrusted caller'); };
  ipcMain.handle('desktop:status', event => { trusted(event); return { status, serviceState, startup: startup(), readyAt, pid: worker?.pid ?? null, logPath }; });
  ipcMain.handle('desktop:show-log', event => { trusted(event); shell.showItemInFolder(logPath); });
  ipcMain.handle('desktop:startup', (event, enabled) => { trusted(event); if (typeof enabled !== 'boolean') throw new Error('Expected boolean'); return setStartup(enabled); });
  ipcMain.handle('desktop:logs', async event => {
    trusted(event);
    let file;
    try {
      file = await fs.open(logPath, 'r');
      const { size } = await file.stat();
      const length = Math.min(size, 48 * 1024), buffer = Buffer.alloc(length);
      const { bytesRead } = await file.read(buffer, 0, length, size - length);
      let text = buffer.subarray(0, bytesRead).toString('utf8');
      if (size > length) text = text.slice(text.indexOf('\n') + 1);
      return text.replace(/\u001b\[[0-9;]*m/g, '').split('\n').slice(-180).join('\n');
    } catch (error) { if (error.code === 'ENOENT') return 'No controller activity yet.'; throw error; }
    finally { await file?.close(); }
  });
  const changeService = async (event, action) => {
    trusted(event);
    if (serviceActionPending) throw new Error('A service action is already in progress.');
    if (action === 'start') {
      if (worker) return;
      serviceWanted = true; failures = 0; clearTimeout(retryTimer); startController(); return;
    }
    if (serviceState === 'stopping' || (serviceState === 'restarting' && worker)) throw new Error('Wait for the current service action to finish.');
    serviceActionPending = true;
    try {
    const response = await fetch(`${origin}/api/pairing`, { headers: { Cookie: (await session.defaultSession.cookies.get({url:origin})).map(cookie => `${cookie.name}=${cookie.value}`).join('; ') }, signal: AbortSignal.timeout(2000) }).catch(() => null);
    if (response?.ok) {
      const job = await response.json();
      if (job.state === 'pairing' || job.recovering) throw new Error('Wait for pairing to finish before stopping or restarting the service.');
    }
    serviceWanted = action === 'restart';
    clearTimeout(retryTimer); retryTimer = undefined;
    if (!worker) {
      if (serviceWanted) startController();
      else { status = 'Stopped'; serviceState = 'stopped'; readyAt = null; updateTrayTooltip(); }
      return;
    }
    const current = worker;
    status = serviceWanted ? 'Restarting…' : 'Stopping…';
    serviceState = serviceWanted ? 'restarting' : 'stopping'; readyAt = null; updateTrayTooltip();
    if (current.connected) current.send({type:'shutdown'}, error => { if (error && worker === current) current.kill(); });
    else current.kill();
    setTimeout(() => { if (worker === current) current.kill(); }, 8000).unref();
    } finally { serviceActionPending = false; }
  };
  for (const action of ['start', 'stop', 'restart']) ipcMain.handle(`desktop:${action}`, event => changeService(event, action));
  await window.loadFile(path.join(__dirname, 'starting.html'));
  if (!process.argv.includes('--hidden')) show();
  startController();
}
app.on('window-all-closed', () => {});
app.on('before-quit', event => {
  stopFrontendWatch();
  quitting = true; clearTimeout(retryTimer);
  if (!worker || stopped) return;
  event.preventDefault();
  if (worker.connected) worker.send({ type: 'shutdown' });
  setTimeout(() => { worker?.kill(); }, 8000).unref();
});
