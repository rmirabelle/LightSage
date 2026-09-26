const { app, BrowserWindow, Tray, nativeImage, ipcMain, session, shell, dialog } = require('electron');
const showAppMessage = require('./message-dialog.cjs');
const { fork } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs/promises');
const { appendFileSync, mkdirSync } = require('node:fs');
const { pathToFileURL } = require('node:url');
const root = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '..');
const controllerDir = path.join(root, 'tools', 'matter-probe');
const origin = 'http://127.0.0.1:3442';
const development = !app.isPackaged && process.env.LIGHTSAGE_DEV === '1';
const stateDir = app.isPackaged ? path.join(app.getPath('userData'), 'controller') : (process.env.LIGHTSAGE_STATE_DIR || path.join(controllerDir, '.state'));
if (development) app.setPath('userData', path.join(app.getPath('appData'), 'LightSage-dev'));
const logPath = path.join(stateDir, 'desktop.log');
const log = data => { try { appendFileSync(logPath, `${new Date().toISOString()} ${data}\n`); } catch { console.error(data); } };
process.on('uncaughtException', error => { log(error.stack); app.exit(1); });
process.on('unhandledRejection', error => log(error.stack ?? error));
let window, tray, worker, retryTimer, quitting = false, stopped = false;
let status = 'Starting…', failures = 0;
let serviceState = 'starting', serviceWanted = true, serviceActionPending = false;
let readyAt = null, setupUrl = null, phoneUrl = null;
let tested = false, maintenance = false;
let stopFrontendWatch = () => {};
const startupArgs = app.isPackaged ? ['--hidden'] : [root, '--hidden'];
const startup = () => app.getLoginItemSettings({ path: process.execPath, args: startupArgs }).openAtLogin;
app.setName('LightSage');
app.setAppUserModelId('local.lightsage.desktop');
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => show());
  app.whenReady().then(initialize).catch(error => { log(error.stack); dialog.showErrorBox('LightSage could not start', error.message); app.exit(1); });
}
function show() { if (window) { window.show(); window.restore(); window.focus(); } }
function updateTrayTooltip() {
  tray.setToolTip(`LightSage${development ? ' DEVELOPMENT' : ''} lighting service — ${status}`);
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
  const code = (await fs.readFile(path.join(stateDir, 'access-code.txt'), 'utf8')).trim();
  const { sessionTokens, cookieLifetimeSeconds } = await import(pathToFileURL(path.join(controllerDir, 'sessions.mjs')).href);
  await session.defaultSession.cookies.set({ url: origin, name: 'lightsage-local', value: sessionTokens(code).issue(), httpOnly: true, sameSite: 'strict', path: '/', expirationDate: Date.now() / 1000 + cookieLifetimeSeconds });
}
function startController() {
  if (quitting || !serviceWanted || worker) return;
  clearTimeout(retryTimer); retryTimer = undefined;
  readyAt = null;
  serviceState = 'starting';
  status = 'Starting…'; updateTrayTooltip();
  worker = fork(path.join(controllerDir, 'server.mjs'), [], { execPath: !app.isPackaged && process.env.LIGHTSAGE_NODE_EXECUTABLE || path.join(root, 'desktop', 'runtime', 'node.exe'), cwd: controllerDir, env: { ...process.env, LIGHTSAGE_STATE_DIR: stateDir, ...(app.isPackaged ? { LIGHTSAGE_BLE_PYTHON: path.join(root, 'desktop', 'runtime', 'python', 'python.exe') } : {}) }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
  const current = worker;
  current.stdout.on('data', data => log(data.toString()));
  current.stderr.on('data', data => log(data.toString()));
  current.on('error', error => { log(error.stack); status = 'Could not start'; serviceState = 'error'; updateTrayTooltip(); });
  current.on('message', async message => {
    if (message.type === 'phone-url' && current === worker) { setupUrl = message.setupUrl; phoneUrl = message.phoneUrl; return; }
    if (message.type !== 'ready' || current !== worker || quitting || !serviceWanted || serviceState !== 'starting') return;
    setupUrl = message.setupUrl; phoneUrl = message.phoneUrl;
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
    if (!serviceWanted || maintenance) { status = 'Stopped'; serviceState = 'stopped'; updateTrayTooltip(); return; }
    status = 'Stopped — restarting…'; serviceState = 'restarting'; updateTrayTooltip();
    retryTimer = setTimeout(startController, Math.min(30000, 1000 * 2 ** Math.min(failures++, 5)));
  });
}
async function initialize() {
  require('./restore-state.cjs').recoverPendingRestore(stateDir);
  mkdirSync(stateDir, { recursive: true });
  const icon = nativeImage.createFromPath(path.join(root, 'resource', 'icon-pack', 'windows', 'icon.ico'));
  tray = new Tray(icon); tray.on('click', show); updateTrayTooltip();
  window = new BrowserWindow({ title: 'LightSage', width: 1120, height: 850, minWidth: 900, minHeight: 600, show: false, icon, backgroundColor: '#222612', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  window.removeMenu();
  if (development) window.on('page-title-updated', event => { event.preventDefault(); window.setTitle('LightSage — DEVELOPMENT'); });
  if (!app.isPackaged) {
    stopFrontendWatch = require('./frontend-watch.cjs')(root, () => {
      if (maintenance || quitting || !readyAt || window.isDestroyed() || !window.webContents.getURL().startsWith(origin)) return;
      log('Frontend changed — reloading desktop UI.');
      window.webContents.reloadIgnoringCache();
    }, error => log(`Frontend watcher: ${error.message}`));
  }
  window.on('close', event => { if (!quitting) { event.preventDefault(); window.hide(); } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== origin) event.preventDefault(); });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const trusted = event => { if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || new URL(event.senderFrame.url).origin !== origin) throw new Error('Untrusted caller'); };
  ipcMain.handle('desktop:status', event => { trusted(event); return { status, serviceState, startup: startup(), readyAt, pid: worker?.pid ?? null, logPath, setupUrl, phoneUrl, development }; });
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
    if (maintenance || serviceActionPending) throw new Error('A service action is already in progress.');
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

  const recoveryTrusted = event => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw Error('Untrusted caller');
    const url = event.senderFrame.url;
    if (url !== pathToFileURL(path.join(__dirname, 'starting.html')).href && new URL(url).origin !== origin) throw Error('Untrusted caller');
  };
  async function stopForMaintenance() {
    serviceWanted = false; clearTimeout(retryTimer); retryTimer = undefined;
    if (!worker) return;
    const current = worker;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(Error('The controller did not stop safely. Wait for it to finish before trying again.')); }, 30000);
      const closed = () => { cleanup(); resolve(); };
      const cleanup = () => { clearTimeout(timer); current.removeListener('close', closed); };
      current.once('close', closed);
      if (!current.connected) { cleanup(); reject(Error('The controller cannot shut down safely. Wait for it to exit.')); return; }
      current.send({ type: 'shutdown' }, error => { if (error) { cleanup(); reject(error); } });
    });
  }
  ipcMain.handle('desktop:quit', async event => {
    recoveryTrusted(event);
    if (maintenance || serviceActionPending) throw Error('Wait for the current service action to finish.');
    serviceActionPending = true;
    try {
      if (worker && serviceState === 'running') {
        const response = await fetch(origin + '/api/pairing', { headers: { Cookie: (await session.defaultSession.cookies.get({url:origin})).map(cookie => cookie.name + '=' + cookie.value).join('; ') }, signal: AbortSignal.timeout(2000) });
        if (!response.ok) throw Error('Could not check pairing status. Stop the service before exiting.');
        const job = await response.json();
        if (job.state === 'pairing' || job.recovering) throw Error('Wait for pairing to finish before exiting.');
      }
      await stopForMaintenance();
      app.quit();
    } finally { serviceActionPending = false; }
  });
  async function startAndWait() {
    serviceWanted = true; failures = 0; startController();
    const current = worker;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(Error('The restored controller did not become ready.')); }, 30000);
      const cleanup = () => { clearTimeout(timer); current.removeListener('message', message); current.removeListener('close', closed); };
      const message = value => { if (value.type === 'ready') { cleanup(); resolve(); } };
      const closed = () => { cleanup(); reject(Error('The restored controller could not start.')); };
      current.on('message', message); current.once('close', closed);
    });
  }
  for (const action of ['backup', 'restore']) ipcMain.handle('desktop:' + action, async event => {
    recoveryTrusted(event);
    if (maintenance || serviceActionPending || serviceState === 'stopping' || (serviceState === 'restarting' && worker)) throw Error('Wait for the current service action to finish.');
    maintenance = true;
    clearTimeout(retryTimer); retryTimer = undefined;
    const wasRunning = serviceWanted;
    let transaction, leaveStopped = false;
    try {
      const selected = await dialog.showOpenDialog(window, { title: action === 'backup' ? 'Choose where to save your backup' : 'Choose a LightSage backup folder (containing manifest.json)', properties: ['openDirectory', ...(action === 'backup' ? ['createDirectory'] : [])] });
      if (selected.canceled) return { canceled: true };
      const folder = selected.filePaths[0];
      let verified;
      if (action === 'restore') verified = await require('./restore-state.cjs').validateBackup(folder);
      const detail = action === 'restore'
        ? 'Restore ' + verified.counts.lights + ' lights, ' + verified.counts.rooms + ' rooms and ' + verified.counts.scenes + ' scenes? The current setup will be preserved. Close other LightSage installations before continuing. Use your latest backup; this cannot undo a factory reset or unpairing performed on a light.'
        : 'The controller will stop briefly to save and verify the complete setup, including pairing credentials. Keep the backup private.';
      const answer = await showAppMessage(window, { type: 'question', title: action === 'backup' ? 'Back up setup' : 'Restore setup', message: detail, buttons: ['Cancel', action === 'backup' ? 'Back up' : 'Restore'], defaultId: 0, cancelId: 0 });
      if (answer.response !== 1) return { canceled: true };
      if (worker && serviceState === 'running') {
        const response = await fetch(origin + '/api/pairing', { headers: { Cookie: (await session.defaultSession.cookies.get({url:origin})).map(cookie => cookie.name + '=' + cookie.value).join('; ') }, signal: AbortSignal.timeout(2000) });
        if (!response.ok) throw Error('Could not check pairing status. Stop the service before continuing.');
        const job = await response.json();
        if (job.state === 'pairing' || job.recovering) throw Error('Wait for pairing to finish.');
      }
      await stopForMaintenance();
      if (action === 'backup') {
        const result = await require('./backup-state.cjs').backupState(stateDir, folder);
        shell.showItemInFolder(path.join(result.backup, 'manifest.json'));
        await showAppMessage(window, { type: 'info', message: 'Setup backup verified', detail: result.counts.lights + ' lights, ' + result.counts.rooms + ' rooms, ' + result.counts.scenes + ' scenes.\n' + result.backup });
        return result;
      }
      transaction = await require('./restore-state.cjs').prepareRestore(folder, stateDir);
      await startAndWait();
      await transaction.commit();
      const result = { counts: transaction.counts, previous: transaction.previous };
      transaction = undefined;
      await showAppMessage(window, { type: 'info', message: 'Setup restored', detail: 'The controller is running. Your previous setup is preserved at:\n' + result.previous });
      return result;
    } catch (error) {
      if (transaction) {
        try { await stopForMaintenance(); transaction.rollback(); }
        catch (rollbackError) { leaveStopped = true; serviceWanted = false; throw Error(error.message + ' Recovery is pending; close and reopen LightSage. ' + rollbackError.message); }
      }
      throw error;
    } finally {
      maintenance = false;
      if (!leaveStopped && wasRunning && !worker) { serviceWanted = true; startController(); }
    }
  });
  await window.loadFile(path.join(__dirname, 'starting.html'));
  if (!process.argv.includes('--hidden')) show();
  startController();
}
app.on('window-all-closed', () => {});
app.on('before-quit', event => {
  if (maintenance) { event.preventDefault(); return; }
  stopFrontendWatch();
  quitting = true; clearTimeout(retryTimer);
  if (!worker || stopped) return;
  event.preventDefault();
  if (worker.connected) worker.send({ type: 'shutdown' });
  setTimeout(() => { worker?.kill(); }, 8000).unref();
});
