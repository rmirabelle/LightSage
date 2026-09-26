const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const installedState = path.join(process.env.APPDATA, 'LightSage', 'controller');
const stateDir = process.env.LIGHTSAGE_STATE_DIR || (fs.existsSync(path.join(installedState, 'lightsage.json'))
  ? installedState : path.join(root, 'tools', 'matter-probe', '.state'));
const installedRuntime = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'LightSage', 'resources', 'desktop', 'runtime');

// The installed app and development app share a Matter identity, so only one
// may own the service. Fail before launching Electron if its port is occupied.
const probe = net.createServer();
probe.once('error', error => {
  console.error(error.code === 'EADDRINUSE'
    ? 'LightSage is already running. Choose File > Exit LightSage, then run npm run dev again.' : error.message);
  process.exitCode = 1;
});
probe.listen(3442, '127.0.0.1', () => probe.close(() => {
  const env = { ...process.env, LIGHTSAGE_DEV: '1', LIGHTSAGE_STATE_DIR: stateDir,
    LIGHTSAGE_NODE_EXECUTABLE: fs.existsSync(path.join(installedRuntime, 'node.exe')) ? path.join(installedRuntime, 'node.exe') : process.execPath };
  // Reuse the installed runtime's firewall allowance and Bluetooth packages;
  // all application code and UI assets still come from this checkout.
  if (!env.LIGHTSAGE_BLE_PYTHON && fs.existsSync(path.join(installedRuntime, 'python', 'python.exe'))) {
    env.LIGHTSAGE_BLE_PYTHON = path.join(installedRuntime, 'python', 'python.exe');
  }
  console.log(`LightSage DEVELOPMENT: ${root}\nSaved setup: ${stateDir}\nUI edits reload automatically. Use Service > Restart after backend edits.`);
  const child = spawn(require('electron'), [root], { cwd: root, env, stdio: 'inherit', windowsHide: true });
  child.once('error', error => { console.error(error); process.exitCode = 1; });
  child.once('exit', code => { process.exitCode = code ?? 1; });
}));
