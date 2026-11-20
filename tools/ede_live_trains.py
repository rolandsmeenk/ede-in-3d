"""Read server-side NDOV NS positions and OVapi Valleilijn trip updates."""

from collections import defaultdict
from datetime import date, datetime
from functools import lru_cache
from gzip import GzipFile
from io import BytesIO
import json
import re
import sys
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from xml.etree.ElementTree import ParseError, fromstring
from zlib import error as ZlibError

from ede_live_buses import ROOT, fields, local_map, string
from ede_scene import SceneAffine


NS_URL = 'tcp://pubsub.besteffort.ndovloket.nl:7664'
NS_TOPIC = b'/RIG/NStreinpositiesInterface5'
NS_NAMESPACE = '{http://schemas.datacontract.org/2004/07/Cognos.Infrastructure.Models}'
OVAPI_URL = 'https://gtfs.ovapi.nl/nl/trainUpdates.pb'
GPS_MAX_AGE = 45
UPDATE_MAX_AGE = 180
CANCELLATION_MAX_AGE = 36 * 3600
GPS_MAX_BYTES = 2 * 1024 * 1024
UPDATE_MAX_BYTES = 16 * 1024 * 1024
RRREIS_STATIONS = {
    'ed': 'ede-wageningen',
    'edc': 'ede-centrum',
    'ltn': 'lunteren',
    'bnz': 'barneveld-zuid',
    'bnc': 'barneveld-centrum',
    'bnn': 'barneveld-noord',
}


def fresh(record, now, age):
    return -5 <= now - record['timestamp'] <= age


def value_as_float(value):
    try:
        return float(value)
    except ValueError:
        return float('nan')


def fix_timestamp(unit):
    try:
        raw = unit.get('GpsDatumTijd')
        if raw:
            fix = datetime.fromisoformat(raw.replace('Z', '+00:00'))
            if fix.tzinfo is not None:
                return int(fix.timestamp())
        return int(unit.get('GeneratieTijd') or 0)
    except (ValueError, OverflowError, OSError):
        return 0


def unpack_gzip(body, limit):
    if body.startswith(b'\x1f\x8b'):
        with GzipFile(fileobj=BytesIO(body)) as stream:
            body = stream.read(limit + 1)
    if len(body) > limit:
        raise ValueError('Rail feed exceeds size limit')
    return body


def decode_ns_positions(body, now, map_reference=None):
    bounds, affine = local_map() if map_reference is None else map_reference
    projection = SceneAffine(affine)
    min_x, min_z, max_x, max_z = bounds
    root = fromstring(unpack_gzip(body, GPS_MAX_BYTES))
    if root.tag != NS_NAMESPACE + 'ArrayOfTreinLocation':
        raise ValueError('Unexpected NS train position message')
    candidates = defaultdict(list)
    for train in root.findall(NS_NAMESPACE + 'TreinLocation'):
        number = train.findtext(NS_NAMESPACE + 'TreinNummer', '').strip()
        if not re.fullmatch(r'[0-9]{1,8}', number):
            continue
        for element in train.findall(NS_NAMESPACE + 'TreinMaterieelDelen'):
            unit = {child.tag.removeprefix(NS_NAMESPACE): child.text or '' for child in element}
            lat = value_as_float(unit.get('Latitude', ''))
            lon = value_as_float(unit.get('Longitude', ''))
            if unit.get('Fix') == '0' or not (-90 <= lat <= 90 and -180 <= lon <= 180):
                continue
            record = {'operator': 'NS', 'number': number, 'timestamp': fix_timestamp(unit)}
            if not fresh(record, now, GPS_MAX_AGE):
                continue
            x, z = projection.lon_lat_to_scene(lon, lat)
            record.update(x=round(x, 1), z=round(z, 1))
            speed = value_as_float(unit.get('Snelheid', ''))
            if 0 <= speed <= 400:
                record['speed'] = round(speed / 3.6, 1)
            bearing = value_as_float(unit.get('Richting', unit.get('Heading', '')))
            if 0 <= bearing <= 360 and not 0 <= speed < 10:
                record['bearing'] = round(bearing, 1) % 360
            order = unit.get('Materieelvolgnummer', '')
            candidates[number].append((int(order) if re.fullmatch(r'[1-9][0-9]?', order) else 100, record))
    positions = {}
    for number, units in candidates.items():
        latest = max(record['timestamp'] for _, record in units)
        # Consecutive units send asynchronous fixes. Prefer the leading unit when its fix is current.
        _, record = min(
            ((order, record) for order, record in units if record['timestamp'] >= latest - 8),
            key=lambda candidate: (candidate[0], -candidate[1]['timestamp']),
        )
        positions[number] = record['timestamp'], (
            record if min_x - 500 <= record['x'] <= max_x + 500 and min_z - 500 <= record['z'] <= max_z + 500 else None
        )
    return positions


def ns_position_snapshots():
    import zmq

    active = {}
    last_error = None
    with zmq.Context() as context, context.socket(zmq.SUB) as subscriber:
        subscriber.setsockopt(zmq.SUBSCRIBE, NS_TOPIC)
        subscriber.setsockopt(zmq.MAXMSGSIZE, GPS_MAX_BYTES)
        subscriber.connect(NS_URL)
        while True:
            parts = subscriber.recv_multipart()
            if len(parts) != 2 or parts[0] != NS_TOPIC:
                continue
            now = time.time()
            try:
                positions = decode_ns_positions(parts[1], now)
            except (OSError, ValueError, ParseError, EOFError, ZlibError) as error:
                message = str(error)
                if message != last_error:
                    print(f'NS GPS feed unavailable: {message}', file=sys.stderr)
                    last_error = message
                continue
            last_error = None
            active = {number: record for number, record in active.items() if fresh(record, now, GPS_MAX_AGE)}
            for number, (timestamp, record) in positions.items():
                if timestamp < active.get(number, {}).get('timestamp', 0):
                    continue
                if record is None:
                    active.pop(number, None)
                else:
                    active[number] = record
            yield list(active.values())


def message(value):
    return dict(fields(value)) if isinstance(value, memoryview) else {}


def signed_delay(value):
    value &= 0xffffffff
    return value if value < 0x80000000 else value - 0x100000000


@lru_cache(maxsize=1)
def rrreis_index():
    with (ROOT / 'assets' / 'ede-train-timetable.json').open(encoding='utf-8') as source:
        timetable = json.load(source)
    trips = [trip for trip in timetable['trips'] if trip['operator'] == 'RRReis' and trip['route'] == 'rs34']
    by_id = {trip['tripId']: trip for trip in trips}
    by_realtime = {(trip['routeId'], trip['realtimeTripId']): trip for trip in trips}
    return by_id, by_realtime, timetable.get('platforms', {})


def stop_update(data, trip, platforms):
    stop = message(data)
    ext = message(stop.get(1003))
    place = RRREIS_STATIONS.get(string(ext.get(4)))
    stop_id = string(stop.get(4))
    scheduled = next((row for row in trip['stops'] if stop_id and row.get('stopId') == stop_id), None)
    if scheduled is None and place:
        scheduled = next((row for row in trip['stops'] if row['station'] == place), None)
    result = {}
    if scheduled and scheduled.get('stopId'):
        result['stopId'] = scheduled['stopId']
    elif stop_id:
        result['stopId'] = stop_id
    sequence = (scheduled or {}).get('sequence', stop.get(1))
    if isinstance(sequence, int) and sequence > 0:
        result['sequence'] = sequence
    if 'sequence' not in result and 'stopId' not in result:
        return None
    if stop.get(5) == 1:
        result['skipped'] = True
    for label, field in [('arrival', 2), ('departure', 3)]:
        event = message(stop.get(field)) if stop.get(5) != 2 else {}
        if isinstance(event.get(2), int) and 0 < event[2] < 2**53:
            result[label] = event[2]
        if isinstance(event.get(1), int):
            result[label + 'Delay'] = signed_delay(event[1])
    assigned = string(message(stop.get(6)).get(1))
    platform = string(ext.get(3)) or platforms.get(assigned) or string(ext.get(2))
    if platform and re.fullmatch(r'[0-9]{1,3}[a-z]?', platform.lower()):
        result['platform'] = platform.lower()
    return result


def decode_ede_train_updates(body, index=None):
    by_id, by_realtime, platforms = rrreis_index() if index is None else index
    timestamp, updates = 0, {}
    for number, value in fields(memoryview(body)):
        if number == 1:
            header = message(value)
            timestamp = header.get(3, 0)
            if header.get(2, 0) != 0 or not isinstance(timestamp, int) or not 0 < timestamp < 2**53:
                raise ValueError('Invalid or incremental OVapi rail feed header')
        elif number == 2:
            entity = message(value)
            if entity.get(2) or not isinstance(entity.get(3), memoryview):
                continue
            update_fields = list(fields(entity[3]))
            update = dict(update_fields)
            descriptor = message(update.get(1))
            relationship = descriptor.get(4, 0)
            if relationship not in (0, 3, 7):
                continue
            trip_id, route_id = string(descriptor.get(1)), string(descriptor.get(5))
            ext = message(descriptor.get(1003))
            realtime_id = string(ext.get(1))
            scheduled = by_id.get(trip_id)
            if scheduled is None:
                scheduled = by_realtime.get((route_id, realtime_id))
            if scheduled is None or (route_id and route_id != scheduled['routeId']):
                continue
            raw_date = string(descriptor.get(3))
            service_date = None
            if raw_date:
                if not re.fullmatch(r'[0-9]{8}', raw_date):
                    continue
                try:
                    service_date = date(int(raw_date[:4]), int(raw_date[4:6]), int(raw_date[6:])).isoformat()
                except ValueError:
                    continue
            result = {
                'operator': 'RRReis', 'number': scheduled['number'], 'tripId': trip_id or scheduled['tripId'],
                'timestamp': update.get(4, 0), 'stops': [],
            }
            if service_date:
                result['serviceDate'] = service_date
            if relationship in (3, 7):
                result['cancelled'] = True
            else:
                delay = update.get(5)
                if isinstance(delay, int):
                    result['delay'] = signed_delay(delay)
                result['stops'] = [
                    row for field, stop in update_fields
                    if field == 2 and (row := stop_update(stop, scheduled, platforms))
                ]
            key = result['tripId'], service_date
            old = updates.get(key)
            reported = result['timestamp']
            if not isinstance(reported, int) or not 0 < reported < 2**53:
                result['timestamp'] = 0
            if old is None or result['timestamp'] >= old['timestamp']:
                updates[key] = result
    if not timestamp:
        raise ValueError('OVapi rail feed has no timestamp')
    for update in updates.values():
        update['timestamp'] = update['timestamp'] or timestamp
    return timestamp, list(updates.values())


def current_update(record, now):
    age = CANCELLATION_MAX_AGE if record.get('cancelled') and record.get('serviceDate') else UPDATE_MAX_AGE
    return fresh(record, now, age)


class TrainUpdates:
    def __init__(self):
        self.modified = None
        self.timestamp = 0
        self.updates = []

    def __call__(self):
        headers = {'User-Agent': 'Slop Ede transit simulator', 'Accept-Encoding': 'gzip'}
        if self.modified:
            headers['If-Modified-Since'] = self.modified
        request = Request(OVAPI_URL, headers=headers)
        try:
            with urlopen(request, timeout=8) as response:
                body = response.read(UPDATE_MAX_BYTES + 1)
                modified = response.headers.get('Last-Modified')
        except HTTPError as error:
            if error.code == 304:
                error.close()
                return self.updates
            raise
        try:
            timestamp, updates = decode_ede_train_updates(unpack_gzip(body, UPDATE_MAX_BYTES))
        except ZlibError as error:
            raise ValueError('Invalid compressed OVapi rail feed') from error
        if timestamp >= self.timestamp:
            # A dated cancellation can outlive a missing entry in a later full feed.
            carried = {(row.get('serviceDate'), row['number']): row for row in self.updates
                       if row.get('cancelled') and row.get('serviceDate') and current_update(row, timestamp)}
            for row in updates:
                key = row.get('serviceDate'), row['number']
                if key not in carried or row['timestamp'] >= carried[key]['timestamp']:
                    carried[key] = row
            self.modified, self.timestamp, self.updates = modified, timestamp, list(carried.values())
        return self.updates


def train_snapshot(feeds, now):
    return {
        'version': 1,
        'gps': [record for record in feeds.get('trainGps', ()) if fresh(record, now, GPS_MAX_AGE)],
        'updates': [record for record in feeds.get('trainUpdates', ()) if current_update(record, now)],
    }
