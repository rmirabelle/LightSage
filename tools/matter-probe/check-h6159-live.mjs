// Explicit live diagnostic: changes only the supplied strip, then restores it.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {H6159} from './h6159.mjs';
const address=process.argv[2];
if(!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i.test(address??'')) throw Error('Supply the H6159 Bluetooth address.');
const bulb=new H6159('diagnostic',{name:'H6159 diagnostic',address});
const saved=await bulb.raw();
if(saved.mode!==0) throw Error('Choose a solid color before running this diagnostic.');
await writeFile(new URL('./.state/h6159-diagnostic-restore.json',import.meta.url),JSON.stringify(saved,null,2));
try {
  await (saved.on?bulb.power.off():bulb.power.on());
  assert.equal((await bulb.raw()).on,!saved.on);
  await bulb.setLevel(51);
  assert.equal((await bulb.raw()).ble.brightnessByte,51);
  await bulb.setColor(120,100);
  assert.deepEqual((await bulb.raw()).ble.rgb,[0,255,0]);
  console.log('PASS: live power, brightness and color readback.');
} finally {
  await bulb.restore(saved);
  assert.deepEqual((await bulb.raw()).ble,saved.ble);
  console.log('PASS: original strip settings restored exactly.');
}
