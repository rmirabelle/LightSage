export function wheelColor(x, y) {
  return { hue: (Math.atan2(y, x) * 180 / Math.PI + 360) % 360, saturation: Math.min(100, Math.hypot(x, y) * 100) };
}
export function hsvRgb(hue, saturation) {
  const c = saturation, h = hue / 60, x = c * (1 - Math.abs(h % 2 - 1)), m = 1 - c;
  const rgb = h < 1 ? [c,x,0] : h < 2 ? [x,c,0] : h < 3 ? [0,c,x] : h < 4 ? [0,x,c] : h < 5 ? [x,0,c] : [c,0,x];
  return rgb.map(v => Math.round((v + m) * 255));
}
export function attachWheel(canvas, onChange, allowed, interaction) {
  const size = canvas.width, center = size / 2, radius = center - 10;
  const base = document.createElement('canvas'); base.width = base.height = size;
  const ctx = base.getContext('2d'), data = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const color = wheelColor((x-center)/radius, (y-center)/radius);
    if (Math.hypot(x-center,y-center) > radius) continue;
    const offset = (y * size + x) * 4;
    data.data.set([...hsvRgb(color.hue, color.saturation/100),255], offset);
  }
  ctx.putImageData(data,0,0);
  let hue = 0, saturation = 100, dragging = false;
  function drawPoints(points) {
    const context = canvas.getContext('2d'); context.clearRect(0,0,size,size); context.drawImage(base,0,0);
    const colors = points.filter(color => Number.isFinite(color.hue) && Number.isFinite(color.saturation));
    for (const color of colors) {
      const angle = color.hue * Math.PI/180, distance = color.saturation/100*radius;
      context.beginPath(); context.arc(center+Math.cos(angle)*distance,center+Math.sin(angle)*distance,8,0,2*Math.PI);
      context.fillStyle = `rgb(${hsvRgb(color.hue,color.saturation/100).join(',')})`; context.fill();
      context.strokeStyle = '#222612'; context.lineWidth = 5; context.stroke(); context.strokeStyle = '#fff'; context.lineWidth = 2; context.stroke();
    }
    if (colors.length === 1) {
      ({hue, saturation} = colors[0]);
      canvas.setAttribute('aria-valuenow',String(Math.round(hue)));
      canvas.setAttribute('aria-valuetext',`Hue ${Math.round(hue)} degrees, saturation ${Math.round(saturation)} percent`);
    } else {
      canvas.removeAttribute('aria-valuenow');
      canvas.setAttribute('aria-valuetext',colors.length ? `${colors.length} different colors` : 'Color unavailable');
    }
  }
  function draw(h = hue, s = saturation) { drawPoints([{hue:h, saturation:s}]); }
  const change = event => {
    const bounds = canvas.getBoundingClientRect();
    const color = wheelColor(((event.clientX-bounds.left)/bounds.width*size-center)/radius,((event.clientY-bounds.top)/bounds.height*size-center)/radius);
    draw(color.hue,color.saturation); onChange(color);
  };
  canvas.onpointerdown = event => { if (!allowed()) return; dragging = true; interaction(true); canvas.setPointerCapture(event.pointerId); change(event); };
  canvas.onpointermove = event => { if (dragging) change(event); };
  canvas.onpointerup = event => { if (!dragging) return; change(event); dragging = false; interaction(false); };
  canvas.onpointercancel = canvas.onlostpointercapture = () => { if (dragging) { dragging = false; interaction(false, true); } };
  canvas.onkeydown = event => {
    if (!allowed() || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    interaction(true);
    draw((hue + (event.key === 'ArrowRight' ? 5 : event.key === 'ArrowLeft' ? -5 : 0) + 360)%360,Math.max(0,Math.min(100,saturation+(event.key==='ArrowUp'?5:event.key==='ArrowDown'?-5:0))));
    onChange({hue,saturation});
    interaction(false);
  };
  draw(null,null); return { draw, drawPoints, get dragging() { return dragging; } };
}

export function distinctWheelColors(lights) {
  const colors = new Map();
  for (const light of lights) {
    if (!light.available || !Number.isFinite(light.hue) || !Number.isFinite(light.saturation)) continue;
    const saturation = light.saturation;
    const hue = saturation === 0 ? 0 : (light.hue % 360 + 360) % 360;
    colors.set(`${hue.toFixed(2)}:${saturation.toFixed(2)}`, {hue,saturation});
  }
  return [...colors.values()];
}
