import { attachWheel } from './color-wheel.js';

export function gradientControls({ value, allowed, apply, select, pending }) {
  const drafts = new Map();
  const controls = ['', 'bulb-'].map(prefix => {
    const get = suffix => document.getElementById(`${prefix}gradient-${suffix}`);
    const current = () => value(prefix);
    const draft = () => {
      const light = current();
      if (!drafts.has(light.id)) drafts.set(light.id, light.gradient ? structuredClone(light.gradient) : {
        start: { hue: light.hue ?? 0, saturation: light.saturation ?? 100 },
        end: { hue: ((light.hue ?? 0) + 180) % 360, saturation: 100 }, duration: 3000, repeat: 'alternate',
      });
      return drafts.get(light.id);
    };
    let editing = false;
    const update = () => { if (allowed(current())) void apply(current().id, true, structuredClone(draft())); };
    const wheels = ['start', 'end'].map(endpoint => attachWheel(get(endpoint), color => {
      draft()[endpoint] = color;
    }, () => allowed(current()), (active, cancelled) => {
      editing = active;
      if (!active && !cancelled) update();
    }));
    get('mode').onclick = () => { if (!allowed(current())) return; select(current().id); update(); };
    get('speed').onchange = () => { draft().duration = Number(get('speed').value); update(); };
    get('repeat').onchange = () => { draft().repeat = get('repeat').value; update(); };
    return {
      render() {
        const light = current(); if (!light) return;
        if (light.gradient && !editing && !pending()) drafts.set(light.id, structuredClone(light.gradient));
        const config = draft();
        if (!editing) {
          wheels[0].draw(config.start.hue, config.start.saturation);
          wheels[1].draw(config.end.hue, config.end.saturation);
          get('speed').value = config.duration; get('repeat').value = config.repeat;
        }
      },
      lock() {
        const disabled = !allowed(current());
        for (const suffix of ['mode','speed','repeat']) get(suffix).disabled = disabled;
        for (const suffix of ['start','end']) get(suffix).setAttribute('aria-disabled', String(disabled));
      },
    };
  });
  return { render() { controls.forEach(control => control.render()); }, lock() { controls.forEach(control => control.lock()); } };
}
