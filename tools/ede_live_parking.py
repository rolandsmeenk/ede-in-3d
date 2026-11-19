"""Read per-facility SPDP 2.0 availability for verified Ede sites."""

from base64 import b64encode
import json
from os import environ
from pathlib import Path
import time
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
NPR_DYNAMIC = 'https://npropendata.rdw.nl/parkingdata/v2/dynamic/'
MAX_AGE = 180
MAX_BYTES = 64 * 1024


def fresh(timestamp, now):
    return type(timestamp) is int and timestamp > 0 and -5 <= now - timestamp <= MAX_AGE


def decode_availability(payload, facility, now):
    data = payload.get('parkingFacilityDynamicInformation') if isinstance(payload, dict) else None
    if not isinstance(data, dict) or data.get('identifier') != facility['nprId']:
        raise ValueError('NPR returned a different parking facility')
    status = data.get('facilityActualStatus')
    if not isinstance(status, dict):
        raise ValueError('NPR parking status is missing')
    capacity = status.get('parkingCapacity')
    vacant = status.get('vacantSpaces')
    timestamp = status.get('lastUpdated')
    opened = status.get('open')
    if (
        not fresh(timestamp, now) or type(opened) is not bool or type(capacity) is not int
        or type(vacant) is not int or not 0 < capacity <= facility['capacity'] or not 0 <= vacant <= capacity
    ):
        raise ValueError('NPR parking status is stale or incomplete')
    return {'id': facility['id'], 'capacity': capacity, 'occupied': capacity - vacant,
            'timestamp': timestamp, 'open': opened}


def parking_reader(facility, auth=None):
    last = None

    def read():
        nonlocal last
        request = Request(NPR_DYNAMIC + facility['nprId'], headers={'Accept': 'application/json'})
        if auth:
            # urllib drops unredirected headers if the provider changes the destination.
            request.add_unredirected_header('Authorization', auth)
        with urlopen(request, timeout=8) as response:
            body = response.read(MAX_BYTES + 1)
        if len(body) > MAX_BYTES:
            raise ValueError('NPR parking feed exceeds size limit')
        record = decode_availability(json.loads(body), facility, time.time())
        if last is not None and record['timestamp'] < last['timestamp']:
            raise ValueError('NPR parking status predates the cached sample')
        last = record
        return record

    return read


def parking_readers():
    user, password = environ.get('EDE_NPR_USERNAME'), environ.get('EDE_NPR_PASSWORD')
    auth = 'Basic ' + b64encode(f'{user}:{password}'.encode()).decode('ascii') if user and password else None
    with (ROOT / 'assets' / 'ede-parking-facilities.json').open(encoding='utf-8') as source:
        facilities = json.load(source)['facilities']
    return [
        (f"parking:{facility['id']}", parking_reader(facility, auth if dynamic['limitedAccess'] else None))
        for facility in facilities
        if (dynamic := facility.get('nprDynamic')) and (auth or not dynamic['limitedAccess'])
    ]


def parking_snapshot(feeds, now):
    return {'version': 1, 'facilities': [
        record for key, record in sorted(feeds.items())
        if key.startswith('parking:') and fresh(record['timestamp'], now)
    ]}
