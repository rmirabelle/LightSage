// Local feasibility controller. No DCL or OTA services are registered.
import '@matter/nodejs';
import { Environment, Logger, LogLevel, Seconds } from '@matter/general';
import { ManualPairingCodeCodec } from '@matter/types';
import { BasicInformation, OnOff, LevelControl, ColorControl } from '@matter/types/clusters';
import { CommissioningController } from '@project-chip/matter.js';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';

globalThis.fetch = async () => { throw new Error('HTTP fetch disabled: local-only controller.'); };
Logger.defaultLogLevel = LogLevel.ERROR;
Environment.default.vars.set('storage.path', resolve('.state'));
Environment.default.vars.set('mdns.networkInterface', 'Wi-Fi');
const controller = new CommissioningController({
  environment: { environment: Environment.default, id: 'lightsage-probe' },
  autoConnect: false,
  adminFabricLabel: 'LightSage',
  enableOtaProvider: false,
});

try {
  await controller.start();
  if (process.argv[2] === 'pair') {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    const { passcode, shortDiscriminator } = ManualPairingCodeCodec.decode(input.trim().replaceAll('-', ''));
    input = '';
    console.log('Pairing selected light over the local network...');
    const nodeId = await controller.commissionNode({
      autoSubscribe: false,
      passcode,
      discovery: {
        identifierData: { shortDiscriminator },
        discoveryCapabilities: { ble: false, onIpNetwork: true },
        timeout: Seconds(60),
      },
      commissioning: {
        regulatoryCountryCode: 'US',
        onAttestationFailure: findings => {
          for (const finding of findings) console.log(`Attestation ${finding.level}: ${finding.type}`);
          return findings.every(finding => finding.level !== 'error');
        },
      },
    });
    console.log(`Paired node ${nodeId}. Controller identity saved locally in .state.`);
  } else if (!['status', 'test-brightness'].includes(process.argv[2])) {
    throw new Error('Use pair (code on stdin), status, or test-brightness.');
  }

  for (const nodeId of controller.getCommissionedNodes()) {
    const node = await controller.connectNode(nodeId, { autoSubscribe: false });
    const info = node.getRootClusterClient(BasicInformation);
    console.log('Product:', await info?.getProductNameAttribute(true));
    for (const endpoint of node.getDevices()) {
      const onOff = endpoint.getClusterClient(OnOff);
      const level = endpoint.getClusterClient(LevelControl);
      const color = endpoint.getClusterClient(ColorControl);
      if (process.argv[2] === 'test-brightness' && level && onOff) {
        const before = await level.getCurrentLevelAttribute(true);
        if (!await onOff.getOnOffAttribute(true) || before == null) throw new Error('Test requires a powered-on light with known brightness.');
        const target = before > 200 ? 180 : 220;
        await writeFile('.state/brightness-test-recovery.json', JSON.stringify({ node: String(nodeId), level: before }));
        const set = value => level.moveToLevel({ level: value, transitionTime: 0, optionsMask: {}, optionsOverride: {} });
        try {
          await set(target);
          const observed = await level.getCurrentLevelAttribute(true);
          if (observed !== target) throw new Error(`Brightness mismatch: ${observed}`);
          console.log(`Brightness command verified: ${before} -> ${observed}`);
          await new Promise(resolve => setTimeout(resolve, 1000));
        } finally {
          await set(before);
          const restored = await level.getCurrentLevelAttribute(true);
          if (restored !== before) throw new Error(`Restore failed: ${restored}`);
          console.log(`Original brightness restored: ${restored}`);
        }
      }
      console.log(JSON.stringify({
        endpoint: endpoint.number,
        powerControl: !!onOff,
        brightnessControl: !!level,
        colorControl: !!color,
        on: await onOff?.getOnOffAttribute(true),
        level: await level?.getCurrentLevelAttribute(true),
        colorCapabilities: await color?.getColorCapabilitiesAttribute(true),
      }));
    }
  }
} finally {
  await controller.close();
}
