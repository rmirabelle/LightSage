import assert from 'node:assert/strict';
import { Bulb } from './bulb.mjs';

async function simulate({ on = true, failBlink = false, failPreparation = false } = {}) {
  const saved = { on, level: 73, mode: 0, hue: 104, saturation: 180, x: 1, y: 2, mireds: 300 };
  let current = { ...saved }, clock = 0, restored = false, prepared = false;
  let lastLit = { ...saved };
  const flashes = [];
  const bulb = Object.create(Bulb.prototype);
  bulb.raw = async () => ({ ...current });
  bulb.setLevel = async level => { current.level = level; };
  bulb.setWhite = async mireds => {
    if (!failPreparation) Object.assign(current, { mode: 2, mireds });
    if (current.on && current.level === 254 && current.mode === 2) prepared = true;
  };
  bulb.power = {
    on: async () => {
      if (!prepared) {
        // Reproduce hardware that discards color/level writes made while off.
        if (!current.on) Object.assign(current, lastLit);
        current.on = true; clock += 35; return;
      }
      if (failBlink) throw Error('Lost connection');
      assert.equal(current.level, 254);
      assert.equal(current.mode, 2);
      assert.equal(current.mireds, Math.round(1e6 / 4400));
      current.on = true; flashes.push({ on: true, at: clock }); clock += 35;
    },
    off: async () => {
      if (current.on) lastLit = {...current};
      current.on = false;
      if (prepared) flashes.push({ on: false, at: clock });
      clock += 35;
    },
  };
  bulb.restore = async value => { assert.deepEqual(value, saved); current = { ...value }; restored = true; };
  const operation = bulb.identify({ wait: async ms => { clock += ms; }, now: () => clock });
  if (failBlink || failPreparation) await assert.rejects(operation, failBlink ? /Lost connection/ : /confirm full white/);
  else {
    await operation;
    assert.equal(flashes.length, 9);
    flashes.forEach((flash, index) => {
      assert.equal(flash.on, index % 2 !== 0);
      assert.equal(flash.at - flashes[0].at, index * 500);
    });
    assert.equal(clock - flashes[0].at, 4500);
  }
  assert(restored, 'Restore is attempted on success and failure');
  assert.deepEqual(current, saved);
}
await simulate();
await simulate({ on: false });
await simulate({ failBlink: true });
await simulate({ failPreparation: true });
console.log('PASS: full-white flashes at 500ms intervals for 5s; original settings restored for on/off bulbs and command failures.');
