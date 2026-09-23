import assert from 'node:assert/strict';
import { Lighting } from './lighting.mjs';
const lighting = new Lighting();
lighting.nodeIds = new Map([['1', 1n], ['2', 2n], ['3', 3n]]);
lighting.settings = { lights: Object.fromEntries(['1','2','3'].map(id => [id, {name:id,restore:null,owner:null}])), groups: { room: {name:'Room',members:['1','2','3']} } };
const states = new Map([['1',true],['2',false],['3',true]]);
const missing = new Set(['3']);
const writes = [];
lighting.catalogRead = async id => {
  if (missing.has(id)) throw new Error('Unavailable');
  return {id, name:id, available:true, on:states.get(id)};
};
lighting.bulb = async id => ({power:{
  on:async()=>{writes.push([id,true]);states.set(id,true);},
  off:async()=>{writes.push([id,false]);states.set(id,false);},
}});
let catalog = await lighting.catalog();
assert.equal(catalog.groups[0].on,true,'mixed room is on when any reachable bulb is on');
assert.equal(catalog.allRooms.on,true);
const result = await lighting.command({target:'room',type:'power',on:!catalog.groups[0].on});
assert.deepEqual(writes,[['1',false],['2',false]],'first toggle sends off to every reachable bulb');
assert.equal(result.state.groups[0].on,false,'unreachable bulb does not keep room on');
assert.equal(result.state.allRooms.on,false);
await lighting.command({target:'room',type:'power',on:!result.state.groups[0].on});
assert.equal((await lighting.catalog()).groups[0].on,true,'all-off room toggles on');
missing.add('1');missing.add('2');
assert.equal((await lighting.catalog()).groups[0].on,null,'no responding bulbs has unknown power');
console.log('PASS: mixed room first-click off, all-off toggle on, ALL ROOMS, and unavailable bulbs.');
