import runpy
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest

from shapely import STRtree
from shapely.geometry import box

TOOLS = Path(__file__).resolve().parents[1] / 'tools'
sys.path.insert(0, str(TOOLS))
from ede_tree_expansion import get_points, match_rows, range_m, rejection_masks


class TreeExpansionTest(unittest.TestCase):
    def test_rd_geometry_clips_exactly_despite_wfs_label(self):
        frame = SimpleNamespace(rd_to_scene=lambda e, n: (e - 173000, n - 450000))
        layer = {
            'type': 'FeatureCollection', 'numberMatched': 2,
            'crs': {'properties': {'name': 'urn:ogc:def:crs:EPSG::4326'}},
            'features': [
                {'id': f'mor_bomen.{i}', 'geometry': {'type': 'Point', 'coordinates': [e, 450010]},
                 'properties': {'id': i}}
                for i, e in [(1, 173010), (2, 173020.1)]
            ]
        }
        self.assertEqual(get_points(layer, frame, (0, 0, 20, 20))[0], (1, (173010, 450010), (10, 10)))
        self.assertEqual(len(get_points(layer, frame, (0, 0, 20, 20))), 1)
        layer['features'][0]['geometry']['coordinates'] = [5.66, 52.04]
        with self.assertRaisesRegex(ValueError, 'Invalid MOR point'):
            get_points(layer, frame, (0, 0, 20, 20))

    def test_one_to_one_and_review_when_nearly_equidistant(self):
        trunks = [SimpleNamespace(rd=(0, 0)), SimpleNamespace(rd=(2.8, 0))]
        records = [(10, (0.14, 0), (0.14, 0)), (11, (2.7, 0), (2.7, 0)),
                   (12, (1.5, 0), (1.5, 0)), (13, (7, 0), (7, 0))]
        matched, review = match_rows(records, trunks, 2.5, review_gap=0.3)
        self.assertEqual({src: target for src, (target, _) in matched.items()}, {0: 0, 1: 1})
        self.assertEqual(review, {2})
        masks = {'water': STRtree([box(6, -1, 8, 1)])}
        self.assertEqual(dict(rejection_masks(records, masks)), {3: ['water']})

    def test_expanded_record_has_two_optional_tail_bytes(self):
        script = runpy.run_path(str(TOOLS / 'build-ede-trees.py'))
        tree = script['Tree']((0, 0), (0, 0), height=12, crown_width=6.5, species=0, season_group=6,
                              sources=16 | 64 | 128)
        data = script['pack']([tree])
        self.assertEqual(data[:4], b'EDT3')
        self.assertEqual(data[16:], bytes([16 | 64 | 128, 65, 6]))

    def test_original_class_intervals_are_preserved(self):
        self.assertEqual(range_m('e- 15 tot 18 m.'), [15, 18])
        self.assertEqual(range_m('g- 24 m. en hoger'), (24, None))
        self.assertEqual(range_m('tot 0,2 m.'), (0, 0.2))


if __name__ == '__main__':
    unittest.main()
