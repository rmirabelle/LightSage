import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('./web/app.js',import.meta.url),'utf8');
const nodes=new Map(),calls=[];
const context=vm.createContext({
  state:{available:true,fullWhite:true},selected:'dining-room',showingRoomLights:true,
  busy:false,managing:false,pairingActive:false,adjusting:false,connected:true,pendingFullWhite:new Set(),
  $:id=>{if(!nodes.has(id))nodes.set(id,{attrs:{},classList:{toggle(){}},setAttribute(k,v){this.attrs[k]=v;}});return nodes.get(id);},
  command:(body,target)=>calls.push({body,target}),startFullWhite:target=>calls.push({start:target}),
});
vm.runInContext(source.slice(source.indexOf('function updateFullWhiteButton()'),source.indexOf('function lock()')),context);
vm.runInContext(source.slice(source.indexOf("$('full-white').onclick"),source.indexOf("$('cancel-full-white').onclick")),context);
for(const list of [true,false]) {
  context.showingRoomLights=list; context.updateFullWhiteButton();
  assert.equal(nodes.get('full-white').disabled,false);
  assert.equal(nodes.get('room-restore-label').hidden,false);
  nodes.get('full-white').onclick();
  assert.equal(calls.at(-1).body.enabled,false); assert.equal(calls.at(-1).target,'dining-room');
}
context.state={available:false,fullWhite:true,capabilities:{fullWhite:false}};
context.updateFullWhiteButton();assert.equal(nodes.get('full-white').disabled,false,'Saved restore remains retryable when lights are offline');
context.connected=false;context.updateFullWhiteButton();assert.equal(nodes.get('full-white').disabled,true);
context.connected=true;context.state={available:true,fullWhite:false};context.updateFullWhiteButton();
assert.equal(nodes.get('room-restore-label').hidden,true);nodes.get('full-white').onclick();assert.equal(calls.at(-1).start,'dining-room');
context.pendingFullWhite.add('dining-room');context.updateFullWhiteButton();assert.equal(nodes.get('full-white').disabled,true);
console.log('PASS: room Full White restores from list and controls views; pending/disconnected locks and retry preserved.');
