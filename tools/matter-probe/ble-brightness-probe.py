"""One bounded diagnostic write; caller must preserve and restore bulb state."""
import asyncio
import json
import time
import argparse
from bleak import BleakClient

async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--power-off', action='store_true')
    args = parser.parse_args()
    address = '3C:0F:02:19:A6:0A'
    control = '00010203-0405-0607-0809-0a0b0c0d2b11'
    packet = bytearray(([0x33, 0x01, 0] if args.power_off else [0x33, 0x04, 1]) + [0] * 16)
    checksum = 0
    for value in packet:
        checksum ^= value
    packet.append(checksum)
    async with BleakClient(address, timeout=12) as client:
        await client.start_notify('00010203-0405-0607-0809-0a0b0c0d2b10',
                                  lambda _, data: print(json.dumps({'notification': bytes(data).hex()})))
        started = time.perf_counter()
        await client.write_gatt_char(control, packet, response=True)
        print(json.dumps({'writeReturnMs': round((time.perf_counter()-started)*1000, 2)}))
        await asyncio.sleep(8)

asyncio.run(main())
