// Build-machine preparation only. Installed users never run Python, pip, or npm.
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const runtime = path.join(__dirname, 'installer-runtime');
const python = path.join(runtime, 'python');
const version = '3.14.0';
async function download(url, target) {
  const response = await fetch(url);
  if (!response.ok) throw Error(`Download failed (${response.status}): ${url}`);
  await fs.writeFile(target, Buffer.from(await response.arrayBuffer()));
}
(async () => {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('Build on Windows x64.');
  await fs.mkdir(python, { recursive: true });
  await fs.copyFile(process.execPath, path.join(runtime, 'node.exe'));
  const archive = path.join(runtime, 'python-embed.zip');
  await download(`https://www.python.org/ftp/python/${version}/python-${version}-embed-amd64.zip`, archive);
  // Paths are passed as environment values, never interpolated into PowerShell code.
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:LIGHTSAGE_ARCHIVE -DestinationPath $env:LIGHTSAGE_PYTHON -Force'], { windowsHide: true, env: { ...process.env, LIGHTSAGE_ARCHIVE: archive, LIGHTSAGE_PYTHON: python } });
  await fs.unlink(archive);
  await fs.writeFile(path.join(python, 'python314._pth'), 'python314.zip\n.\nLib/site-packages\nimport site\n');
  const builderPython = process.env.LIGHTSAGE_BUILD_PYTHON || 'python';
  execFileSync(builderPython, ['-m', 'pip', 'install', '--upgrade', '--only-binary=:all:', '--python-version', '3.14', '--platform', 'win_amd64', '--implementation', 'cp', '--abi', 'cp314', '--target', path.join(python, 'Lib', 'site-packages'), '-r', path.join(__dirname, 'installer', 'requirements.txt')], { stdio: 'inherit', windowsHide: true });
  execFileSync(path.join(python, 'python.exe'), ['-I', '-c', 'import bleak; from winrt.windows.devices.bluetooth import BluetoothLEDevice; print("Bundled Bluetooth runtime ready")'], { stdio: 'inherit', windowsHide: true });
  await download(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`, path.join(runtime, 'NODE-LICENSE.txt'));
  await fs.writeFile(path.join(runtime, 'versions.json'), JSON.stringify({ node: process.version, python: version, bleak: '3.0.2' }, null, 2));
  console.log('Installer runtimes prepared.');
})().catch(error => { console.error(error); process.exitCode = 1; });
