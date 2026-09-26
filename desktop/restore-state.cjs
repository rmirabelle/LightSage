const fs = require('node:fs/promises');
const sync = require('node:fs');
const path = require('node:path');
const { randomUUID, X509Certificate, createPrivateKey } = require('node:crypto');
const assert = require('node:assert/strict');
const { snapshot } = require('./backup-state.cjs');

async function validateBackup(folder) {
  const root = await fs.realpath(folder);
  for (const name of ['manifest.json', 'state']) {
    if ((await fs.lstat(path.join(root, name))).isSymbolicLink()) throw Error('Backup links are not supported.');
  }
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
  if (manifest.version !== 1 || !manifest.files || typeof manifest.files !== 'object') throw Error('Unsupported backup format.');
  const state = path.join(root, 'state');
  assert.deepEqual(await snapshot(state), manifest.files, 'Backup files do not match their verification manifest.');
  const settings = JSON.parse(await fs.readFile(path.join(state, 'lightsage.json'), 'utf8'));
  if (settings.version !== 2 || !settings.lights || !settings.groups) throw Error('Unsupported light settings format.');
  if (!(await fs.readFile(path.join(state, 'access-code.txt'), 'utf8')).trim()) throw Error('Backup has no access code.');
  for (const name of ['root', 'server']) {
    const cert = new X509Certificate(await fs.readFile(path.join(state, 'tls', name + '.crt')));
    if (!cert.checkPrivateKey(createPrivateKey(await fs.readFile(path.join(state, 'tls', name + '.key'))))) throw Error('Certificate key mismatch.');
  }
  if (Object.entries(settings.lights).some(([, light]) => light.transport !== 'bluetooth')) {
    for (const name of ['certificates.rootKeyPair', 'fabrics.fabrics']) {
      if (!manifest.files[path.join('lightsage-probe', name)]) throw Error('Backup is missing its Matter pairing identity.');
    }
  }
  return { root, state, manifest, counts: { lights: Object.keys(settings.lights).length, rooms: Object.keys(settings.groups).length, scenes: Object.keys(settings.scenes ?? {}).length } };
}

const journalPath = state => `${state}.restore-pending.json`;
function journalFor(state) {
  const journal = JSON.parse(sync.readFileSync(journalPath(state), 'utf8'));
  for (const key of ['previous', 'staging']) {
    if (path.dirname(journal[key]) !== path.dirname(state) || !path.basename(journal[key]).startsWith(path.basename(state) + '.restore-')) throw Error('Invalid recovery journal path.');
  }
  return journal;
}

// An interrupted restore is rolled back before the controller is allowed to start.
// Preserve the attempted replacement for diagnosis; never delete state directories.
function recoverPendingRestore(state) {
  if (!sync.existsSync(journalPath(state))) return;
  const journal = journalFor(state);
  if ([state, path.join(journal.previous, 'state')].some(dir => sync.existsSync(path.join(dir, 'lightsage-probe', 'matter.lock')))) throw Error('Stop the active controller before recovering an interrupted restore.');
  if (sync.existsSync(path.join(journal.previous, 'state'))) {
    if (sync.existsSync(state)) sync.renameSync(state, `${state}.restore-interrupted-${randomUUID()}`);
    sync.renameSync(path.join(journal.previous, 'state'), state);
  }
  sync.unlinkSync(journalPath(state));
}

async function prepareRestore(folder, stateDir) {
  stateDir = path.resolve(stateDir);
  if (sync.existsSync(journalPath(stateDir))) throw Error('A previous restore requires recovery before trying again.');
  const backup = await validateBackup(folder);
  // Also catches another active controller. Restoration never bypasses storage locks.
  const originalFiles = await snapshot(stateDir);
  const id = randomUUID();
  const staging = `${stateDir}.restore-staging-${id}`;
  const previous = `${stateDir}.restore-previous-${id}`;
  await fs.cp(backup.state, staging, { recursive: true, force: false, errorOnExist: true });
  assert.deepEqual(await snapshot(staging), backup.manifest.files, 'Staged restore failed verification.');
  assert.deepEqual(await snapshot(stateDir), originalFiles, 'Current setup changed while preparing restore.');
  await fs.mkdir(previous);
  await fs.writeFile(journalPath(stateDir), JSON.stringify({ previous, staging }), { flag: 'wx' });
  try {
    await fs.rename(stateDir, path.join(previous, 'state'));
    await fs.writeFile(path.join(previous, 'manifest.json'), JSON.stringify({ version: 1, createdAt: new Date().toISOString(), files: originalFiles }, null, 2), { flag: 'wx' });
    await fs.rename(staging, stateDir);
  } catch (error) { recoverPendingRestore(stateDir); throw error; }
  return {
    counts: backup.counts, previous,
    async commit() { await fs.unlink(journalPath(stateDir)); },
    rollback() { recoverPendingRestore(stateDir); },
  };
}

module.exports = { validateBackup, prepareRestore, recoverPendingRestore };
