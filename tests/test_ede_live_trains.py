"""Decode representative NS GPS and OVapi RS34 rail messages."""

from gzip import compress
from io import BytesIO
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from ede_live_trains import TrainUpdates, decode_ede_train_updates, decode_ns_positions, train_snapshot


NOW = 1795076400
MAP = ([-10, -10, 10, 10], {'lon0': 5.67, 'lat0': 52, 'x': [0, 100000, 0], 'z': [0, 0, -100000]})
RR_TRIP = {
    'tripId': 'published-trip', 'routeId': '165478', 'number': '31315',
    'stops': [{'station': 'ede-wageningen', 'sequence': 8, 'stopId': '3133740'}],
}
INDEX = (
    {RR_TRIP['tripId']: RR_TRIP},
    {('165478', 'IFF:SPR:31315'): RR_TRIP},
    {'3133741': '1a', '3133742': '1b'},
)


def varint(value):
    value %= 2**64
    result = bytearray()
    while value > 127:
        result.append((value & 127) | 128)
        value >>= 7
    result.append(value)
    return bytes(result)


def field(tag, value):
    if isinstance(value, int):
        return varint(tag * 8) + varint(value)
    if isinstance(value, str):
        value = value.encode()
    return varint(tag * 8 + 2) + varint(len(value)) + value


def update(trip_id, relationship=0, route='165478', date='20261119', stops=()):
    extension = field(1, 'IFF:SPR:31315')
    descriptor = field(1, trip_id) + field(3, date) + field(4, relationship) + field(5, route) + field(1003, extension)
    update = field(1, descriptor) + field(5, -2) + b''.join(field(2, stop) for stop in stops)
    return field(2, field(3, update))


def gps_unit(order, lon, timestamp, fix=''):
    return f'<TreinMaterieelDelen><Materieelvolgnummer>{order}</Materieelvolgnummer><GeneratieTijd>{timestamp}</GeneratieTijd><Fix>{fix}</Fix><Longitude>{lon}</Longitude><Latitude>52</Latitude><Snelheid>36</Snelheid><Richting>180</Richting></TreinMaterieelDelen>'


def gps_train(number, *units):
    return f"<TreinLocation><TreinNummer>{number}</TreinNummer>{''.join(units)}</TreinLocation>"


class EdeLiveTrainTest(unittest.TestCase):
    def test_distinct_gps_fixes_use_leading_fresh_unit_and_local_bounds(self):
        train = gps_train('3128', gps_unit(1, 5.67001, NOW - 4), gps_unit(2, 5.67002, NOW - 2))
        train += gps_train('3130', gps_unit(1, 5.671, NOW - 46), gps_unit(2, 5.0, NOW))
        train += gps_train('3132', gps_unit(1, 5.67, NOW, fix='0'))
        train += gps_train('3134', gps_unit(1, 5.67, NOW - 10), gps_unit(2, 5.67003, NOW))
        xml = f'<ArrayOfTreinLocation xmlns="http://schemas.datacontract.org/2004/07/Cognos.Infrastructure.Models">{train}</ArrayOfTreinLocation>'
        result = decode_ns_positions(compress(xml.encode()), NOW, MAP)
        self.assertEqual(result['3128'], (NOW - 4, {
            'operator': 'NS', 'number': '3128', 'timestamp': NOW - 4, 'x': 1.0, 'z': 0.0, 'speed': 10.0, 'bearing': 180.0,
        }))
        self.assertEqual(result['3130'], (NOW, None))
        self.assertNotIn('3132', result)
        self.assertEqual(result['3134'][1]['x'], 3.0)

    def test_rs34_updates_match_live_ids_and_normalize_delays_platforms_and_cancellations(self):
        arrival = field(1, -35) + field(2, NOW + 90)
        departure = field(1, 15) + field(2, NOW + 140)
        extension = field(2, '1') + field(3, '1b') + field(4, 'ed')
        stop = field(2, arrival) + field(3, departure) + field(4, '3133742') + field(1003, extension)
        skipped = field(4, '3133740') + field(5, 1) + field(6, field(1, '3133741'))
        body = field(1, field(3, NOW))
        body += update('live-trip', stops=[stop, skipped])
        body += update('published-trip', relationship=3, date='20261120')
        body += update('foreign-trip', route='other')
        body += update('published-trip', date='20261139')
        timestamp, updates = decode_ede_train_updates(body, INDEX)
        self.assertEqual(timestamp, NOW)
        self.assertEqual(updates, [
            {'operator': 'RRReis', 'number': '31315', 'tripId': 'live-trip', 'serviceDate': '2026-11-19',
             'timestamp': NOW, 'delay': -2, 'stops': [
                 {'stopId': '3133740', 'sequence': 8, 'arrival': NOW + 90, 'arrivalDelay': -35,
                  'departure': NOW + 140, 'departureDelay': 15, 'platform': '1b'},
                 {'stopId': '3133740', 'sequence': 8, 'skipped': True, 'platform': '1a'},
             ]},
            {'operator': 'RRReis', 'number': '31315', 'tripId': 'published-trip', 'serviceDate': '2026-11-20',
             'timestamp': NOW, 'cancelled': True, 'stops': []},
        ])
        with self.assertRaises(ValueError):
            decode_ede_train_updates(field(1, field(2, 1) + field(3, NOW)), INDEX)

    def test_conditional_updates_keep_original_timestamp_and_expire_independently(self):
        fresh_body = BytesIO(compress(field(1, field(3, NOW)) + update('published-trip', relationship=3)))
        fresh_body.headers = {'Last-Modified': 'Thu, 19 Nov 2026 08:20:00 GMT'}
        no_change = HTTPError('', 304, 'Not modified', {}, None)
        older_body = BytesIO(field(1, field(3, NOW - 60)))
        older_body.headers = {}
        shorter_body = BytesIO(field(1, field(3, NOW + 60)))
        shorter_body.headers = {}
        restored_body = BytesIO(field(1, field(3, NOW + 120)) + update('published-trip'))
        restored_body.headers = {}
        read = TrainUpdates()
        with patch('ede_live_trains.rrreis_index', return_value=INDEX), \
             patch('ede_live_trains.urlopen', side_effect=[fresh_body, no_change, older_body, shorter_body, restored_body]) as fetch:
            original = read()
            self.assertEqual(read(), original)
            self.assertEqual(fetch.call_args.args[0].get_header('If-modified-since'), fresh_body.headers['Last-Modified'])
            self.assertEqual(read(), original)
            self.assertEqual(read(), original)
            restored = read()
            self.assertNotIn('cancelled', restored[0])
        feeds = {'trainGps': [{'timestamp': NOW}], 'trainUpdates': original}
        self.assertEqual(train_snapshot(feeds, NOW + 46), {'version': 1, 'gps': [], 'updates': original})
        self.assertEqual(train_snapshot(feeds, NOW + 181), {'version': 1, 'gps': [], 'updates': original})
        self.assertEqual(train_snapshot(feeds, NOW + 37 * 3600), {'version': 1, 'gps': [], 'updates': []})
