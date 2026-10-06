/**
 * Finds, downloads, and starts LightSage updates from the public GitHub
 * releases, like the other Sage apps. Only the desktop shell uses the
 * internet, and only for this check. Lighting control stays local.
 */
const fs = require('node:fs');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const repository = 'rmirabelle/LightSage';
const latestUrl = `https://api.github.com/repos/${repository}/releases/latest`;
const downloadPrefix = `https://github.com/${repository}/releases/download/`;
const assetPattern = /^LightSage-Setup-(\d+\.\d+\.\d+)\.exe$/;

function parseVersion(version) {
  return String(version).replace(/^[^\d]*/, '').split('.').slice(0, 3).map(part => Number.parseInt(part, 10) || 0);
}
function isNewer(latest, current) {
  const a = parseVersion(latest), b = parseVersion(current);
  for (let index = 0; index < 3; index++) if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) > (b[index] ?? 0);
  return false;
}
async function checkForUpdate(currentVersion, { fetch: request = fetch } = {}) {
  const response = await request(latestUrl, {
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'LightSage-Updater' },
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw Error(`GitHub returned ${response.status}.`);
  const release = await response.json();
  const latestVersion = String(release.tag_name ?? '').replace(/^v/, '');
  if (!isNewer(latestVersion, currentVersion)) return null;
  const asset = (release.assets ?? []).find(item => assetPattern.exec(item.name)?.[1] === latestVersion);
  if (!asset) throw Error('The latest release does not contain a Windows installer.');
  return { currentVersion, latestVersion, assetName: asset.name, downloadUrl: asset.browser_download_url, size: asset.size, releaseUrl: release.html_url };
}
function validate(info) {
  if (!assetPattern.test(info?.assetName ?? '')) throw Error('The update file name is not valid.');
  if (info.downloadUrl !== `${downloadPrefix}v${info.latestVersion}/${info.assetName}`) throw Error('The update is not an official LightSage release.');
  if (!Number.isSafeInteger(info.size) || info.size <= 0) throw Error('The update size is not valid.');
}
async function downloadInstaller(info, directory, { fetch: request = fetch, onProgress = () => {} } = {}) {
  validate(info);
  const target = path.join(directory, info.assetName), partial = `${target}.partial`;
  const response = await request(info.downloadUrl, { headers: { 'User-Agent': 'LightSage-Updater' } });
  if (!response.ok || !response.body) throw Error(`Download failed: server returned ${response.status}.`);
  let received = 0;
  const count = new Transform({ transform(chunk, _encoding, done) {
    received += chunk.length; onProgress(received, info.size); done(null, chunk);
  } });
  try {
    await pipeline(Readable.fromWeb(response.body), count, fs.createWriteStream(partial));
    if (received !== info.size) throw Error(`Download incomplete: received ${received} of ${info.size} bytes.`);
    await fs.promises.rename(partial, target);
  } catch (error) {
    await fs.promises.rm(partial, { force: true });
    throw error;
  }
  return target;
}
/**
 * The installer is per-machine, so it needs administrator rights.
 * electron-builder ships elevate.exe for this. /S installs silently,
 * --updated keeps the user's shortcut choices, and --force-run starts
 * LightSage again when the install finishes.
 */
function installerCommand(resourcesPath, installer) {
  return { file: path.join(resourcesPath, 'elevate.exe'), args: [installer, '/S', '--updated', '--force-run'] };
}
module.exports = { parseVersion, isNewer, checkForUpdate, downloadInstaller, installerCommand, latestUrl, downloadPrefix };
