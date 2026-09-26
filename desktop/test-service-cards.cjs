// Run with electron desktop/test-service-cards.cjs. Uses an empty controller on
// separate ports, never the installed controller or real lights.
const { app, BrowserWindow, ipcMain, session } = require('electron');
const { fork } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const previewProfile = require('node:fs').mkdtempSync(path.join(root, 'tools/matter-probe/.state/service-preview-profile-'));
app.setPath('userData', previewProfile);
let worker, window;
app.whenReady().then(async () => {
  const state = await fs.mkdtemp(path.join(root, 'tools/matter-probe/.state/service-cards-'));
  try {
    worker = fork(path.join(root, 'tools/matter-probe/server.mjs'), [], {
      execPath: path.join(__dirname, 'installer-runtime/node.exe'), windowsHide: true,
      env: { ...process.env, LIGHTSAGE_STATE_DIR: state, LIGHTSAGE_HTTP_PORT: '3542', LIGHTSAGE_HTTPS_PORT: '3543', LIGHTSAGE_SETUP_PORT: '3544' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Controller startup timed out')), 30000);
      worker.on('message', value => { if (value.type === 'ready') { clearTimeout(timer); resolve(value); } });
      worker.once('exit', code => { clearTimeout(timer); reject(Error(`Controller exited ${code}`)); });
    });
    const origin = 'http://127.0.0.1:3542';
    assert.equal((await fetch(origin + '/api/phone-qr.svg')).status, 401);
    const code = (await fs.readFile(path.join(state, 'access-code.txt'), 'utf8')).trim();
    const auth = await fetch(origin + '/api/session', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    const cookie = auth.headers.get('set-cookie').split(';')[0];
    await session.defaultSession.cookies.set({ url: origin, name: 'lightsage-local', value: cookie.slice(cookie.indexOf('=') + 1), httpOnly: true });
    const qr = await fetch(origin + '/api/phone-qr.svg', { headers: { Cookie: cookie } });
    assert.equal(qr.status, 200); assert.match(qr.headers.get('content-type'), /image\/svg/);
    const QRCode = require('../tools/matter-probe/node_modules/qrcode');
    assert.equal(await qr.text(), await QRCode.toString(ready.phoneUrl, { type: 'svg', width: 256, margin: 4, errorCorrectionLevel: 'M' }));
    let status = { status: 'Running', serviceState: 'running', pid: worker.pid, readyAt: Date.now() - 7500000, ...ready };
    ipcMain.handle('desktop:status', () => status);
    ipcMain.handle('desktop:logs', () => '');
    window = new BrowserWindow({ width: 1100, height: 1000, show: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false } });
    await window.loadURL(origin);
    const evaluate = script => window.webContents.executeJavaScript(script);
    for (let i = 0; i < 50; i++) {
      if (await evaluate(`document.getElementById('controller-phone-qr').naturalWidth > 0`)) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const details = await evaluate(`({labels:[...document.querySelectorAll('.service-card dt')].map(x=>x.textContent),url:document.getElementById('controller-url').textContent,qr:document.getElementById('controller-phone-qr').naturalWidth,error:document.getElementById('controller-error').textContent})`);
    assert.deepEqual(details.labels, ['Status', 'Process', 'Uptime', 'URL']);
    assert.equal(details.url, ready.phoneUrl); assert(details.qr > 0); assert.equal(details.error, '');
    await fs.writeFile(path.join(root, 'tools/matter-probe/.state/service-cards-wide.png'), (await window.webContents.capturePage()).toPNG());
    window.setSize(760, 1000);
    await new Promise(resolve => setTimeout(resolve, 200));
    assert(await evaluate(`(()=>{const p=document.getElementById('controller-service-panel');return p.scrollWidth<=p.clientWidth})()`), 'Cards must fit a narrow controller panel');
    await fs.writeFile(path.join(root, 'tools/matter-probe/.state/service-cards-narrow.png'), (await window.webContents.capturePage()).toPNG());
    status = { ...status, status: 'Stopped', serviceState: 'stopped', pid: null, readyAt: null };
    await new Promise(resolve => setTimeout(resolve, 3200));
    assert(await evaluate(`document.getElementById('controller-phone-connect').hidden`));
    assert.equal(await evaluate(`document.getElementById('controller-process').textContent`), '—');
    assert.equal(await evaluate(`document.getElementById('controller-uptime').textContent`), '—');
    console.log('PASS: QR authentication and exact app URL, rendered cards, narrow layout, stopped-service state.');
  } finally {
    window?.destroy();
    if (worker?.connected) {
      const done = new Promise(resolve => worker.once('exit', resolve));
      worker.send({ type: 'shutdown' }); await done;
    }
    await fs.rm(state, { recursive: true, force: true });
  }
}).then(() => app.exit(0), error => { console.error(error); app.exit(1); });
