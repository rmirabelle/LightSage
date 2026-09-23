"""Bounded local H6159 transport. JSON stdin/stdout; no cloud or pairing changes."""
import asyncio
import json
import sys
from functools import reduce
from bleak import BleakClient, BleakScanner

CONTROL = '00010203-0405-0607-0809-0a0b0c0d2b11'
NOTIFY = '00010203-0405-0607-0809-0a0b0c0d2b10'

def packet(prefix, domain, payload=()):
    data = bytes([prefix, domain, *payload])
    data += bytes(19 - len(data))
    return data + bytes([reduce(int.__xor__, data)])

async def run(request):
    if request['action'] == 'scan':
        found = await BleakScanner.discover(timeout=6, return_adv=True)
        return [{'address': d.address, 'name': a.local_name or d.name, 'rssi': a.rssi}
                for d, a in found.values() if 'H6159' in (a.local_name or d.name or '').upper()]
    async with BleakClient(request['address'], timeout=10) as client:
        replies = {}
        def notify(_, data):
            if len(data) == 20 and reduce(int.__xor__, data) == 0 and data[0] == 0xAA:
                replies[data[1]] = bytes(data)
        await client.start_notify(NOTIFY, notify)
        await asyncio.sleep(.6)
        async def query():
            replies.clear()
            for attempt in range(3):
                for domain in (1, 4, 5):
                    if domain not in replies:
                        await client.write_gatt_char(CONTROL, packet(0xAA, domain), response=False)
                        await asyncio.sleep(.15)
                await asyncio.sleep(.2)
                if all(domain in replies for domain in (1, 4, 5)):
                    if replies[1][2] not in (0, 1):
                        raise ValueError('Invalid power response')
                    return {'on': bool(replies[1][2]), 'brightnessByte': replies[4][2],
                            'mode': replies[5][2], 'rgb': list(replies[5][3:6])}
            raise TimeoutError('Strip did not report complete state. Close Govee Home and retry.')
        action = request['action']
        if action == 'read':
            return await query()
        commands = []
        expected = {}
        if action == 'power':
            expected['on'] = request['on']
            commands.append((1, [int(request['on'])]))
        elif action == 'brightness':
            expected['brightnessByte'] = request['value']
            commands.append((4, [request['value']]))
        elif action == 'color':
            expected.update(mode=2, rgb=request['rgb'])
            commands.append((5, [2, *request['rgb']]))
        elif action == 'restore':
            expected = request['state']
            if expected['mode'] != 2:
                raise ValueError('Only solid-color scenes can be restored')
            commands = [(5, [2, *expected['rgb']]), (4, [expected['brightnessByte']]), (1, [int(expected['on'])])]
        else:
            raise ValueError('Unsupported H6159 action')
        for attempt in range(3):
            for domain, payload in commands:
                await client.write_gatt_char(CONTROL, packet(0x33, domain, payload), response=False)
                await asyncio.sleep(.2)
            actual = await query()
            if all(actual[key] == value for key, value in expected.items()):
                return actual
        raise RuntimeError('Strip did not confirm the requested settings. Retry the command.')

if __name__ == '__main__':
    try:
        print(json.dumps({'result': asyncio.run(asyncio.wait_for(run(json.load(sys.stdin)), 17))}))
    except Exception as error:
        print(json.dumps({'error': str(error) or type(error).__name__}))
        sys.exit(1)
