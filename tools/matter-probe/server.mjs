import { createServer as httpServer } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Lighting } from './lighting.mjs';
import { iphoneProfile } from './iphone-profile.mjs';
import { sessionTokens, cookieLifetimeSeconds } from './sessions.mjs';
import { linkCodes } from './link-codes.mjs';
import { PairingJob } from './pairing-job.mjs';
import { bleRequest } from './h6159.mjs';
import { DetailsPrefetch } from './details-prefetch.mjs';
import { reconnect } from './reconnect.mjs';

const path = file => fileURLToPath(new URL(file, import.meta.url));
const lighting = new Lighting();
const pairingRecoveryPath = path('./.state/pairing-recovery.json');
const pairing = new PairingJob(lighting, { onTimeout: async status => {
  console.error('Pairing exceeded its overall deadline; restarting controller.');
  // A rejected promise cannot cancel Matter. Restart the worker rather than
  // releasing its queue and allowing overlapping commissioning operations.
  const forceExit = setTimeout(() => process.exit(75), 2000);
  try { await writeFile(pairingRecoveryPath, JSON.stringify({ ...status, recovering: false })); }
  finally { clearTimeout(forceExit); process.exit(75); }
} });
try {
  pairing.status = JSON.parse(await readFile(pairingRecoveryPath, 'utf8'));
  await unlink(pairingRecoveryPath);
} catch (error) { if (error.code !== 'ENOENT') throw error; }
let accessCode;
try { accessCode = (await readFile(path('./.state/access-code.txt'), 'utf8')).trim(); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  accessCode = randomBytes(24).toString('base64url');
  await writeFile(path('./.state/access-code.txt'), accessCode, { flag: 'wx' });
}
const sessions = sessionTokens(accessCode);
const deviceLinks = linkCodes();
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/bulb-photos.js', ['bulb-photos.js', 'text/javascript; charset=utf-8']],
  ['/bulb-h6013.png', ['../../../resource/bulbs/h6013.png', 'image/png']],
  ['/bulb-h6006.png', ['../../../resource/bulbs/h6006.png', 'image/png']],
  ['/bulb-h6159.png', ['../../../resource/bulbs/h6159.png', 'image/png']],
  ['/color-wheel.js', ['color-wheel.js', 'text/javascript; charset=utf-8']],
  ['/adjustment-queue.js', ['adjustment-queue.js', 'text/javascript; charset=utf-8']],
  ['/music-controls.js', ['music-controls.js', 'text/javascript; charset=utf-8']],
  ['/scene-controls.js', ['scene-controls.js', 'text/javascript; charset=utf-8']],
  ['/audio-level.js', ['audio-level.js', 'text/javascript; charset=utf-8']],
  ['/gradient-controls.js', ['gradient-controls.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json']],
  ['/sw.js', ['sw.js', 'text/javascript']],
  ['/icon.svg', ['icon.svg', 'image/svg+xml']],
  ['/logo.png', ['../../../resource/logo.png', 'image/png']],
  ['/app-icon.png', ['../../../resource/icon-pack/android/play_store_512.png', 'image/png']],
  ['/app-icon.ico', ['../../../resource/icon-pack/windows/icon.ico', 'image/x-icon']],
]);
const allowedHosts = new Set(['localhost:3442', '127.0.0.1:3442', 'localhost:3443', '127.0.0.1:3443', '10.0.0.250:3443']);
let pending = 0;
let stateRead;
let connectionRestart = false;
let connectionRetry = false;
const detailsPrefetch = new DetailsPrefetch(lighting, {idle: () => pending === 0 && !connectionRetry && !connectionRestart && pairing.status.state !== 'pairing' && !pairing.status.recovering});
function readState() {
  // Multiple clients and retries share a single queued refresh.
  if (!stateRead) {
    stateRead = lighting.serial(() => lighting.catalog()).finally(() => { stateRead = undefined; });
  }
  return stateRead;
}
async function body(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 2048) throw new Error('Request too large.');
  }
  return JSON.parse(text);
}
function reply(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
async function handle(req, res) {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const host = req.headers.host;
  if (!allowedHosts.has(host)) return reply(res, 403, { error: 'Unknown host.' });
  const origin = `${req.socket.encrypted ? 'https' : 'http'}://${host}`;
  const pathname = new URL(req.url, origin).pathname;
  if (pathname.startsWith('/api/')) {
    const started = Date.now();
    res.once('close', () => {
      const elapsed = Date.now() - started;
      if (!res.writableFinished || elapsed >= 3000) {
        console.warn(`API ${req.method} ${pathname}: ${res.writableFinished ? res.statusCode : 'connection closed'} after ${elapsed}ms`);
      }
    });
  }
  try {
    if (req.method === 'POST' && req.headers.origin !== origin) return reply(res, 403, { error: 'Invalid request origin.' });
    if (pathname === '/api/session' && req.method === 'POST') {
      const { code } = await body(req);
      const supplied = Buffer.from(typeof code === 'string' ? code : '');
      const expected = Buffer.from(accessCode);
      const validAccessCode = supplied.length === expected.length && timingSafeEqual(supplied, expected);
      if (!validAccessCode && !deviceLinks.consume(code)) return reply(res, 401, { error: 'Incorrect or expired sign-in code.' });
      const token = sessions.issue();
      const cookieName = req.socket.encrypted ? '__Host-lightsage' : 'lightsage-local';
      res.setHeader('Set-Cookie', `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${cookieLifetimeSeconds}${req.socket.encrypted ? '; Secure' : ''}`);
      if (connectionRestart) return reply(res, 503, { error: 'Restarting the lighting service to clear stuck connections. Reconnecting automatically.' });
      return reply(res, 200, { ok: true });
    }
    if (pathname.startsWith('/api/')) {
      const cookieName = req.socket.encrypted ? '__Host-lightsage' : 'lightsage-local';
      const cookies = Object.fromEntries((req.headers.cookie ?? '').split(';').map(v => v.trim().split('=')));
      if (!sessions.valid(cookies[cookieName])) return reply(res, 401, { error: 'Connect to this controller first.' });
      if (pathname === '/api/state' && req.method === 'GET') detailsPrefetch.touch();
      else if (req.method !== 'GET' || pathname === '/api/bulb-details') detailsPrefetch.foreground();
      const token = cookies[cookieName].startsWith('v2.') ? cookies[cookieName] : sessions.issue();
      res.setHeader('Set-Cookie', `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${cookieLifetimeSeconds}${req.socket.encrypted ? '; Secure' : ''}`);
      if (pathname === '/api/link-code' && req.method === 'POST') return reply(res, 200, deviceLinks.issue());
      if (pathname === '/api/pairing' && req.method === 'GET') return reply(res, 200, pairing.status);
      if (pathname === '/api/music/status' && req.method === 'GET') return reply(res, 200, lighting.music.summary());
      if (pathname === '/api/pairing' && req.method === 'POST') {
        if (connectionRetry) return reply(res, 423, { error: 'Wait for the connection retry to finish before pairing.' });
        const input = await body(req);
        try { return reply(res, 202, pairing.start(input)); }
        catch (error) { return reply(res, 400, { error: error.message }); }
      }
      if (pairing.status.state === 'pairing' || pairing.status.recovering) return reply(res, 423, { error: 'Pairing a light. Light controls will resume when it finishes.' });
      if (pathname === '/api/music/frame' && req.method === 'POST') {
        try { return reply(res, 200, lighting.music.frame(await body(req))); }
        catch (error) { return reply(res, 409, {error:error.message}); }
      }
      if (pending >= 8) return reply(res, 429, { error: 'Controller busy; retry shortly.' });
      pending++;
      try {
        if (pathname === '/api/light' && req.method === 'GET') return reply(res, 200, await lighting.serial(() => lighting.read()));
        if (pathname === '/api/state' && req.method === 'GET') {
          const state = await readState();
          return reply(res, 200, { ...state, service: {
            address: req.socket.localAddress?.replace(/^::ffff:/, ''),
            port: req.socket.localPort,
            uptimeSeconds: Math.floor(process.uptime()),
          } });
        }
        if (pathname === '/api/music/start' && req.method === 'POST') {
          const {target} = await body(req);
          return reply(res, 200, await lighting.serial(() => lighting.startMusic(target)));
        }
        if (pathname === '/api/music/stop' && req.method === 'POST') {
          const {token} = await body(req);
          await lighting.serial(() => token && token === lighting.music.token ? lighting.music.stop([...lighting.music.bulbs.keys()]) : undefined);
          return reply(res, 200, {ok:true});
        }
        if (pathname === '/api/gradient' && req.method === 'POST') {
          const command = await body(req);
          return reply(res, 200, await lighting.serial(() => lighting.gradient(command)));
        }
        if (pathname === '/api/scenes' && req.method === 'POST') {
          const command = await body(req);
          return reply(res, 200, await lighting.serial(() => lighting.scene(command)));
        }
        if (pathname === '/api/manage' && req.method === 'POST') {
          const command = await body(req);
          return reply(res, 200, await lighting.serial(() => lighting.manage(command)));
        }
        if (pathname === '/api/reconnect' && req.method === 'POST') {
          const { id, ids } = await body(req);
          if (connectionRetry) return reply(res, 423, { error: 'A connection retry is already in progress.' });
          connectionRetry = true;
          try {
          const result = await lighting.serial(async () => {
            // Recheck after waiting in the queue: pairing or another retry may
            // have started since this request arrived.
            if (connectionRestart || pairing.status.state === 'pairing' || pairing.status.recovering) throw Error('The controller is recovering or pairing. Please wait.');
            const result = await reconnect(lighting, ids ?? [id], process.connected === true);
            if (result.recovery.restarting) {
              connectionRestart = true;
              console.warn(result.recovery.message);
              // Let the response reach clients before closing their connections.
              // Desktop supervises the worker and reloads the UI when ready.
              setTimeout(() => {
                const forceExit = setTimeout(() => process.exit(75), 2000);
                void shutdown().catch(error => console.warn(error.message)).finally(() => {
                  clearTimeout(forceExit); process.exit(75);
                });
              }, 500);
            }
            return result;
          });
          return reply(res, 200, result);
          } finally { connectionRetry = false; }
        }
        if (pathname === '/api/identify' && req.method === 'POST') {
          const { id } = await body(req);
          return reply(res, 200, await lighting.serial(() => lighting.identify(id)));
        }
        if (pathname === '/api/bluetooth/scan' && req.method === 'POST') return reply(res, 200, await lighting.serial(() => bleRequest({action:'scan'})));
        if (pathname === '/api/bulb-details' && req.method === 'GET') {
          const id = new URL(req.url, origin).searchParams.get('id');
          if (!lighting.nodeIds.has(id)) return reply(res, 400, { error: 'Choose a known light.' });
          return reply(res, 200, await lighting.details(id, new URL(req.url, origin).searchParams.get('refresh') === '1'));
        }
        if (pathname === '/api/command' && req.method === 'POST') {
          const command = await body(req);
          return reply(res, 200, await lighting.serial(() => lighting.command(command)));
        }
        return reply(res, 404, { error: 'Unknown endpoint.' });
      } finally { pending--; }
    }
    if (pathname === '/lightsage-root.crt' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/x-x509-ca-cert', 'Content-Disposition': 'attachment; filename="LightSage-Local-CA.crt"' });
      return res.end(await readFile(path('./.state/tls/root.crt')));
    }
    if (req.method !== 'GET' || !assets.has(pathname)) return reply(res, 404, { error: 'Not found.' });
    const [file, mime] = assets.get(pathname);
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
    if (pathname === '/sw.js') {
      // Change the worker whenever its shell changes, so cache-first iPhones
      // receive edits without requiring a manually maintained version number.
      const hash = createHash('sha256');
      for (const [assetUrl, [assetFile]] of assets) {
        if (assetUrl !== '/sw.js') hash.update(await readFile(path(`./web/${assetFile}`)));
      }
      const workerSource = await readFile(path('./web/sw.js'), 'utf8');
      return res.end(`self.LIGHTSAGE_BUILD = "${hash.digest('hex').slice(0, 16)}";\n${workerSource}`);
    }
    res.end(await readFile(path(`./web/${file}`)));
  } catch (error) {
    console.error(error.message);
    if (!res.headersSent) reply(res, 503, { error: error.message });
    else res.end();
  }
}

await lighting.start();
const local = httpServer(handle);
const secure = httpsServer({
  key: await readFile(path('./.state/tls/server.key')),
  cert: await readFile(path('./.state/tls/server.crt')),
}, handle);
// Public certificate bootstrap only. No lighting API, secrets, or authentication
// is served over this LAN HTTP port.
const profile = iphoneProfile(await readFile(path('./.state/tls/root.crt')));
const setup = httpServer(async (req, res) => {
  if (!['10.0.0.250:3444', '127.0.0.1:3444', 'localhost:3444'].includes(req.headers.host) || req.method !== 'GET') {
    res.writeHead(404); return res.end();
  }
  if (req.url === '/lightsage.mobileconfig') {
    res.writeHead(200, { 'Content-Type': 'application/x-apple-aspen-config', 'Cache-Control': 'no-store' });
    return res.end(profile);
  }
  if (req.url === '/lightsage-root.crt') {
    res.writeHead(200, { 'Content-Type': 'application/x-x509-ca-cert', 'Content-Disposition': 'attachment; filename="LightSage-Local-CA.crt"' });
    return res.end(await readFile(path('./.state/tls/root.crt')));
  }
  if (req.url !== '/') { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LightSage iPhone setup</title><body style="font:18px system-ui;max-width:560px;margin:40px auto;padding:20px;line-height:1.6"><h1>LightSage iPhone setup</h1><p>This installs the local certificate authority created on your Windows PC, so your iPhone can securely connect to it without a cloud service. Only install it if you recognize this as your LightSage PC.</p><ol><li><a href="/lightsage.mobileconfig">Download iPhone certificate profile</a> in Safari. Tap Allow when asked to download a configuration profile.</li><li>Immediately open the main iPhone Settings screen and tap Profile Downloaded. Select LightSage Local HTTPS, tap Install, and enter your iPhone passcode. Alternatively look under General → VPN &amp; Device Management. Install within 8 minutes. If Safari saved a file instead, open it from Files → Downloads, then return to Settings.</li><li>Go to Settings → General → About → Certificate Trust Settings. Enable full trust for LightSage Local CA.</li><li><a href="https://10.0.0.250:3443">Open LightSage</a> and enter the controller access code from your PC.</li><li>In Safari, tap Share → Add to Home Screen.</li></ol><p>The certificate private key stays on your PC. This setup page carries no lighting commands or access code.</p></body></html>`);
});
await new Promise((resolve, reject) => { local.once('error', reject); local.listen(3442, '127.0.0.1', resolve); });
await new Promise((resolve, reject) => { secure.once('error', reject); secure.listen(3443, '0.0.0.0', resolve); });
await new Promise((resolve, reject) => { setup.once('error', reject); setup.listen(3444, '0.0.0.0', resolve); });
console.log('LightSage ready. Desktop: http://127.0.0.1:3442 | iPhone: https://10.0.0.250:3443');
detailsPrefetch.start();
console.log('Access code: .state/access-code.txt. This development process must remain running.');
process.send?.({ type: 'ready' });
async function shutdown() {
  detailsPrefetch.stop();
  local.close(); secure.close();
  setup.close(); setup.closeAllConnections();
  local.closeAllConnections(); secure.closeAllConnections();
  await lighting.close();
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
process.on('message', message => {
  if (message?.type === 'shutdown') void shutdown().then(() => process.exit(0));
});
process.on('disconnect', () => void shutdown().then(() => process.exit(0)));
