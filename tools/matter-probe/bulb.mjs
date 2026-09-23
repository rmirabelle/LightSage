import { OnOff, LevelControl, ColorControl, BasicInformation } from '@matter/types/clusters';
import { setTimeout as delay } from 'node:timers/promises';
import { xyToHsv } from '@matter/node/behaviors/color-control';
const executeOff = { optionsMask: { executeIfOff: true }, optionsOverride: { executeIfOff: true } };
export function observedColor(raw) {
  if (raw.mode === 2) return { hue: 0, saturation: 0 };
  if (raw.mode === 0 && Number.isFinite(raw.hue) && Number.isFinite(raw.saturation) && raw.hue >= 0 && raw.hue <= 254 && raw.saturation >= 0 && raw.saturation <= 254) {
    return { hue: raw.saturation === 0 ? 0 : raw.hue / 254 * 360, saturation: raw.saturation / 254 * 100 };
  }
  if (raw.mode === 1 && Number.isFinite(raw.x) && Number.isFinite(raw.y) && raw.x >= 0 && raw.y > 0 && raw.x + raw.y <= 65536) {
    const [hue, saturation] = xyToHsv(raw.x / 65536, raw.y / 65536);
    if (Number.isFinite(hue) && Number.isFinite(saturation)) return { hue, saturation: Math.max(0,Math.min(100,saturation * 100)) };
  }
  return { hue: null, saturation: null };
}
export class Bulb {
  constructor(id, record, node) {
    this.id = id; this.name = record.name; this.record = record;
    this.node = node;
    const endpoint = node.getDevices().find(endpoint => endpoint.getClusterClient(OnOff));
    if (!endpoint) throw new Error('No lighting endpoint found.');
    this.power = endpoint.getClusterClient(OnOff);
    this.level = endpoint.getClusterClient(LevelControl);
    this.color = endpoint.getClusterClient(ColorControl);
    if (!this.level || !this.color) throw new Error('Missing lighting controls.');
  }
  async details({ beforeRead } = {}) {
    const info = this.node.getRootClusterClient(BasicInformation);
    const fields = {};
    let failed = 0;
    const keys = ['vendorName', 'vendorId', 'productName', 'productId', 'productLabel',
      'serialNumber', 'hardwareVersion', 'hardwareVersionString', 'softwareVersion', 'softwareVersionString'];
    const read = async key => {
      const getter = info?.[`get${key[0].toUpperCase()}${key.slice(1)}Attribute`];
      if (!getter) return;
      if (beforeRead) await beforeRead();
      let timer;
      try {
        const value = beforeRead ? await getter.call(info, true) : await Promise.race([getter.call(info, true), new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Device information read timed out.')), 6000);
        })]);
        if (typeof value === 'number' || (typeof value === 'string' && value.trim())) fields[key] = value;
      } catch { failed++; }
      finally { clearTimeout(timer); }
    };
    if (beforeRead) { for (const key of keys) await read(key); }
    else await Promise.all(keys.map(read));
    const addresses = (this.node.state?.commissioning?.addresses ?? [])
      .filter(value => typeof value.ip === 'string' && Number.isInteger(value.port))
      .map(({ ip, port }) => ({ ip, port }));
    return { nodeId: this.id, fields, addresses, partial: failed > 0 };
  }
  async raw() {
    // Every value is requested from the bulb; stored observations are not reported as live.
    return {
      on: await this.power.getOnOffAttribute(true),
      level: await this.level.getCurrentLevelAttribute(true),
      mode: await this.color.getColorModeAttribute(true),
      hue: await this.color.getCurrentHueAttribute(true),
      saturation: await this.color.getCurrentSaturationAttribute(true),
      x: await this.color.getCurrentXAttribute(true),
      y: await this.color.getCurrentYAttribute(true),
      mireds: await this.color.getColorTemperatureMiredsAttribute(true),
    };
  }

  async identify({ wait = delay, now = () => performance.now() } = {}) {
    const saved = await this.raw();
    if (![0, 1, 2].includes(saved.mode) || saved.level == null || typeof saved.on !== 'boolean') {
      throw new Error('Cannot safely snapshot this light before identifying it.');
    }
    try {
      const apply = async (action, matches) => {
        for (let attempt = 0; attempt < 3; attempt++) {
          await action(); await wait(200);
          if (matches(await this.raw())) return;
        }
        throw new Error('Could not confirm full white for identification.');
      };
      // Set white while illuminated, as in the Full White command. Some lights
      // report off-state color writes but restore their previous color on power-on.
      await apply(() => this.power.on(), value => value.on);
      await apply(() => this.setLevel(254), value => value.level === 254);
      const mireds = Math.round(1e6 / 4400);
      await apply(() => this.setWhite(mireds), value => value.on && value.level === 254 && value.mode === 2 && value.mireds === mireds);
      // Five on/off cycles. Account for command time instead of adding it to
      // every half-second interval; never overlap commands to this bulb.
      const start = now();
      for (let step = 0; step < 10; step++) {
        if (step && now() >= start + 5000) break;
        // The first full-white interval starts with the light already on.
        if (step) await (step % 2 === 0 ? this.power.on() : this.power.off());
        await wait(Math.max(0, start + (step + 1) * 500 - now()));
      }
    } finally {
      await this.restore(saved);
    }
  }

  async read() {
    const raw = await this.raw();
    return {
      id: this.id, name: this.name,
      model: this.node.basicInformation?.productName ?? null,
      vendorId: this.node.basicInformation?.vendorId ?? null,
      productId: this.node.basicInformation?.productId ?? null,
      on: raw.on, brightness: Math.round(raw.level / 254 * 100),
      kelvin: raw.mireds ? Math.round(1e6 / raw.mireds) : null,
      colorMode: raw.mode, fullWhite: this.record.restore !== null,
      ...observedColor(raw),
      observedAt: new Date().toISOString(), raw,
    };
  }

  async setLevel(level) {
    await this.level.moveToLevel({ level, transitionTime: 0, ...executeOff });
  }

  async setWhite(mireds) {
    await this.color.moveToColorTemperature({ colorTemperatureMireds: mireds, transitionTime: 0, ...executeOff });
  }

  async musicLevel(level) {
    // A single native command: no confirmation reads or artificial delay.
    await this.level.moveToLevelWithOnOff({level, transitionTime:0, ...executeOff});
  }

  async setColor(hue, saturation) {
    const targetHue = Math.round(hue / 360 * 254), targetSaturation = Math.round(saturation / 100 * 254);
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.color.moveToHueAndSaturation({ hue: targetHue, saturation: targetSaturation, transitionTime: 0, ...executeOff });
      await delay(200);
      if (await this.color.getColorModeAttribute(true) === 0 && await this.color.getCurrentHueAttribute(true) === targetHue && await this.color.getCurrentSaturationAttribute(true) === targetSaturation) return;
    }
    throw new Error('Color change could not be confirmed.');
  }

  async transitionColor(hue, saturation, duration) {
    await this.color.moveToHueAndSaturation({
      hue: Math.round(hue / 360 * 254), saturation: Math.round(saturation / 100 * 254),
      transitionTime: Math.round(duration / 100), ...executeOff,
    });
  }

  async stopColorTransition() {
    await this.color.stopMoveStep({ ...executeOff });
  }

  async restore(saved) {
    const apply = async (action, matches) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        await action();
        await delay(200);
        if (matches(await this.raw())) return;
      }
      throw new Error('Restore could not be confirmed. Saved settings are retained; retry Restore.');
    };
    if (saved.mode === 0) {
      await apply(() => this.color.moveToHueAndSaturation({ hue: saved.hue, saturation: saved.saturation, transitionTime: 0, ...executeOff }), value => value.mode === 0 && value.hue === saved.hue && value.saturation === saved.saturation);
    } else if (saved.mode === 1) {
      await apply(() => this.color.moveToColor({ colorX: saved.x, colorY: saved.y, transitionTime: 0, ...executeOff }), value => value.mode === 1 && value.x === saved.x && value.y === saved.y);
    } else if (saved.mode === 2) {
      await apply(() => this.setWhite(saved.mireds), value => value.mode === 2 && value.mireds === saved.mireds);
    } else throw new Error(`Unsupported saved color mode: ${saved.mode}`);
    await apply(() => this.setLevel(saved.level), value => value.level === saved.level);
    await apply(() => saved.on ? this.power.on() : this.power.off(), value => value.on === saved.on);
    const result = await this.raw();
    const colorMatches = saved.mode === 0
      ? result.hue === saved.hue && result.saturation === saved.saturation
      : saved.mode === 1 ? result.x === saved.x && result.y === saved.y : result.mireds === saved.mireds;
    if (result.on !== saved.on || result.level !== saved.level || result.mode !== saved.mode || !colorMatches) {
      throw new Error('Restore could not be confirmed. Saved settings are retained; retry Restore.');
    }
  }

}
