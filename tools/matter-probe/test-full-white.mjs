import { Lighting } from './lighting.mjs';
import assert from 'node:assert/strict';
let lighting = new Lighting();
const originals = new Map();
try {
  await lighting.start();
  const ids = lighting.members('dining-room');
  const before = new Map();
  for (const id of ids) {
    assert.equal(lighting.settings.lights[id].restore, null, 'Restore existing overrides before testing.');
    originals.set(id, await (await lighting.bulb(id)).raw());
  }
  for (const id of ids) {
    await (await lighting.bulb(id)).setWhite(id === '1' ? 370 : 154);
    before.set(id, await (await lighting.bulb(id)).raw());
    assert.equal(before.get(id).mireds, id === '1' ? 370 : 154);
  }
  console.log('Original levels:', [...before].map(([id, state]) => `${id}=${state.level}`).join(', '));
  try {
    const white = await lighting.command({ target: 'dining-room', type: 'fullWhite', enabled: true });
    assert(white.outcomes.every(item => item.ok), JSON.stringify(white.outcomes));
    for (const light of white.state.lights) {
      assert.equal(light.raw.level, 254); assert.equal(light.raw.mireds, 227); assert.equal(light.raw.mode, 2); assert.equal(light.on, true);
    }
    await assert.rejects(lighting.command({ target: '1', type: 'fullWhite', enabled: true }), /existing override/);
    await lighting.command({ target: 'dining-room', type: 'fullWhite', enabled: true });
    for (const id of ids) assert.deepEqual(lighting.settings.lights[id].restore, before.get(id));
    console.log('Both bulbs confirmed at Full White; repeated activation and overlap protection preserve originals.');
    await lighting.close();
    lighting = new Lighting();
    await lighting.start();
    for (const id of ids) assert.deepEqual(lighting.settings.lights[id].restore, before.get(id));
    console.log('Both independent restore snapshots survived controller restart.');
  } finally {
    const restored = await lighting.command({ target: 'dining-room', type: 'fullWhite', enabled: false });
    assert(restored.outcomes.every(item => item.ok), JSON.stringify(restored.outcomes));
  }
  for (const id of ids) {
    assert.equal(lighting.settings.lights[id].restore, null);
    const observed = await (await lighting.bulb(id)).raw();
    const original = before.get(id);
    assert.equal(observed.level, original.level);
    assert.equal(observed.on, original.on);
    assert.equal(observed.mode, original.mode);
  }
  console.log('PASS: each bulb restored to its own original power, level, and active color (readback verified).');
} finally {
  try {
    for (const [id, original] of originals) {
      await (await lighting.bulb(id)).restore(original);
      Object.assign(lighting.settings.lights[id], { restore: null, owner: null });
      await lighting.save();
    }
  } finally { await lighting.close(); }
}
