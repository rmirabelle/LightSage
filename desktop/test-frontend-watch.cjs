const assert = require('node:assert/strict');
const { mkdtemp, mkdir, writeFile, rename, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const watchFrontend = require('./frontend-watch.cjs');

(async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'lightsage-watch-'));
  let close = () => {}, reloads = 0;
  const errors = [];
  try {
    const web = path.join(root, 'tools/matter-probe/web');
    await mkdir(web, { recursive: true });
    await mkdir(path.join(root, 'resource'));
    close = watchFrontend(root, () => reloads++, error => errors.push(error), 80);
    const settled = () => delay(250);
    await writeFile(path.join(web, 'style.css'), 'first');
    await writeFile(path.join(web, 'style.css'), 'second');
    await writeFile(path.join(web, 'app.js'), 'third');
    await settled();
    assert.equal(reloads, 1, 'A burst of frontend edits reloads once');
    await writeFile(path.join(root, 'tools/matter-probe/server.mjs'), 'backend');
    await writeFile(path.join(root, 'resource/logo.psd'), 'source artwork');
    await settled();
    assert.equal(reloads, 1, 'Backend and source artwork do not reload the UI');
    await writeFile(path.join(root, 'resource/logo.tmp'), 'new image');
    await rename(path.join(root, 'resource/logo.tmp'), path.join(root, 'resource/logo.png'));
    await settled();
    assert.equal(reloads, 2, 'Atomic replacement of the logo reloads');
    await writeFile(path.join(web, 'index.html'), 'pending');
    await delay(20);
    close();
    await settled();
    assert.equal(reloads, 2, 'Closing cancels a pending reload');
    await writeFile(path.join(web, 'style.css'), 'after close');
    await settled();
    assert.equal(reloads, 2, 'Closed watchers do not reload');
    assert.deepEqual(errors, []);
    console.log('PASS: frontend reload debounce, backend exclusion, logo replacement, and watcher cleanup.');
  } finally { close(); await rm(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
