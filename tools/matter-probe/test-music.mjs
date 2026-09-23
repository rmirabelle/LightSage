import assert from 'node:assert/strict';
import { Music } from './music.mjs';
import { Bulb } from './bulb.mjs';
import { audioLevel } from './web/audio-level.js';

const sound = new Float32Array(1024).fill(0.025);
assert.equal(audioLevel(new Float32Array(1024),50),0);
assert(audioLevel(sound,80)>audioLevel(sound,20),'sensitivity directly changes phone meter level');
assert.equal(audioLevel(new Float32Array(10).fill(1),100),1);
assert(audioLevel(sound,50,0)>0,'attack appears in the first sample');
assert(audioLevel(new Float32Array(10),50,1,90)<0.4,'release decays promptly');

let now=1000, slow=false, fail=false, release;
const writes=[],restores=[];
const lighting={settings:{lights:{a:{name:'A'},b:{name:'B'}}},serial:fn=>fn(),bulb:async id=>({
  raw:async()=>({on:id==='a',level:200}),
  musicLevel:async level=>{
    writes.push([id,level]);
    if(fail && id==='b') throw Error('Offline');
    if(slow && id==='a') await new Promise(resolve=>{release=resolve;});
  },
  setLevel:async level=>restores.push([id,level]),
  power:{on:async()=>restores.push([id,'on']),off:async()=>restores.push([id,'off'])},
})};
const music=new Music(lighting,{now:()=>now});
const started=await music.start('room',['a','b']);
assert.equal(started.bulbs,2);
const frame=(sequence,level)=>music.frame({token:started.token,sequence,level});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
slow=true;frame(0,0.2);await flush();
frame(1,0.4);frame(2,1);await flush();
assert.equal(writes.filter(([id])=>id==='a').length,1,'slow bulb has only one operation in flight');
assert(writes.filter(([id])=>id==='b').length>1,'healthy bulb continues independently');
assert.equal(frame(1,0).accepted,false,'out-of-order packets are ignored');
slow=false;release();await flush();
assert.deepEqual(writes.filter(([id])=>id==='a').at(-1),['a',200],'slow bulb receives newest value, not backlog');
assert.throws(()=>music.frame({token:'old',sequence:3,level:1}),/ended/);
assert.throws(()=>frame(3,NaN),/Invalid/);
slow=true;frame(3,0.1);await flush();frame(4,0.7);now+=400;
const count=writes.filter(([id])=>id==='a').length;
slow=false;release();await flush();
assert.equal(writes.filter(([id])=>id==='a').length,count,'stale pending levels expire');
fail=true;frame(5,0.9);await flush();assert.equal(music.state('b'),null);assert(music.state('a'));
slow=true;frame(6,0.2);await flush();
let done=false;const stopping=music.stop(['a']).then(()=>{done=true;});
await flush();assert.equal(done,false,'stop waits for a sent command before restoring');
slow=false;release();await stopping;
assert.deepEqual(restores,[['a',200],['a','on']]);
assert.equal(music.token,null);music.close();
// A phone that disappears cannot leave an unattended music session running.
fail=false;
await music.start('room',['a','b']);
now+=3000;
await new Promise(resolve=>setTimeout(resolve,550));
assert.equal(music.token,null,'inactivity expires the microphone session');
assert.equal(music.bulbs.size,0);
assert(restores.some(([id,value])=>id==='b' && value==='off'),'restore a bulb that was originally off');
music.close();
let sent;
await Bulb.prototype.musicLevel.call({level:{moveToLevelWithOnOff:async request=>{sent=request;}}},100);
assert.deepEqual(sent,{level:100,transitionTime:0,optionsMask:{executeIfOff:true},optionsOverride:{executeIfOff:true}});
console.log('PASS: local sensitivity, immediate attack, latest-only per-bulb updates, stale rejection, failure isolation, stop ordering, restoration, and single-command brightness.');
