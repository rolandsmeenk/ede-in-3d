"""Verify NPR facility identity, availability and snapshot freshness."""

from io import BytesIO
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from ede_live_parking import decode_availability, parking_reader, parking_readers, parking_snapshot


NOW = 1795076400
MARKT = {'id': 'q-park-markt', 'nprId': '2088bea9-dae1-4093-987e-9c253746f2a5', 'capacity': 440}
ACHTER = {'id': 'q-park-achterdoelen', 'nprId': '9de627c9-d074-405e-8c48-80f048b4c9c3', 'capacity': 490}


def payload(facility=MARKT, **overrides):
    return {'parkingFacilityDynamicInformation': {
        'identifier': facility['nprId'],
        'facilityActualStatus': {
            'lastUpdated': NOW - 15, 'open': True, 'parkingCapacity': facility['capacity'],
            'vacantSpaces': 70, **overrides,
        },
    }}


class EdeLiveParkingTest(unittest.TestCase):
    def test_only_a_matching_facility_with_valid_original_counts_and_time_is_accepted(self):
        self.assertEqual(decode_availability(payload(), MARKT, NOW), {
            'id': 'q-park-markt', 'capacity': 440, 'occupied': 370,
            'timestamp': NOW - 15, 'open': True,
        })
        cases = [
            payload(ACHTER), payload(parkingCapacity=441), payload(parkingCapacity=None),
            payload(vacantSpaces=441), payload(vacantSpaces=True), payload(open='false'),
            payload(lastUpdated=NOW - 181), payload(lastUpdated=NOW + 6),
        ]
        for document in cases:
            with self.subTest(document=document), self.assertRaises(ValueError):
                decode_availability(document, MARKT, NOW)

    def test_each_sample_expires_on_its_own_and_preserves_closure(self):
        markt = decode_availability(payload(lastUpdated=NOW - 179), MARKT, NOW)
        achter = decode_availability(payload(ACHTER, open=False, parkingCapacity=430), ACHTER, NOW)
        self.assertEqual(achter['occupied'], 360)
        self.assertFalse(achter['open'])
        feeds = {'parking:markt': markt, 'parking:achterdoelen': achter, 'observations': []}
        self.assertEqual(parking_snapshot(feeds, NOW + 2), {'version': 1, 'facilities': [achter]})
        self.assertEqual(parking_snapshot(feeds, NOW + 181), {'version': 1, 'facilities': []})

    def test_reader_keeps_last_sample_when_provider_replays_old_data(self):
        good = BytesIO(json.dumps(payload()).encode())
        old = BytesIO(json.dumps(payload(lastUpdated=NOW - 30)).encode())
        read = parking_reader(MARKT, 'Basic example')
        with patch('ede_live_parking.urlopen', side_effect=[good, old]) as fetch:
            with patch('ede_live_parking.time.time', return_value=NOW):
                self.assertEqual(read()['timestamp'], NOW - 15)
                with self.assertRaises(ValueError):
                    read()
        request = fetch.call_args.args[0]
        self.assertTrue(request.full_url.endswith(MARKT['nprId']))
        self.assertEqual(request.unredirected_hdrs['Authorization'], 'Basic example')

    def test_catalogue_only_enables_matched_live_ids_and_requires_authorisation(self):
        with patch.dict('ede_live_parking.environ', {}, clear=True):
            self.assertEqual(parking_readers(), [])
        with patch.dict('ede_live_parking.environ', {'EDE_NPR_USERNAME': 'npr', 'EDE_NPR_PASSWORD': 'example'}, clear=True):
            self.assertEqual({key for key, _ in parking_readers()}, {'parking:q-park-markt', 'parking:q-park-achterdoelen'})
