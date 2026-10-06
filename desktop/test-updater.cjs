// Checks the GitHub update logic with fake responses; never contacts GitHub.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { isNewer, checkForUpdate, downloadInstaller, installerCommand, latestUrl, downloadPrefix } = require('./updater.cjs');

(async () => {
  assert(isNewer('0.1.10', '0.1.9')); assert(isNewer('v1.0.0', '0.9.9'));
  assert(!isNewer('0.1.5', '0.1.5')); assert(!isNewer('0.1.4', '0.1.5'));

  const asset = (version, extra = {}) => ({ name: `LightSage-Setup-${version}.exe`, size: 5, browser_download_url: `${downloadPrefix}v${version}/LightSage-Setup-${version}.exe`, ...extra });
  const release = body => async url => { assert.equal(url, latestUrl); return { ok: true, status: 200, json: async () => body }; };
  const newer = { tag_name: 'v0.2.0', html_url: 'https://github.com/rmirabelle/LightSage/releases/tag/v0.2.0', assets: [{ name: 'LightSage-Setup-0.2.0.exe.blockmap', size: 1 }, asset('0.2.0')] };
  const info = await checkForUpdate('0.1.5', { fetch: release(newer) });
  assert.equal(info.latestVersion, '0.2.0'); assert.equal(info.assetName, 'LightSage-Setup-0.2.0.exe'); assert.equal(info.size, 5);
  assert.equal(await checkForUpdate('0.2.0', { fetch: release(newer) }), null, 'Same version is not an update');
  assert.equal(await checkForUpdate('0.1.5', { fetch: async () => ({ ok: false, status: 404 }) }), null, 'No release yet is not an error');
  await assert.rejects(checkForUpdate('0.1.5', { fetch: async () => ({ ok: false, status: 503 }) }), /GitHub returned 503/);
  await assert.rejects(checkForUpdate('0.1.5', { fetch: release({ ...newer, assets: [asset('0.1.9')] }) }), /does not contain a Windows installer/);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lightsage-updater-'));
  try {
    const body = bytes => async () => ({ ok: true, status: 200, body: new Response(Buffer.from(bytes)).body });
    const progress = [];
    const file = await downloadInstaller(info, dir, { fetch: body('12345'), onProgress: (received, total) => progress.push([received, total]) });
    assert.equal(await fs.readFile(file, 'utf8'), '12345'); assert.deepEqual(progress.at(-1), [5, 5]);
    await assert.rejects(downloadInstaller({ ...info, latestVersion: '0.2.1' }, dir, { fetch: body('x') }), /not an official/);
    await assert.rejects(downloadInstaller({ ...info, downloadUrl: 'https://example.com/LightSage-Setup-0.2.0.exe' }, dir, { fetch: body('x') }), /not an official/);
    await assert.rejects(downloadInstaller({ ...info, assetName: '..\\evil.exe' }, dir, { fetch: body('x') }), /file name/);
    await fs.rm(file);
    await assert.rejects(downloadInstaller(info, dir, { fetch: body('123') }), /incomplete/);
    assert.deepEqual(await fs.readdir(dir), [], 'A failed download leaves no file behind');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }

  const command = installerCommand('C:\\App\\resources', 'C:\\Temp\\LightSage-Setup-0.2.0.exe');
  assert.equal(command.file, path.join('C:\\App\\resources', 'elevate.exe'));
  assert.deepEqual(command.args, ['C:\\Temp\\LightSage-Setup-0.2.0.exe', '/S', '--updated', '--force-run']);
  console.log('PASS: version comparison, release lookup, official-download checks, complete download, cleanup, and elevated silent install command.');
})().catch(error => { console.error(error); process.exitCode = 1; });
