import gzip
import json
from pathlib import Path
import runpy
import sys
import unittest

from shapely import STRtree
from shapely.geometry import LineString, box

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
PARCELS = runpy.run_path(str(ROOT / 'tools/build-ede-parcel-detail.py'))


class IdentityFrame:
    def rd_to_scene(self, x, z):
        return x, z


class ParcelBakeTest(unittest.TestCase):
    def test_closed_fence_keeps_its_closing_segment_at_export_resolution(self):
        fence = LineString([(1, 1), (1.001, 1), (3, 1), (3, 3), (1, 1)])
        encoded = PARCELS['to_scene_record'](fence, IdentityFrame())
        self.assertEqual(encoded['points'], [(1, 1), (3, 1), (3, 3), (1, 1)])

    def test_mapped_barrier_respects_access_and_uses_bgt_alignment_where_it_overlaps(self):
        osm = [('w1', {'barrier': 'fence', 'fence_type': 'wood'}, LineString([(0, 0), (14, 0)]))]
        feature = {'id': 'Gtest', 'source': 'bgt', 'type': 'fence', 'level': 0, 'height': 1.25, 'width': .1,
                   'points': [[0, .2], [5, .2]], 'collidable': True}
        known = LineString(feature['points'])
        access = box(8, -2, 10, 2)
        rows, replaces = PARCELS['import_barriers'](
            osm, [(feature, known)], STRtree([known]), IdentityFrame(), box(-1, -5, 15, 5), STRtree([access]), [])
        self.assertEqual(replaces, {'Gtest'})
        self.assertEqual(rows[0]['points'], feature['points'])
        self.assertEqual(rows[0]['style'], 'timber')
        self.assertEqual(len(rows), 3)
        for feature in rows:
            line = LineString(feature['points'])
            self.assertEqual(line.buffer(feature['width'] / 2).intersection(access).area, 0)

    def test_packed_asset_has_provenance_and_inference_stays_decorative(self):
        with gzip.open(ROOT / 'assets/ede-parcel-detail.json.gz') as file:
            asset = json.load(file)
        ids = {row['id'] for row in asset['features']}
        self.assertEqual(len(ids), len(asset['features']))
        self.assertEqual({f'parcel:bgt:{identity}' for identity in asset['replaces']},
                         {identity for identity in ids if identity.startswith('parcel:bgt:')})
        for row in asset['features']:
            self.assertTrue(row['sourceIds'])
            if row['status'] == 'inferred':
                self.assertFalse(row.get('collidable'))
                self.assertIn(row['pilot'], PARCELS['PILOTS'])


if __name__ == '__main__':
    unittest.main()
