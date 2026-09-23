import assert from 'node:assert/strict';
import { Bulb } from './bulb.mjs';
import { Lighting } from './lighting.mjs';

const bulb = Object.create(Bulb.prototype);
bulb.id = '17';
let reads = 0;
bulb.node = {
  getRootClusterClient: () => ({
    getVendorNameAttribute: async fresh => { assert.equal(fresh, true); reads++; return 'Test manufacturer'; },
    getProductNameAttribute: async () => 'Reported model',
    getVendorIdAttribute: async () => 0,
    getSerialNumberAttribute: async () => '',
    getSoftwareVersionStringAttribute: async () => { throw Error('Read failed'); },
  }),
  state: { commissioning: { addresses: [
    { ip: '192.0.2.5', port: 5540, healthyAt: 1 },
    { type: 'ble', peripheralAddress: 'not-an-ip' },
  ] } },
};
const details = await bulb.details();
assert.equal(reads, 1);
assert.deepEqual(details, {
  nodeId: '17', fields: { vendorName: 'Test manufacturer', productName: 'Reported model', vendorId: 0 },
  addresses: [{ ip: '192.0.2.5', port: 5540 }], partial: true,
});
bulb.node = { getRootClusterClient: () => undefined };
assert.deepEqual(await bulb.details(), { nodeId: '17', fields: {}, addresses: [], partial: false });
console.log('PASS: reads reported identity, omits absent fields, retains partial results and only exposes IP/port metadata.');
const lighting = new Lighting();
lighting.nodeIds = new Map([['17',17n]]);
lighting.settings = {lights:{'17':{name:'Test'}},groups:{}};
let detailReads=0, stored, partial=false, failed=false;
lighting.save=async()=>{stored=structuredClone(lighting.settings);};
lighting.bulbs.set('17',{details:async()=>{
  detailReads++;
  if(failed) throw Error('Unavailable');
  return {nodeId:'17',fields:{productName:'Model',softwareVersion:detailReads},addresses:[],partial};
}});
const first=await lighting.details('17');
first.fields.productName='Mutated';
assert.equal((await lighting.details('17')).fields.productName,'Model');
assert.equal(detailReads,1);
const restarted=new Lighting(); restarted.nodeIds=lighting.nodeIds; restarted.settings=stored;
restarted.bulb=async()=>{throw Error('Should not connect');};
assert.equal((await restarted.details('17')).fields.productName,'Model','Cache survives restart and works without the device');
partial=true; await lighting.details('17',true); await lighting.details('17');
assert.equal(detailReads,2,'Partial responses are cached without another read');
partial=false; await lighting.details('17',true);
assert.equal((await lighting.details('17')).fields.softwareVersion,3);
failed=true; await assert.rejects(lighting.details('17',true),/Unavailable/);
assert.equal((await lighting.details('17')).fields.softwareVersion,3);
delete lighting.settings.lights['17'].details; failed=false; partial=true;
await lighting.details('17'); await lighting.details('17');
assert.equal(detailReads,5,'Partial initial details are cached');
assert.equal(stored.lights['17'].details.partial,true);
delete lighting.settings.lights['17'].details;
partial=false;
await Promise.all([lighting.details('17'),lighting.details('17')]);
assert.equal(detailReads,6,'Concurrent cold reads share the saved result');
await assert.rejects(lighting.details('missing'),/known light/);
console.log('PASS: persistent details cache, instant cached reads, refresh, failure preservation, partial caching and concurrent requests.');
