import { request } from 'node:https';
import { readFile } from 'node:fs/promises';
const ca = await readFile(new URL('./.state/tls/root.crt', import.meta.url));
const code = (await readFile(new URL('./.state/access-code.txt', import.meta.url), 'utf8')).trim();
async function post(path, data, cookie) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: 3443, path, method: 'POST', ca,
      headers: { Origin: 'https://127.0.0.1:3443', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) } }, res => {
      let text = ''; res.on('data', chunk => text += chunk);
      res.on('end', () => res.statusCode === 200 ? resolve({ data: JSON.parse(text), cookie: res.headers['set-cookie']?.[0].split(';')[0] }) : reject(new Error(`HTTP ${res.statusCode}`)));
    }); req.on('error', reject); req.end(JSON.stringify(data));
  });
}
const login = await post('/api/session', { code });
const link = await post('/api/link-code', {}, login.cookie);
console.log(link.data.code);
