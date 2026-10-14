import assert from 'node:assert/strict';
import { BasicInformation } from '@matter/types/clusters';
import { shareOfflineClusterReads } from './matter-fixes.mjs';

let references = 0;
class ClusterState {
  constructor(name) { this.name = name; }
  readState(session) { references++; return { cluster: this.name, session }; }
}
const peer = name => ({ protocol: { 0: { [BasicInformation.id]: new ClusterState(name) } } });
const [one, two] = [peer('one'), peer('two')];
const cluster = value => value.protocol[0][BasicInformation.id];

assert.equal(shareOfflineClusterReads([]), false, 'No paired light yet: nothing to fix');
assert.equal(shareOfflineClusterReads([{ protocol: undefined }, one, two]), true);
assert.equal(shareOfflineClusterReads([one]), false, 'Install the fix only once');

const first = cluster(one).readState({});
for (let i = 0; i < 1000; i++) assert.equal(cluster(one).readState({}), first);
assert.equal(references, 1, 'Reads without a transaction share one reference per cluster');
assert.equal(cluster(two).readState({}).cluster, 'two', 'Each light keeps its own state');
assert.equal(references, 2);

const transaction = {};
assert.equal(cluster(one).readState({ transaction }).session.transaction, transaction, 'Reads with a transaction are unchanged');
cluster(one).readState({ transaction });
cluster(one).readState({ fabric: 1 });
assert.equal(references, 5, 'Reads with a transaction or other session data are not shared');
console.log('PASS: Matter reads without a transaction share one reference per cluster instead of leaking one per read.');
