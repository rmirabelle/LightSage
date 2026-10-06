/**
 * Fails when a release build contains a credential. LightSage's own files
 * are checked for common token formats. Every file, including the setup
 * program, is checked for the Cloudflare token from this PC's
 * public-https.json. Usage: node desktop/check-secrets.cjs <setup.exe>
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const unpacked = path.join(root, 'dist', 'win-unpacked');
const setup = process.argv[2];
const patterns = [/github_pat_[A-Za-z0-9_]{20,}/, /ghp_[A-Za-z0-9]{30,}/, /AKIA[0-9A-Z]{16}/, /sk-ant-[A-Za-z0-9_-]{20,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];
function* files(target, skip = () => false) {
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) { yield target; return; }
  for (const entry of fs.readdirSync(target)) {
    const child = path.join(target, entry);
    if (!skip(child)) yield* files(child, skip);
  }
}
let token = '';
try { token = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA ?? '', 'LightSage', 'controller', 'public-https.json'), 'utf8')).cloudflareToken ?? ''; }
catch { /* No own-domain setup on this PC. */ }
const problems = [];
const own = [path.join(unpacked, 'resources', 'app.asar'), path.join(unpacked, 'resources', 'tools', 'matter-probe')];
for (const target of own) for (const file of files(target, child => path.basename(child) === 'node_modules')) {
  const text = fs.readFileSync(file).toString('latin1');
  for (const pattern of patterns) if (pattern.test(text)) problems.push(`${path.relative(root, file)} matches ${pattern}`);
}
if (token) {
  const needle = Buffer.from(token);
  for (const file of [...files(unpacked), ...(setup ? [setup] : [])]) {
    if (fs.readFileSync(file).includes(needle)) problems.push(`${path.relative(root, file)} contains the Cloudflare token`);
  }
}
if (!setup || !fs.existsSync(setup)) problems.push(`Setup program not found: ${setup}`);
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log(`PASS: no credentials in LightSage files${token ? ' and no Cloudflare token anywhere in the build' : ''}.`);
