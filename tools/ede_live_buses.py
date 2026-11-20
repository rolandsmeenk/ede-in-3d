"""Fetch and filter OVapi's GTFS Realtime vehicle positions for the Ede map."""

from functools import lru_cache
import json
from pathlib import Path
import re
import struct
from urllib.request import urlopen

from ede_map import load_scene_metadata
from ede_scene import SceneAffine

ROOT = Path(__file__).resolve().parents[1]
URL = 'https://gtfs.ovapi.nl/nl/vehiclePositions.pb'
MAX_BYTES = 8 * 1024 * 1024


def varint(data, offset):
    value = 0
    for shift in range(0, 70, 7):
        if offset >= len(data):
            break
        byte = data[offset]
        offset += 1
        value |= (byte & 127) << shift
        if byte < 128:
            return value, offset
    raise ValueError('Invalid Protobuf varint in OVapi feed')


def fields(data):
    offset = 0
    while offset < len(data):
        key, offset = varint(data, offset)
        number, wire = key >> 3, key & 7
        if not number:
            raise ValueError('Invalid Protobuf field in OVapi feed')
        if wire == 0:
            value, offset = varint(data, offset)
        else:
            if wire == 2:
                size, offset = varint(data, offset)
            elif wire in (1, 5):
                size = 8 if wire == 1 else 4
            else:
                raise ValueError('Unknown Protobuf wire type in OVapi feed')
            end = offset + size
            if end > len(data):
                raise ValueError('Truncated Protobuf field in OVapi feed')
            value = data[offset:end]
            offset = end
        yield number, value


def string(value):
    return bytes(value).decode('utf-8') if isinstance(value, memoryview) else ''


def float_field(value):
    if isinstance(value, memoryview) and len(value) == 4:
        return struct.unpack('<f', value)[0]
    return float('nan')


@lru_cache(maxsize=1)
def local_map():
    meta = load_scene_metadata()
    return meta['bounds'], meta['lonLatAffine']


@lru_cache(maxsize=1)
def local_network():
    with (ROOT / 'assets' / 'ede-bus-routes.json').open(encoding='utf-8') as source:
        schedule = json.load(source)
    _, projection = local_map()
    trips = {trip['id']: (variant['routeId'], variant['direction'])
             for variant in schedule['variants'] for trip in variant['trips']}
    return trips, schedule['bounds'], projection


def local_vehicle(data, trips, bounds, projection):
    vehicle = dict(fields(data))
    if not isinstance(vehicle.get(1), memoryview) or not isinstance(vehicle.get(2), memoryview):
        return None
    trip = dict(fields(vehicle[1]))
    trip_id = string(trip.get(1))
    if trip_id not in trips or trip.get(4, 0) != 0:
        return None
    route, direction = trips[trip_id]
    if string(trip.get(5)) not in ('', route) or (direction is not None and trip.get(6, direction) != direction):
        return None
    position = dict(fields(vehicle[2]))
    lat, lon = float_field(position.get(1)), float_field(position.get(2))
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    x, z = projection.lon_lat_to_scene(lon, lat)
    min_x, min_z, max_x, max_z = bounds
    if not (min_x - 100 <= x <= max_x + 100 and min_z - 100 <= z <= max_z + 100):
        return None
    result = {'tripId': trip_id, 'x': round(x, 1), 'z': round(z, 1)}
    date = string(trip.get(3))
    if date:
        if not re.fullmatch(r'[0-9]{8}', date):
            return None
        result['serviceDate'] = f'{date[:4]}-{date[4:6]}-{date[6:]}'
    for name, value in [('timestamp', vehicle.get(5)), ('stopSequence', vehicle.get(3)), ('status', vehicle.get(4))]:
        if isinstance(value, int):
            result[name] = value
    if stop_id := string(vehicle.get(7)):
        result['stopId'] = stop_id
    bearing, speed = float_field(position.get(3)), float_field(position.get(5))
    if 0 <= bearing < 360:
        result['bearing'] = round(bearing, 1)
    if 0 <= speed <= 55:
        result['speed'] = round(speed, 1)
    return result


def decode_ede_bus_feed(body, network=None):
    trips, bounds, affine = network if network is not None else local_network()
    projection = SceneAffine(affine)
    timestamp, vehicles = 0, []
    header_found = False
    for number, value in fields(memoryview(body)):
        if number == 1:
            if not isinstance(value, memoryview):
                raise ValueError('Invalid OVapi feed header')
            header = dict(fields(value))
            if header.get(2, 0) != 0:
                raise ValueError('OVapi vehicle feed is incremental')
            header_found = True
            timestamp = header.get(3, 0)
            if not isinstance(timestamp, int):
                raise ValueError('Invalid OVapi timestamp')
        elif number == 2 and isinstance(value, memoryview):
            entity = dict(fields(value))
            if not entity.get(2) and isinstance(entity.get(4), memoryview):
                vehicle = local_vehicle(entity[4], trips, bounds, projection)
                if vehicle:
                    vehicles.append(vehicle)
    if not header_found:
        raise ValueError('OVapi vehicle feed has no header')
    if not timestamp:
        timestamp = max((vehicle.get('timestamp', 0) for vehicle in vehicles), default=0)
    return {'timestamp': timestamp, 'vehicles': vehicles}


def read_ede_bus_feed():
    with urlopen(URL, timeout=8) as response:
        body = response.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES:
        raise ValueError('OVapi vehicle feed exceeds size limit')
    return decode_ede_bus_feed(body)
