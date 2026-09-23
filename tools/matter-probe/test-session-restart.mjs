import { request } from 'node:https';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import assert from 'node:assert/strict';
const ca = await readFile(new URL('./.state/tls/root.crt', import.meta.url));
const cookieFile = new URL('./.state/restart-test-cookie', import.meta.url);
function call(path, body, cookie) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: 3443, path, ca,
      method: body ? 'POST' : 'GET', headers: { Origin: 'https://127.0.0.1:3443', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) } }, res => {
      res.resume(); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
    });
    req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
  });
}
if (process.argv[2] === 'save') {
  const code = (await readFile(new URL('./.state/access-code.txt', import.meta.url), 'utf8')).trim();
  const result = await call('/api/session', { code });
  assert.equal(result.status, 200);
  await writeFile(cookieFile, result.headers['set-cookie'][0].split(';')[0]);
  console.log('Session captured privately; ready to restart server.');
} else if (process.argv[2] === 'verify') {
  const result = await call('/api/state', undefined, await readFile(cookieFile, 'utf8'));
  assert.equal(result.status, 200, 'Pre-restart cookie must work without another login.');
  assert.match(result.headers['set-cookie'][0], /=v2\./);
  assert.match(result.headers['set-cookie'][0], /Max-Age=34560000/);
  await unlink(cookieFile);
  console.log('PASS: original HTTPS session still works after a real server restart.');
} else throw new Error('Use save or verify.');
