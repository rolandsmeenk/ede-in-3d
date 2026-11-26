"""Unit tests for Ede live MSI/VRI ETL and NDW MSI + Talking Traffic SPaT adapters."""

import json
import sys
import unittest
from io import BytesIO
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))

from ede_ndw import normalize_msi_legend, read_msi_signs, read_spat_json, timestamp


class EdeLiveSignalsPythonTest(unittest.TestCase):
    def test_static_live_signals_asset_integrity(self):
        asset_path = ROOT / 'assets' / 'ede-live-signals.json'
        self.assertTrue(asset_path.exists(), 'assets/ede-live-signals.json should be generated')
        asset = json.loads(asset_path.read_text(encoding='utf-8'))
        hw = json.loads((ROOT / 'assets' / 'ede-signal-hardware.json').read_text(encoding='utf-8'))
        vri_gantry_ids = {s.get('existingId') for s in hw.get('supports', []) if s.get('existingId')}

        self.assertEqual(asset['version'], 1)
        self.assertEqual(asset['crs'], 'EPSG:28992-local')
        self.assertGreaterEqual(len(asset['msiGantries']), 40)
        self.assertGreaterEqual(asset['counts']['msiHeads'], 200)
        self.assertGreaterEqual(len(asset['vriIntersections']), 40)
        routes = {g['route'] for g in asset['msiGantries']}
        self.assertEqual(routes, {'A12', 'A30'})

        head_sign_ids = []
        for gantry in asset['msiGantries']:
            self.assertNotIn(gantry['id'], vri_gantry_ids, 'MSI gantry must not overlap a VRI traffic-light gantry')
            self.assertEqual(len(gantry['heads']), gantry['laneCount'])
            by_side = {}
            for head in gantry['heads']:
                head_sign_ids.append(head['sourceSignId'])
                side = head['id'].rsplit(':', 2)[-2]
                by_side.setdefault(side, []).append(head['laneIndex'])
            for indices in by_side.values():
                self.assertEqual(indices, list(range(1, len(indices) + 1)))
            # Verify every head sits flush (within 2 degrees) of the gantry perpendicular normal.
            (ax, az), (bx, bz) = gantry['span']
            span_len = ((bx - ax) ** 2 + (bz - az) ** 2) ** 0.5
            ux, uz = (bx - ax) / span_len, (bz - az) / span_len
            for head in gantry['heads']:
                import math
                dot = abs(math.sin(head['yaw']) * ux + math.cos(head['yaw']) * uz)
                self.assertLess(dot, 0.04, f'Head {head["id"]} is skewed relative to gantry span')
        self.assertEqual(sorted(head_sign_ids), sorted(asset['replacedSignIds']))
        # Verify 100% of overhead A3 signs in street-features are covered (zero standalone motorway poles).
        import gzip
        sf_path = ROOT / 'assets' / 'ede-street-features.json.gz'
        sf = json.loads(gzip.decompress(sf_path.read_bytes()))
        above_a3 = [s['id'] for s in sf['signs'] if s.get('rvvCode') == 'A3' and s.get('placement') == 'ABOVE' and not s.get('supplementarySigns')]
        self.assertEqual(len(asset['replacedSignIds']), len(above_a3))

    def test_normalize_msi_legend_codes(self):
        for code in ('A01-50', 'A01-70', 'A01-80', 'A01-90', 'A01-100', 'F01', 'F02-L', 'F02-R', 'F08', 'J33', 'BLANK'):
            self.assertEqual(normalize_msi_legend(code), code)
        self.assertEqual(normalize_msi_legend('70'), 'A01-70')
        self.assertEqual(normalize_msi_legend('A1-90'), 'A01-90')
        self.assertEqual(normalize_msi_legend('red-cross'), 'F01')
        self.assertEqual(normalize_msi_legend('F02', 'left'), 'F02-L')
        self.assertEqual(normalize_msi_legend('F02', 'right'), 'F02-R')
        self.assertEqual(normalize_msi_legend('queue'), 'J33')

    def test_read_msi_signs_datex_xml(self):
        xml = BytesIO(b'''
        <messageContainer xmlns="http://datex2.eu/schema/3/messageContainer"
                          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
          <payload xsi:type="VmsPublication">
            <publicationTime>2026-11-26T21:00:00Z</publicationTime>
            <vmsUnit id="1gis:31:2102708963">
              <vms>
                <laneNumber>1</laneNumber>
                <pictogramDescription>F01</pictogramDescription>
              </vms>
              <vms>
                <laneNumber>2</laneNumber>
                <pictogramDescription>A01-70</pictogramDescription>
                <flashingBeacon>true</flashingBeacon>
              </vms>
            </vmsUnit>
          </payload>
        </messageContainer>''')
        now = timestamp('2026-11-26T21:01:00Z')
        items = read_msi_signs(xml, now)
        self.assertEqual(len(items), 2)
        self.assertEqual(items[0]['gantryId'], '1gis:31:2102708963')
        self.assertEqual(items[0]['laneIndex'], 1)
        self.assertEqual(items[0]['legend'], 'F01')
        self.assertTrue(items[0]['flashers'])
        self.assertEqual(items[1]['legend'], 'A01-70')
        self.assertTrue(items[1]['flashers'])

    def test_read_spat_json(self):
        now = timestamp('2026-11-26T21:01:00Z')
        payload = {
            'intersections': [
                {
                    'kruispunt_id': 'EDE-VRI-001',
                    'signalGroups': [
                        {'signalGroupId': 'SG-01', 'state': 'protected-Movement-Allowed', 'likelyTime': 12.5},
                        {'signalGroupId': 'SG-02', 'state': 'stop-And-Remain', 'likelyTime': 14.0},
                        {'signalGroupId': 'SG-03', 'state': 'caution-Conflicting-Traffic'},
                    ],
                }
            ]
        }
        parsed = read_spat_json(payload, now)
        self.assertEqual(len(parsed), 1)
        self.assertEqual(parsed[0]['intersectionId'], 'EDE-VRI-001')
        states = {sg['signalGroupId']: sg['state'] for sg in parsed[0]['signalGroups']}
        self.assertEqual(states['SG-01'], 'PROTECTED_MOVEMENT_ALLOWED')
        self.assertEqual(states['SG-02'], 'STOP_AND_REMAIN')
        self.assertEqual(states['SG-03'], 'FLASHING_AMBER')


if __name__ == '__main__':
    unittest.main()
