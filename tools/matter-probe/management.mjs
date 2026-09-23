import { randomUUID } from 'node:crypto';
import { H6159, bleRequest } from './h6159.mjs';
import { isIP } from 'node:net';
import { Seconds } from '@matter/general';
import { ControllerCommissioningFlow } from '@matter/protocol';
import { ManualPairingCodeCodec } from '@matter/types';

function name(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 60) throw new Error('Use a name between 1 and 60 characters.');
  return value.trim();
}
function room(settings, id) {
  if (id !== '' && (typeof id !== 'string' || !Object.hasOwn(settings.groups, id))) throw new Error('Choose an existing room or Unassigned.');
}
function unlocked(settings, ids) {
  for (const id of ids) if (settings.lights[id]?.restore) throw new Error('Restore Full White before changing room membership.');
}
export const management = {
  async commitSettings(next) {
    const previous = this.settings;
    this.settings = next;
    try { await this.save(); }
    catch (error) { this.settings = previous; throw error; }
    for (const [id, bulb] of this.bulbs) { bulb.record = next.lights[id]; bulb.name = next.lights[id].name; }
  },
  async manage(command) {
    const next = structuredClone(this.settings);
    if (command.type === 'addBluetooth') {
      const address = typeof command.address === 'string' ? command.address.toUpperCase() : '';
      if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(address)) throw Error('Choose a discovered H6159 strip.');
      room(next, command.room);
      if (command.room) unlocked(next, next.groups[command.room].members);
      const id = `ble-${address.replaceAll(':','').toLowerCase()}`;
      if (this.nodeIds.has(id)) throw Error('This strip has already been added.');
      const found = await (this.bleRequest ?? bleRequest)({action:'scan'});
      if (!found.some(device=>device.address.toUpperCase()===address && /H6159/i.test(device.name))) throw Error('H6159 not found nearby. Close Govee Home and scan again.');
      const record = {name:name(command.name),transport:'bluetooth',model:'H6159',address,restore:null,owner:null};
      const bulb = new H6159(id,record,this.bleRequest ?? bleRequest);
      await bulb.read();
      next.lights[id] = record;
      if (command.room) next.groups[command.room].members.push(id);
      await this.commitSettings(next);
      this.nodeIds.set(id,id); this.bulbs.set(id,bulb);
      return this.catalog();
    } else if (command.type === 'createRoom') {
      const label = name(command.name);
      if (label.toUpperCase() === 'ALL ROOMS') throw new Error('ALL ROOMS is reserved for the combined view.');
      if (Object.values(next.groups).some(group => group.name.toLowerCase() === label.toLowerCase())) throw new Error('A room with this name already exists.');
      next.groups[`room-${randomUUID()}`] = { name: label, members: [] };
    } else if (command.type === 'renameRoom') {
      if (!Object.hasOwn(next.groups, command.id)) throw new Error('Unknown room.');
      const label = name(command.name);
      if (label.toUpperCase() === 'ALL ROOMS') throw new Error('ALL ROOMS is reserved for the combined view.');
      if (Object.entries(next.groups).some(([id, group]) => id !== command.id && group.name.toLowerCase() === label.toLowerCase())) throw new Error('A room with this name already exists.');
      next.groups[command.id].name = label;
    } else if (command.type === 'saveBulb') {
      if (!this.nodeIds.has(command.id)) throw new Error('Unknown light.');
      room(next, command.room);
      const current = Object.entries(next.groups).filter(([, group]) => group.members.includes(command.id)).map(([id]) => id);
      if (current.length !== (command.room ? 1 : 0) || current[0] !== (command.room || undefined)) {
        const affected = [...new Set([...current, command.room].filter(Boolean))];
        unlocked(next, [command.id, ...affected.flatMap(id => next.groups[id].members)]);
        await this.gradients?.stop([command.id]);
        await this.music?.stop([command.id]);
        for (const group of Object.values(next.groups)) group.members = group.members.filter(id => id !== command.id);
        if (command.room) next.groups[command.room].members.push(command.id);
      }
      next.lights[command.id].name = name(command.name);
    } else throw new Error('Unknown management action.');
    await this.commitSettings(next);
    return this.catalog();
  },
  pairInput(input) {
    const label = name(input.name);
    room(this.settings, input.room);
    if (input.room) unlocked(this.settings, this.settings.groups[input.room].members);
    const code = typeof input.code === 'string' ? input.code.replace(/[\s-]/g, '') : '';
    if (!/^(\d{11}|\d{21})$/.test(code)) throw new Error('Enter the numeric Matter setup code printed with the light’s QR code.');
    let decoded;
    try { decoded = ManualPairingCodeCodec.decode(code); }
    catch { throw new Error('Invalid Matter setup code. Check every digit.'); }
    const address = input.address?.trim();
    const localV4 = address && isIP(address) === 4 && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address);
    const localV6 = address && isIP(address) === 6 && /^(fe[89ab][0-9a-f]:|f[cd][0-9a-f]{2}:)/i.test(address);
    if (address && !localV4 && !localV6) throw new Error('Use a private local IP address for direct pairing.');
    return { name: label, room: input.room, passcode: decoded.passcode, shortDiscriminator: decoded.shortDiscriminator, ...(address ? {address} : {}) };
  },
  async pair(input, progress = () => {}) {
    // Revalidate after waiting for earlier commands; never change active snapshots.
    room(this.settings, input.room);
    if (input.room) unlocked(this.settings, this.settings.groups[input.room].members);
    class TracedCommissioningFlow extends ControllerCommissioningFlow {
      constructor(...args) {
        super(...args);
        for (const step of this.commissioningSteps) {
          const original = step.stepLogic;
          step.stepLogic = async (...values) => {
            progress(`Matter: ${step.name}`);
            return original(...values);
          };
        }
      }
      async executeCommissioning() {
        await super.executeCommissioning();
        progress('Reading paired light capabilities');
      }
    }
    let nodeId;
    progress(input.address ? `Establishing secure session with ${input.address}` : 'Finding light and establishing secure session');
    try {
      const address = input.address;
      if (!address) nodeId = await this.commissionLocal?.({
        passcode: input.passcode, commissioningFlowImpl: TracedCommissioningFlow,
        regulatoryCountryCode: 'US', onAttestationFailure: findings => findings.every(finding => finding.level !== 'error'),
      });
      if (nodeId === undefined) nodeId = await this.controller.commissionNode({ autoSubscribe: false, passcode: input.passcode,
        discovery: { ...(address ? {knownAddress: {ip:address,port:5540,type:'udp'}} : {identifierData: { shortDiscriminator: input.shortDiscriminator }}), discoveryCapabilities: { ble: false, onIpNetwork: true }, timeout: Seconds(15) },
        commissioning: { regulatoryCountryCode: 'US', onAttestationFailure: findings => findings.every(finding => finding.level !== 'error') },
      }, { commissioningFlowImpl: TracedCommissioningFlow });
    } catch (error) {
      console.warn(`Pairing protocol failure: ${error?.constructor?.name ?? 'Error'}: ${String(error.message).replaceAll(String(input.passcode), '[redacted]').slice(0, 1500)}`);
      if (error.cause) console.warn(`Pairing cause: ${String(error.cause.message ?? error.cause).replaceAll(String(input.passcode), '[redacted]').slice(0, 1500)}`);
      // Reconcile any node persisted by Matter before an interrupted response.
      for (const id of this.controller.getCommissionedNodes()) {
        this.nodeIds.set(String(id), id);
        this.settings.lights[String(id)] ??= { name: `Light ${id}`, restore: null, owner: null };
      }
      await this.save();
      throw new Error('Pairing did not finish. Check for a newly added light before retrying. Open its Matter pairing window, check the setup code, and keep it on the same Wi-Fi network.');
    }
    progress('Saving paired light');
    const id = String(nodeId);
    this.nodeIds.set(id, nodeId);
    // Keep a recoverable default even if the friendly-name save fails.
    this.settings.lights[id] ??= { name: `Light ${id}`, restore: null, owner: null };
    const next = structuredClone(this.settings);
    next.lights[id].name = input.name;
    const assigned = Object.values(next.groups).some(group => group.members.includes(id));
    if (input.room && !assigned) next.groups[input.room].members.push(id);
    try { await this.commitSettings(next); }
    catch { throw new Error(`Light ${id} paired, but its name and room could not be saved. Refresh and edit that light; do not pair it again.`); }
    return { id, name: input.name };
  },
  async identify(id) {
    if (!this.nodeIds.has(id)) throw new Error('Choose a light to identify.');
    if (this.settings.lights[id].transport === 'bluetooth') throw Error('Identify is not available for this strip.');
    const gradient = this.gradients.state(id);
    await this.music.stop([id]);
    await this.gradients.stop([id]);
    await (await this.bulb(id)).identify();
    if (gradient) await this.gradients.start(gradient.target, [id], gradient);
    return { ok: true };
  },
};
