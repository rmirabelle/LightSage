const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');

async function snapshot(root, relative = '') {
  const files = {};
  for (const entry of (await fs.readdir(path.join(root, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = path.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw Error('Backup refuses symbolic links: ' + name);
    if (entry.name === 'matter.lock' || entry.name === 'matter.pid') throw Error('Controller storage is still locked. Stop the service before backing up.');
    if (entry.isDirectory()) Object.assign(files, await snapshot(root, name));
    else if (entry.isFile()) {
      const bytes = await fs.readFile(path.join(root, name));
      files[name] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    } else throw Error('Unsupported state entry: ' + name);
  }
  return files;
}

async function backupState(source, destinationRoot) {
  source = await fs.realpath(source);
  destinationRoot = path.resolve(destinationRoot);
  const relative = path.relative(source, destinationRoot);
  if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) throw Error('Backup destination must be outside the source state directory.');
  const before = await snapshot(source);
  if (!before['lightsage.json'] || !before['access-code.txt']) throw Error('Expected LightSage state files are missing.');
  const settings = JSON.parse(await fs.readFile(path.join(source, 'lightsage.json'), 'utf8'));
  const counts = { lights: Object.keys(settings.lights ?? {}).length, rooms: Object.keys(settings.groups ?? {}).length, scenes: Object.keys(settings.scenes ?? {}).length };
  const backup = path.join(destinationRoot, new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8));
  await fs.mkdir(backup, { recursive: true });
  const copied = path.join(backup, 'state');
  await fs.cp(source, copied, { recursive: true, force: false, errorOnExist: true });
  assert.deepEqual(await snapshot(copied), before, 'Copied state does not match the source. Backup is not verified.');
  assert.deepEqual(await snapshot(source), before, 'Source changed during backup. Stop the service and try again.');
  await fs.writeFile(path.join(backup, 'manifest.json'), JSON.stringify({ version: 1, source, createdAt: new Date().toISOString(), counts, files: before }, null, 2), { flag: 'wx' });
  return { backup, counts, files: Object.keys(before).length };
}

module.exports = { backupState, snapshot };
if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  backupState(path.join(root, 'tools/matter-probe/.state'), path.join(root, '.backups'))
    .then(value => console.log(JSON.stringify(value, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
