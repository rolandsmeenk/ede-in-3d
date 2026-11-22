const { execFileSync } = require('node:child_process');
const { join } = require('node:path');
const test = require('node:test');

test('OVapi protobuf is filtered by exact trip, direction, service relationship and map bounds', () => {
  execFileSync('python3', ['-B', '-c', `
import struct
import sys
sys.path.insert(0, 'tools')
from ede_live_buses import decode_ede_bus_feed

def varint(n):
    return bytes([n]) if n < 128 else bytes([128 | (n & 127)]) + varint(n >> 7)

def field(n, value):
    if isinstance(value, int):
        return varint(n << 3) + varint(value)
    if isinstance(value, float):
        return varint((n << 3) | 5) + struct.pack('<f', value)
    return varint((n << 3) | 2) + varint(len(value)) + value

def entity(trip_id, direction=1, route=b'route', relationship=0, lon=5.0):
    trip = field(1, trip_id) + field(3, b'20261118') + field(4, relationship) + field(5, route) + field(6, direction)
    pos = field(1, 52.0) + field(2, lon) + field(3, 90.0) + field(5, 11.0)
    vehicle = field(1, trip) + field(2, pos) + field(3, 7) + field(4, 2) + field(5, 1795043352) + field(7, b'platform')
    return field(2, field(1, b'entity') + field(4, vehicle))

header = field(1, field(1, b'2.0') + field(3, 1795043366))
body = header + entity(b'valid') + entity(b'unknown') + entity(b'valid', 0) + entity(b'valid', route=b'wrong')
body += entity(b'valid', relationship=3) + entity(b'valid', lon=5.5)
network = ({'valid': ('route', 1)}, [-5000, -5000, 5000, 5000], {'lat0': 52, 'lon0': 5, 'x': [0, 68000, 0], 'z': [0, 0, -111000]})
feed = decode_ede_bus_feed(body, network)
assert feed == {'timestamp': 1795043366, 'vehicles': [{'tripId': 'valid', 'x': 0.0, 'z': 0.0,
    'serviceDate': '2026-11-18', 'timestamp': 1795043352, 'stopSequence': 7, 'status': 2,
    'stopId': 'platform', 'bearing': 90.0, 'speed': 11.0}]}, feed
municipality = [[[0, -1000, 1000, -1000, 1000, 1000, 0, 1000], [400, -50, 600, -50, 600, 50, 400, 50]]]
border_feed = header + entity(b'valid', lon=4.99) + entity(b'valid', lon=5.005) + entity(b'valid', lon=5.01) + entity(b'valid', lon=5.02)
vehicles = decode_ede_bus_feed(border_feed, (*network, municipality))['vehicles']
assert [row['x'] for row in vehicles] == [340.0, 680.0], vehicles
try:
    decode_ede_bus_feed(body[:-1], network)
except ValueError:
    pass
else:
    raise AssertionError('truncated protobuf was accepted')
`], { cwd: join(__dirname, '..') });
});
