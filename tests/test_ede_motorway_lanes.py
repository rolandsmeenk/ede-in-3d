"""Directed OSM carriageway matching and published WEGGEG transition provenance."""

import json
from pathlib import Path
import runpy
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / 'tools'
sys.path.insert(0, str(TOOLS))
IMPORTER = runpy.run_path(str(TOOLS / 'build-ede-motorway-lanes.py'))
sys.path.pop(0)


class EdeMotorwayLanesTest(unittest.TestCase):
    def test_rejects_closer_opposite_and_parallel_carriageways(self):
        segment = IMPORTER['Segment']
        index = IMPORTER['SegmentIndex']([
            segment((0, 3), (20, 3), 'correct'),
            segment((20, 0), (0, 0), 'wrongDirection'),
            segment((0, 1), (20, 1), 'wrongCarriageway'),
        ])
        roads = {name: ({'reverse': False}, None) for name in ('correct', 'wrongDirection', 'wrongCarriageway')}
        tags = {
            'correct': {'ref': 'A30', 'carriageway_ref': 'Re'},
            'wrongDirection': {'ref': 'A30', 'carriageway_ref': 'Re'},
            'wrongCarriageway': {'ref': 'A30', 'carriageway_ref': 'b'},
        }
        record = {'route': 'A30', 'carriagewayRef': 'Re'}
        heading = segment((0, 0), (20, 0), None)
        self.assertEqual(IMPORTER['nearest_way']((10, 0), heading, index, roads, tags, record), 'correct')

    def test_offline_build_preserves_the_a12_a30_connector_taper(self):
        snapshot = json.loads(IMPORTER['SNAPSHOT'].read_text())
        review = json.loads(IMPORTER['REVIEW'].read_text())
        asset = IMPORTER['build'](snapshot, IMPORTER['read_scene'](), review)
        self.assertEqual(asset, json.loads(IMPORTER['OUTPUT'].read_text()))
        transition = next(row for row in asset['transitions'] if row['fromWay'] == '663875342')
        self.assertEqual(transition['toWay'], '6960093')
        self.assertEqual(transition['world'], [-4006.3, 2124.9])
        record = asset['records'][transition['record']]
        self.assertEqual(record['nwbId'], 341296004)
        self.assertEqual((record['beginOffsetM'], record['endOffsetM']), (662, 704))
        self.assertEqual((record['beginLanes'], record['endLanes']), (2, 1))
        for way, lanes in [('663875342', 2), ('6960093', 1)]:
            span, = asset['ways'][way]
            self.assertEqual((span['start'], span['end'], span['direction'], span['lanes']), (0, 1, 'forward', lanes))
            self.assertIn(transition['record'], span['records'])
        self.assertNotIn('373094912', asset['ways'])
        self.assertTrue(any(row.get('way') == '373094912' and row['osmLanes'] == 3 for row in asset['review']))


if __name__ == '__main__':
    unittest.main()
