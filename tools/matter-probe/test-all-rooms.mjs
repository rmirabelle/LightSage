import assert from 'node:assert/strict';
import { Lighting } from './lighting.mjs';
import { Bulb, observedColor } from './bulb.mjs';
import { wheelColor, hsvRgb, distinctWheelColors } from './web/color-wheel.js';
const lighting = new Lighting();
lighting.nodeIds = new Map([['1',1n],['2',2n],['3',3n]]);
lighting.settings = { version:2, lights:{}, groups:{dining:{name:'Dining',members:['1','2']}} };
lighting.save = async () => {};
const originals = new Map();
for (const id of lighting.nodeIds.keys()) {
  const record = lighting.settings.lights[id] = {name:`Light ${id}`,restore:null,owner:null};
  let state = {on:true,level:100+Number(id),mode:2,mireds:300+Number(id)};
  originals.set(id,structuredClone(state));
  lighting.bulbs.set(id,{
    raw:async()=>structuredClone(state),
    read:async()=>({id,name:record.name,on:state.on,brightness:state.level/254*100,kelvin:1e6/state.mireds,colorMode:state.mode,fullWhite:!!record.restore,hue:state.hue,saturation:state.saturation}),
    setColor:async(hue,saturation)=>{Object.assign(state,{mode:0,hue,saturation});},
    setLevel:async level=>{state.level=level;}, setWhite:async mireds=>{state.mode=2;state.mireds=mireds;},
    power:{on:async()=>{state.on=true;},off:async()=>{state.on=false;}},
    restore:async saved=>{state=structuredClone(saved);},
  });
}
assert.deepEqual(lighting.members('all-rooms'),['1','2','3']);
assert.equal((await lighting.catalog()).allRooms.members.length,3);
assert.equal((await lighting.catalog()).groups.length,1);
const white=await lighting.command({target:'all-rooms',type:'fullWhite',enabled:true});
assert(white.outcomes.every(item=>item.ok));
assert.equal(white.state.allRooms.fullWhite,true);
assert(white.state.groups[0].blockedBy);
for(const id of lighting.nodeIds.keys()) assert.deepEqual(lighting.settings.lights[id].restore,originals.get(id));
await assert.rejects(lighting.command({target:'dining',type:'color',hue:120,saturation:100}),/existing override/);
await lighting.command({target:'all-rooms',type:'fullWhite',enabled:false});
for(const id of lighting.nodeIds.keys()) assert.deepEqual(await lighting.bulbs.get(id).raw(),originals.get(id));
const color=await lighting.command({target:'all-rooms',type:'color',hue:120,saturation:75});
assert(color.outcomes.every(item=>item.ok));
assert.equal(color.state.allRooms.colorMode,0); assert.equal(color.state.allRooms.hue,120);
for(const id of lighting.nodeIds.keys()) assert.equal((await lighting.bulbs.get(id).raw()).saturation,75);
for(const hue of [-1,361,NaN]) await assert.rejects(lighting.command({target:'all-rooms',type:'color',hue,saturation:80}),/Invalid command/);
await lighting.command({target:'all-rooms',type:'temperature',value:4400});
assert.equal((await lighting.catalog()).allRooms.colorMode,2);
await lighting.command({target:'all-rooms',type:'power',on:false});
assert.equal((await lighting.catalog()).allRooms.on,false);
let observed;
await Bulb.prototype.setColor.call({color:{moveToHueAndSaturation:async value=>{observed=value;},getColorModeAttribute:async()=>0,getCurrentHueAttribute:async()=>127,getCurrentSaturationAttribute:async()=>127}},180,50);
assert.equal(observed.hue,127); assert.equal(observed.saturation,127);
assert.deepEqual(hsvRgb(0,1),[255,0,0]); assert.deepEqual(hsvRgb(120,1),[0,255,0]);
assert.equal(wheelColor(0,-1).hue,270); assert.equal(wheelColor(0,0).saturation,0);
assert.deepEqual(observedColor({mode:0,hue:127,saturation:127}),{hue:180,saturation:50});
assert.deepEqual(observedColor({mode:2,mireds:227}),{hue:0,saturation:0});
assert.deepEqual(observedColor({mode:0,hue:255,saturation:254}),{hue:null,saturation:null});
const xy = observedColor({mode:1,x:45000,y:20000});
assert(xy.hue < 25 || xy.hue > 335); assert(xy.saturation > 80);
console.log('PASS: ALL ROOMS includes unassigned bulbs, color validation/conversion, group mode, override isolation, and per-bulb Restore.');

const colorBulb = (hue, saturation = 100) => ({ available: true, hue, saturation });
assert.deepEqual(distinctWheelColors([colorBulb(120), colorBulb(120)]), [{hue:120,saturation:100}]);
assert.equal(distinctWheelColors([colorBulb(120), colorBulb(240)]).length, 2);
assert.equal(distinctWheelColors([colorBulb(0), colorBulb(360)]).length, 1);
assert.deepEqual(distinctWheelColors([colorBulb(120,0), colorBulb(240,0)]), [{hue:0,saturation:0}]);
assert.deepEqual(distinctWheelColors([{available:false,hue:120,saturation:100},{available:true,hue:null,saturation:null}]), []);
console.log('PASS: identical room colors share one marker; mixed colors stay distinct; unknown states are excluded.');
