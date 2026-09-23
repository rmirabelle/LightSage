import asyncio
import json
from pathlib import Path
from bleak import BleakScanner

async def main():
    devices = await BleakScanner.discover(timeout=8, return_adv=True)
    found = []
    for device, advertisement in devices.values():
        name = advertisement.local_name or device.name or ''
        if not any(value in name.lower() for value in ['govee', 'gvh', 'h60']):
            continue
        found.append({'address': device.address, 'name': name, 'rssi': advertisement.rssi,
                      'services': advertisement.service_uuids})
    result = {'devices': found}
    Path(__file__).with_name('.state').joinpath('ble-discovery.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result))

asyncio.run(main())
