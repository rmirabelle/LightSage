import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bulbPhoto } from './web/bulb-photos.js';
for (const [model, id, file] of [['H6013', 24595, 'h6013'], ['H6006', 24582, 'h6006']]) {
  assert.equal(bulbPhoto({ vendorId: 4999, model }), `/bulb-${file}.png`);
  assert.equal(bulbPhoto({ vendorId: 4999, productId: id }), `/bulb-${file}.png`);
  const bytes = await readFile(new URL(`../../resource/bulbs/${file}.png`, import.meta.url));
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  assert.equal(bytes[25], 6, 'Product images retain RGBA transparency');
}
assert.equal(bulbPhoto({ model: 'H6013' }), null, 'Old hardcoded models cannot select a photo');
assert.equal(bulbPhoto({ vendorId: 1, model: 'H6013' }), null);
assert.equal(bulbPhoto({ vendorId: 4999, model: 'H9999', productId: 24595 }), null);
assert.equal(bulbPhoto({ transport:'bluetooth', model:'H6159' }), '/bulb-h6159.png');
assert.equal(bulbPhoto({ transport:'bluetooth', model:'H6159', available:false }), '/bulb-h6159.png');
assert.equal(bulbPhoto({ model:'H6159' }), null);
assert.equal(bulbPhoto({ transport:'bluetooth', model:'H6199' }), null);
const strip = await readFile(new URL('../../resource/bulbs/h6159.png', import.meta.url));
assert.equal(strip.subarray(1,4).toString(), 'PNG');
assert.equal(strip[25], 6, 'Strip image retains RGBA transparency');
console.log('PASS: verified model/vendor matching, unknown model fallback, bundled transparent images.');
