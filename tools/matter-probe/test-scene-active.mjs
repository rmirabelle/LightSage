import assert from 'node:assert/strict';
import { matchesSceneLight, scenes } from './scenes.mjs';
const raw = { on: true, level: 160, mode: 0, hue: 70, saturation: 200 };
const saved = { raw, gradient: null };
const light = { id: '1', available: true, raw: { ...raw } };
assert(matchesSceneLight(saved, light));
for (const change of [{ on: false }, { level: 159 }, { hue: 71 }, { saturation: 199 }, { mode: 2 }]) {
  assert.equal(matchesSceneLight(saved, { ...light, raw: { ...raw, ...change } }), false);
}
for (const change of [{ available: false }, { fullWhite: true }, { music: {} }]) {
  assert.equal(matchesSceneLight(saved, { ...light, ...change }), false);
}
const gradient = { start: { hue: 10, saturation: 90 }, end: { hue: 240, saturation: 80 }, duration: 3000, repeat: 'alternate' };
assert(matchesSceneLight({ raw, gradient }, { ...light, gradient, raw: { ...raw, hue: 150 } }), 'Gradient phase may move while the saved scene remains active');
assert.equal(matchesSceneLight({ raw, gradient }, { ...light, gradient: { ...gradient, duration: 1000 } }), false);
const context = { settings: { scenes: { s: { id: 's', target: 'room', lights: { '1': saved } } }, groups: { room: { members: ['1'] } } } };
assert.equal(scenes.sceneList.call(context, [light])[0].active, true);
context.settings.sceneSelections = {room:'s'};
const changed = {...light,raw:{...raw,level:20}};
assert.equal(scenes.sceneList.call(context,[changed])[0].dirty,true);
assert.equal(scenes.sceneList.call(context,[light])[0].dirty,false);
assert.equal(scenes.sceneList.call(context,[{...light,available:false}])[0].dirty,false,'Offline is not an edit');
context.settings.scenes.new = {id:'new',target:'room',lights:{'1':{raw:changed.raw}}};
context.settings.sceneSelections.room = 'new';
assert(scenes.sceneList.call(context,[changed]).every(scene=>!scene.dirty),'Saving as a new scene clears the former dirty marker');
context.settings.scenes.new.lights['1'].raw={...raw};
assert.equal(scenes.sceneList.call(context,[changed]).find(s=>s.id==='new').dirty,true);
context.settings.scenes.new.lights['1'].raw={...changed.raw};
assert.equal(scenes.sceneList.call(context,[changed]).find(s=>s.id==='new').dirty,false,'Overwriting clears dirty');
context.settings.groups.room.members.push('2');
assert.equal(scenes.sceneList.call(context, [light])[0].active, false);
context.settings.scenes.s.target='all-rooms';
context.settings.sceneSelections['all-rooms']='s';
context.nodeIds=new Map([['1',1n],['2',2n]]);
let night=scenes.sceneList.call(context,[changed]).find(s=>s.id==='s');
assert(night.membershipChanged && night.dirty,'Saved light changes remain dirty with an extra light');
night=scenes.sceneList.call(context,[light]).find(s=>s.id==='s');
assert(night.membershipChanged && night.active && !night.dirty,'Restored saved lights are clean even if the new light is offline');
console.log('PASS: active scene tracks current color, power, brightness, gradient configuration, availability, and membership.');
