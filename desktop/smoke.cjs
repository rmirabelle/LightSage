const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
module.exports = async ({ window, getWorker, app, controllerDir }) => {
  const timeout = setTimeout(() => { console.error('Desktop smoke test timed out'); app.exit(1); }, 45000);
  try {
    const read = () => window.webContents.executeJavaScript(`(async () => ({ desktop: !!window.lightSageDesktop, status: await window.lightSageDesktop.status(), api: await fetch('/api/state').then(r => r.status), node: typeof require }))()`);
    const first = await read();
    assert.equal(first.desktop, true);
    assert.equal(first.status.status, 'Running');
    assert.equal(first.api, 200);
    assert.equal(first.node, 'undefined');
    const management = await window.webContents.executeJavaScript(`(async () => {
      for (let n = 0; n < 50 && document.getElementById('management').hidden; n++) await new Promise(r => setTimeout(r, 100));
      const visible = !document.getElementById('management').hidden;
      const bulbs = document.getElementById('edit-bulb').options.length;
      const rooms = document.getElementById('pair-room').options.length;
      document.getElementById('bulb-form').requestSubmit();
      for (let n = 0; n < 50 && document.getElementById('manage-result').textContent !== 'Saved.'; n++) await new Promise(r => setTimeout(r, 100));
      return { visible, bulbs, rooms, result: document.getElementById('manage-result').textContent };
    })()`);
    assert.equal(management.visible, true);
    assert(management.bulbs >= 2); assert(management.rooms >= 2);
    assert.equal(management.result, 'Saved.');
    window.close();
    assert.equal(window.isDestroyed(), false);
    assert.equal(window.isVisible(), false);
    assert.equal((await read()).api, 200);
    const worker = getWorker();
    const reloaded = new Promise(resolve => window.webContents.once('did-finish-load', resolve));
    worker.kill();
    await reloaded;
    assert.notEqual(getWorker(), worker);
    assert.equal((await read()).api, 200);
    window.show();
    await new Promise(resolve => setTimeout(resolve, 1200));
    const screenshot = await window.webContents.capturePage();
    await fs.writeFile(path.join(controllerDir, '.state/desktop-preview.png'), screenshot.toPNG());
    await window.webContents.executeJavaScript(`document.querySelector('#management details').open = true; document.getElementById('management').scrollIntoView();`);
    await fs.writeFile(path.join(controllerDir, '.state/management-preview.png'), (await window.webContents.capturePage()).toPNG());
    await fs.writeFile(path.join(controllerDir, '.state/desktop-smoke.json'), JSON.stringify({ passed: true, checks: ['auto-login', 'renderer isolation', 'close to tray keeps controller alive', 'controller crash restarts and reconnects'], at: new Date().toISOString() }, null, 2));
    console.log('PASS: management form submit, desktop auto-login, renderer isolation, close-to-tray, and controller crash recovery.');
  } catch (error) {
    await fs.writeFile(path.join(controllerDir, '.state/desktop-smoke.json'), JSON.stringify({ passed: false, error: error.stack }));
    console.error(error); process.exitCode = 1;
  }
  finally { clearTimeout(timeout); app.quit(); }
};
