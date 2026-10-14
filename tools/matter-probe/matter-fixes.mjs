import { BasicInformation } from '@matter/types/clusters';

/**
 * matter.js 0.17.9 leaks memory on every attribute read. Peer.basicInformation
 * calls ClusterState.readState({}) for each read. With no transaction, each call
 * registers a new reference on the read-only transaction, which never closes,
 * so the datasource keeps every reference. The service crashed with an
 * out-of-memory error after 2-3 days of polling.
 *
 * Upstream main returns one shared view for such reads. This keeps one live
 * reference per cluster, which gives the same result. Reads with a transaction
 * are unchanged. Remove this when a matter.js release includes the fix.
 */
const patched = new WeakSet();
export function shareOfflineClusterReads(peers) {
  let cluster;
  for (const peer of peers ?? []) if ((cluster = peer.protocol?.[0]?.[BasicInformation.id])) break;
  const prototype = cluster && Object.getPrototypeOf(cluster);
  if (typeof prototype?.readState !== 'function' || patched.has(prototype)) return false;
  const readState = prototype.readState;
  const shared = new WeakMap();
  prototype.readState = function (session) {
    if (session?.transaction !== undefined || Reflect.ownKeys(session ?? {}).length) return readState.call(this, session);
    if (!shared.has(this)) shared.set(this, readState.call(this, session));
    return shared.get(this);
  };
  patched.add(prototype);
  return true;
}
