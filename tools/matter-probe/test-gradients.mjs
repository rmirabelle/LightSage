import assert from 'node:assert/strict';
import { Gradients, gradientConfig } from './gradients.mjs';
import { Bulb } from './bulb.mjs';
import { Lighting } from './lighting.mjs';

const config = gradientConfig({start:{hue:0,saturation:100},end:{hue:180,saturation:80},duration:300,repeat:'alternate'});
for (const duration of [0, 299, '300', Infinity]) assert.throws(() => gradientConfig({...config,duration}));
assert.throws(() => gradientConfig({...config,repeat:'invalid'}));
assert.throws(() => gradientConfig({...config,start:{hue:NaN,saturation:20}}));
const calls = [], timers = new Set();
let failing;
const lighting = {
  settings: {lights:{a:{name:'A'},b:{name:'B'}}},
  bulb:async id => ({
    setColor:async(h,s)=>{ if (id===failing) throw Error('Offline'); calls.push([id,h,s,0]); },
    transitionColor:async(h,s,d)=>{ if (id===failing) throw Error('Offline'); calls.push([id,h,s,d]); },
    stopColorTransition:async()=>calls.push([id,'stop']),
  }),
};
const engine = new Gradients(lighting, {schedule:(fn,ms)=>{const timer={fn,ms};timers.add(timer);return timer;},cancel:timer=>timers.delete(timer)});
async function tick() {
  const timer = timers.values().next().value; assert(timer); timers.delete(timer);
  timer.fn(); await Promise.all([...engine.jobs].map(job=>job.pending));
}
await engine.start('room',['a','b'],config);
assert.deepEqual(calls,[['a',0,100,0],['b',0,100,0],['a',180,80,300],['b',180,80,300]]);
assert.equal(timers.size,1);
assert.equal([...timers][0].ms,300);
await tick(); assert.deepEqual(calls.slice(-2),[['a',0,100,300],['b',0,100,300]]);
await engine.stop(['a']);
assert.equal(engine.state('a'),null); assert(engine.state('b'));
await tick(); assert.deepEqual(calls.at(-1),['b',180,80,300]);
await engine.stop(['b']); assert.equal(timers.size,0);
await engine.start('a',['a'],{...config,repeat:'forward'});
await tick(); assert.deepEqual(calls.slice(-2),[['a',0,100,0],['a',180,80,300]]);
await engine.stop(['a']);
failing='b'; await engine.start('room',['a','b'],config);
assert(engine.state('a')); assert.equal(engine.state('b'),null); assert.match(engine.errors.get('b'),/Offline/);
engine.close(); assert.equal(timers.size,0);

// Stop must wait for an already-sent leg before allowing replacement commands.
let release;
failing=undefined;
await engine.start('a',['a'],config);
lighting.bulb=async()=>({transitionColor:()=>new Promise(resolve=>{release=resolve;}),stopColorTransition:async()=>calls.push(['stopped'])});
const timer=[...timers][0]; timers.delete(timer); timer.fn();
await new Promise(resolve=>setImmediate(resolve));
let stopped=false;
const stop=engine.stop(['a']).then(()=>{stopped=true;});
await new Promise(resolve=>setImmediate(resolve)); assert.equal(stopped,false);
release(); await stop; assert.equal(stopped,true); assert.equal(timers.size,0);

let request;
await Bulb.prototype.transitionColor.call({color:{moveToHueAndSaturation:async value=>{request=value;}}},180,50,300);
assert.equal(request.transitionTime,3); assert.equal(request.hue,127); assert.equal(request.saturation,127);
const instance=new Lighting();
instance.nodeIds=new Map([['a',1n]]);instance.settings={lights:{a:{name:'A',restore:{},owner:'a'}},groups:{}};
await assert.rejects(instance.gradient({target:'a',enabled:true,...config}),/Restore Full White/);
console.log('PASS: gradient timing, both repeat modes, parallel bulbs, partial stops, failure isolation, cancellation races, validation, and native transition units.');
