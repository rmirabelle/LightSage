import assert from 'node:assert/strict';
import { Lighting } from './lighting.mjs';
const lighting = new Lighting();
lighting.nodeIds = new Map([['1',1n],['2',2n]]);
const saved = {on:true,level:90,mode:2,mireds:300};
lighting.settings = {lights:{'1':{name:'Missing',restore:{...saved},owner:'all-rooms'},'2':{name:'Online',restore:null,owner:null}},groups:{room:{name:'Room',members:['1','2']}}};
lighting.save = async () => {};
let online = false, writes = [];
for(const id of ['1','2']) {
  let state = {...saved};
  const write = (kind, patch) => { writes.push([id,kind]); Object.assign(state,patch); };
  lighting.bulbs.set(id,{
    raw:async()=>{if(id==='1'&&!online) throw new Error('Offline'); return {...state};},
    read:async()=>{if(id==='1'&&!online) throw new Error('Offline'); return {id,name:lighting.settings.lights[id].name,on:state.on,brightness:state.level,colorMode:state.mode,hue:state.hue,saturation:state.saturation};},
    setLevel:async value=>write('brightness',{level:value}),
    setWhite:async value=>write('white',{mode:2,mireds:value}),
    setColor:async(hue,saturation)=>write('color',{mode:0,hue,saturation}),
    power:{on:async()=>write('on',{on:true}),off:async()=>write('off',{on:false})},
    restore:async value=>write('restore',value),
  });
}
let catalog = await lighting.catalog();
assert.equal(catalog.allRooms.available,true);
assert.equal(catalog.groups[0].available,true);
assert.equal(catalog.allRooms.brightness,90);
assert.equal(catalog.allRooms.fullWhite,false,'offline override must not disable responding bulbs');
for(const command of [{type:'brightness',value:50},{type:'color',hue:120,saturation:80},{type:'temperature',value:4400},{type:'power',on:false}]) {
 const result = await lighting.command({target:'room',...command});
 assert(result.outcomes.find(item=>item.id==='1').skipped);
 assert(result.outcomes.find(item=>item.id==='2').ok);
}
await lighting.command({target:'all-rooms',type:'fullWhite',enabled:true});
await lighting.command({target:'all-rooms',type:'fullWhite',enabled:false});
assert(writes.every(([id])=>id==='2'));
assert.deepEqual(lighting.settings.lights['1'].restore,saved,'offline restore snapshot survives');
online=true;
catalog=await lighting.catalog();
assert.equal(catalog.allRooms.fullWhite,true);
await lighting.command({target:'all-rooms',type:'fullWhite',enabled:false});
assert.equal(lighting.settings.lights['1'].restore,null);
assert(writes.some(([id,kind])=>id==='1'&&kind==='restore'));
console.log('PASS: partial room controls, offline skips, Full White snapshot preservation, and recovered bulb restore.');
