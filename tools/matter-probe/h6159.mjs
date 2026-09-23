import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const stripCapabilities = Object.freeze({ temperature:false, fullWhite:false, gradient:false, music:false, identify:false });
export function bleRequest(request) {
  return new Promise((resolve, reject) => {
    const python = process.env.LIGHTSAGE_BLE_PYTHON || fileURLToPath(new URL('./.ble-venv/Scripts/python.exe', import.meta.url));
    const child = spawn(python, [fileURLToPath(new URL('./h6159-ble.py', import.meta.url))], {windowsHide:true, stdio:['pipe','pipe','pipe']});
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(Error('Bluetooth request timed out.')); }, 19000);
    child.stdout.on('data', data => { output += data; });
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.on('error', () => { clearTimeout(timer); reject(Error('Bluetooth helper unavailable. Install the documented Python Bluetooth runtime.')); });
    child.on('close', () => {
      clearTimeout(timer);
      try { const value = JSON.parse(output); if (value.error) throw Error(value.error); resolve(value.result); }
      catch (error) { reject(Error(error.message || 'Bluetooth helper failed.')); }
    });
    child.stdin.end(JSON.stringify(request));
  });
}
export function rgbToRaw(value) {
  const [r,g,b] = value.rgb.map(v=>v/255), max = Math.max(r,g,b), min = Math.min(r,g,b), d = max-min;
  let h = !d ? 0 : max===r ? ((g-b)/d+6)%6 : max===g ? (b-r)/d+2 : (r-g)/d+4;
  return {on:value.on, level:Math.round(value.brightnessByte/255*254), mode:value.mode===2?0:null,
    hue:Math.round(h/6*254), saturation:Math.round((max?d/max:0)*254), ble:structuredClone(value)};
}
export function hsvToRgb(hue, saturation) {
  const h = (hue%360)/60, s = saturation/100, x = 1-Math.abs(h%2-1);
  return ([[1,x,0],[x,1,0],[0,1,x],[0,x,1],[x,0,1],[1,0,x]][Math.floor(h)]).map(v=>Math.round((v*s+1-s)*255));
}
export class H6159 {
  tail = Promise.resolve();
  constructor(id, record, request = bleRequest) {
    this.id=id; this.record=record; this.name=record.name; this.request=request;
    this.power={on:()=>this.send('power',{on:true}),off:()=>this.send('power',{on:false})};
  }
  send(action, data={}) {
    const pending=this.tail.then(()=>this.request({address:this.record.address,action,...data}));
    this.tail=pending.catch(()=>{}); return pending;
  }
  async raw() { return rgbToRaw(await this.send('read')); }
  async read() {
    const raw=await this.raw();
    return {id:this.id,name:this.name,model:'H6159',transport:'bluetooth',capabilities:stripCapabilities,
      on:raw.on,brightness:Math.round(raw.ble.brightnessByte/255*100),kelvin:null,colorMode:raw.mode,
      hue:raw.mode===0?raw.hue/254*360:null,saturation:raw.mode===0?raw.saturation/254*100:null,
      fullWhite:false,observedAt:new Date().toISOString(),raw};
  }
  async setLevel(level) { await this.send('brightness',{value:Math.round(level/254*255)}); }
  async setColor(hue,saturation) { await this.send('color',{rgb:hsvToRgb(hue,saturation)}); }
  async restore(raw) {
    const s=raw?.ble;
    if (raw?.mode!==0 || s?.mode!==2 || typeof s.on!=='boolean' || !Number.isInteger(s.brightnessByte) || s.brightnessByte<0 || s.brightnessByte>255 || !Array.isArray(s.rgb) || s.rgb.length!==3 || s.rgb.some(v=>!Number.isInteger(v)||v<0||v>255)) throw Error('Invalid H6159 solid-color snapshot.');
    await this.send('restore',{state:{on:s.on,mode:2,brightnessByte:s.brightnessByte,rgb:s.rgb}});
  }
  async details() { return {nodeId:this.id,fields:{vendorName:'Govee',productName:'H6159',serialNumber:this.record.address},addresses:[],partial:false}; }
}
