import QRCode from 'qrcode';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const code = (await readFile(new URL('./.state/access-code.txt', import.meta.url), 'utf8')).trim();
const url = `https://10.0.0.250:3443/#setup=${encodeURIComponent(code)}`;
const output = fileURLToPath(new URL('./.state/iphone-signin.png', import.meta.url));
await QRCode.toFile(output, url, { width: 420, margin: 4, errorCorrectionLevel: 'M' });
console.log('iPhone sign-in QR saved in .state/iphone-signin.png');
