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

    def test_frontage_rejects_a_corner_with_two_equally_plausible_approaches(self):
        parcel, building = box(0, 0, 20, 20), box(6, 6, 14, 14)
        roads = [
            ({'kind': 'residential', 'id': 'w1'}, LineString([(-2, -3), (22, -3)])),
            ({'kind': 'residential', 'id': 'w2'}, LineString([(-3, -2), (-3, 22)])),
        ]
        match = PARCELS['match_frontage']
        buildings = STRtree([building])
        self.assertIsNotNone(match(parcel, building, roads[:1], STRtree([roads[0][1]]),
                                   buildings, 'residential')[0])
        self.assertEqual(match(parcel, building, roads, STRtree([line for _, line in roads]),
                               buildings, 'residential'), (None, 'ambiguous-frontage'))
        self.assertEqual(match(parcel, building, roads[:1], STRtree([roads[0][1]]),
                               STRtree([building, box(5, 1, 15, 4)]), 'residential'), (None, 'no-frontage'))

    def test_private_parcel_categories_leave_shared_and_mixed_use_out(self):
        classify = PARCELS['parcel_use']
        self.assertEqual(classify({'gebruiksdoel': 'woonfunctie', 'aantal_verblijfsobjecten': 1}), 'residential')
        self.assertEqual(classify({'gebruiksdoel': 'industriefunctie,kantoorfunctie'}), 'business')
        self.assertIsNone(classify({'gebruiksdoel': 'woonfunctie', 'aantal_verblijfsobjecten': 12}))
        self.assertIsNone(classify({'gebruiksdoel': 'woonfunctie,winkelfunctie', 'aantal_verblijfsobjecten': 2}))

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
                self.assertIn(row['pilot'], {*PARCELS['PILOTS'], 'map'})

    def test_streamed_tile_preserves_bounds_counts_and_decorative_status(self):
        with gzip.open(ROOT / 'assets/ede-parcel-detail.json.gz') as file:
            index = json.load(file)
        tiles = index['tiles']
        self.assertEqual(len(tiles), len({tile['id'] for tile in tiles}))
        self.assertTrue(any(tile['bounds'][0] < -5412.3 for tile in tiles))
        larger = max(tiles, key=lambda tile: tile['count'])
        with gzip.open(ROOT / 'assets/ede-parcel-tiles' / f"{larger['id']}.json.gz") as file:
            rows = json.load(file)['features']
        self.assertEqual(larger['count'], len(rows))
        bounds = box(*larger['bounds'])
        for row in rows:
            self.assertEqual(row['pilot'], 'map')
            self.assertFalse(row.get('collidable'))
            self.assertTrue(bounds.covers(PARCELS['scene_shape'](row)))


if __name__ == '__main__':
    unittest.main()
