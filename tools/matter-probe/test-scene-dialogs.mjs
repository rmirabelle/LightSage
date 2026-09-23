import assert from 'node:assert/strict';
import {sceneControls} from './web/scene-controls.js';
class Element {
  children=[]; dataset={}; attrs={}; open=false; textContent='';
  classList={toggle(){}};
  constructor(tag){this.tag=tag;}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes;}
  before(node){document.body.append(node);}
  setAttribute(k,v){this.attrs[k]=v;}
  addEventListener(){} focus(){} setCustomValidity(){} reportValidity(){}
  showModal(){this.open=true;} close(){this.open=false;}
  querySelectorAll(selector){return this.children.flatMap(n=>[...(selector==='[data-scene-id]'?n.dataset.sceneId?[n]:[]:selector.split(',').includes(n.tag)?[n]:[]),...n.querySelectorAll(selector)]);}
}
globalThis.document={body:new Element('body'),createElement:t=>new Element(t),getElementById:()=>new Element('div')};
let catalog={groups:[{id:'room',name:'Room',members:[{}]}],scenes:[{id:'s',name:'Evening',target:'room',count:1,dirty:true}]};
const calls=[];
const ui=sceneControls({getCatalog:()=>catalog,getTarget:()=>'room',allowed:()=>true,perform:async c=>{
  calls.push(c);
  if(c.type==='create') catalog.scenes=[{...catalog.scenes[0],dirty:false},{id:'new',name:c.name,target:c.target,count:1,active:true,dirty:false}];
  if(c.type==='apply') catalog.scenes[0].dirty=false;
  if(c.type==='replace') Object.assign(catalog.scenes[0],{dirty:false,membershipChanged:false,active:true});
  return {outcomes:[{id:'1',ok:true}],state:catalog};
}});
const all=()=>{const walk=n=>[n,...n.children.flatMap(walk)];return walk(document.body);};
const text=n=>n.textContent+n.children.map(text).join('');
const click=label=>{const n=all().find(n=>n.tag==='button'&&text(n)===label);assert(n,`Missing button ${label}`);n.onclick();};
const settle=()=>new Promise(r=>setImmediate(r));
ui.render();click('Evening*');
assert.equal(calls.length,0);
click('Cancel');assert.equal(calls.length,0);
click('Evening*');click('Save as new scene');
const form=all().find(n=>n.tag==='form');all().find(n=>n.id==='scene-name').value='Evening soft';
form.onsubmit({preventDefault(){}});await settle();
assert.equal(calls[0].type,'create');assert.equal(calls[0].target,'room');
assert(!all().some(n=>n.className==='scene-dirty'));
assert(!all().find(n=>n.id==='scene-feedback').open,'Save success is silent');
const beforeActiveClick=calls.length;
click('Evening soft');await settle();
assert.equal(calls.length,beforeActiveClick,'Clicking an active unchanged scene sends no command');
assert(!all().some(n=>n.tag==='dialog'&&n.open),'Clicking an active unchanged scene opens no dialog');
catalog.scenes[0].dirty=true;ui.render();click('Evening*');click('Discard changes');await settle();
assert.equal(calls[1].type,'apply');assert(!all().find(n=>n.id==='scene-feedback').open,'Apply success is silent');
all().find(n=>n.attrs['aria-label']==='Edit Evening').onclick();click('Delete scene');
assert.equal(calls.length,2,'Opening delete confirmation does not delete');
click('Cancel');assert.equal(calls.length,2);
catalog.scenes=[{id:'night',name:'Night',target:'room',count:20,dirty:false,membershipChanged:true}];
ui.render();
assert(all().some(n=>n.tag==='button'&&text(n)==='Night'),'Membership alone is not unsaved settings');
catalog.scenes[0].dirty=true;ui.render();
all().find(n=>n.attrs['aria-label']==='Edit Night').onclick();
assert(all().some(n=>n.className==='scene-membership-note'&&text(n)==='One or more lights have changed.'));
const beforeApply=calls.length;
click('Night*');await settle();
assert.equal(calls.length,beforeApply,'A marked Night scene must prompt before applying');
click('Discard changes');await settle();
assert.equal(calls.at(-1).type,'apply');
assert(!all().some(n=>n.className==='scene-dirty'),'Restoring Night clears the marker even with an added light');
all().find(n=>n.attrs['aria-label']==='Edit Night').onclick();
assert(!all().some(n=>n.className==='scene-membership-note'),'Restoring Night clears the notice');
all().find(n=>n.attrs['aria-label']==='Edit Night').onclick();click('Overwrite');click('Overwrite');await settle();
assert.equal(calls.at(-1).type,'replace');
assert(!all().some(n=>n.className==='scene-dirty'),'Overwrite clears the membership marker');
all().find(n=>n.attrs['aria-label']==='Edit Night').onclick();
assert(!all().some(n=>n.className==='scene-membership-note'),'Overwrite clears the notice');
console.log('PASS: dirty-scene protection, silent success, delete confirmation, membership notice and marker consistency, and overwrite clearing.');
