import assert from 'node:assert/strict';
import { AdjustmentQueue } from './web/adjustment-queue.js';
const calls = [], releases = [], changes = [], idle = [], errors = [];
const queue = new AdjustmentQueue({
  execute: request => { calls.push(request); return new Promise((resolve,reject) => releases.push({resolve,reject})); },
  changed: value => changes.push(value), idle: value => idle.push(value), failed: error => errors.push(error),
});
const next = () => new Promise(resolve => setImmediate(resolve));
const initial = {target:'room',brightness:10};
const first = queue.enqueue(initial,'room:brightness');
initial.brightness=99;
const second=queue.enqueue({target:'room',brightness:20},'room:brightness');
const third=queue.enqueue({target:'room',brightness:30},'room:brightness');
const mode=queue.enqueue({target:'room',mode:'white'});
const later=queue.enqueue({target:'bulb',brightness:40},'bulb:brightness');
assert.deepEqual(calls,[{target:'room',brightness:10}],'snapshot the target and values at enqueue time');
assert.equal(queue.pending,true);
releases.shift().resolve('first'); await next();
assert.deepEqual(calls[1],{target:'room',brightness:30},'replace only adjacent unsent values');
releases.shift().resolve('latest brightness'); await next();
assert.deepEqual(calls[2],{target:'room',mode:'white'},'mode changes remain ordering barriers');
releases.shift().resolve('white'); await next();
assert.deepEqual(calls[3],{target:'bulb',brightness:40});
releases.shift().resolve('final'); await Promise.all([first,second,third,mode,later]); await next();
assert.deepEqual(idle,['final'],'publish only the final state after draining');
assert.equal(queue.pending,false);assert.equal(changes.at(-1),false);
const disconnected=Object.assign(Error('Disconnected'),{disconnected:true});
const failing=queue.enqueue({power:false});const cancelled=queue.enqueue({power:true});
releases.shift().reject(disconnected);await Promise.all([failing,cancelled]);await next();
assert.equal(calls.length,5,'do not replay queued changes after disconnection');
assert.deepEqual(errors,[disconnected]);assert.equal(queue.pending,false);
const retry=queue.enqueue({power:false});releases.shift().resolve('recovered');await retry;await next();
assert.equal(idle.at(-1),'recovered');
console.log('PASS: ordered adjustments, target snapshots, adjacent coalescing, final-state publication, disconnect cancellation, and recovery.');
