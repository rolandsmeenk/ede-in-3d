import runpy
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest

from shapely import STRtree
from shapely.geometry import LineString, Point, Polygon, box

TOOLS = Path(__file__).resolve().parents[1] / 'tools'
sys.path.insert(0, str(TOOLS))
from ede_municipal_detail import grouped, placement, points


class MunicipalDetailTest(unittest.TestCase):
    def test_rd_override_clips_after_projection_and_preserves_coincident_records(self):
        frame = SimpleNamespace(rd_to_scene=lambda e, n: (e - 173000, n - 450000))
        feature = lambda number, e: {
            'id': f'mor_acv_containers.{number}', 'properties': {'kvid': number},
            'geometry': {'type': 'Point', 'coordinates': [e, 450010]}
        }
        data = {
            'type': 'FeatureCollection', 'numberMatched': 4, 'timeStamp': '2026-11-20T12:08:31Z',
            'crs': {'properties': {'name': 'urn:ogc:def:crs:EPSG::4326'}},
            'features': [feature(4, 173010), feature(2, 173010), feature(8, 173021), feature(9, 173015)]
        }
        boundary = Polygon([(0, 0), (20, 0), (20, 20), (0, 20)],
                           [[(13, 5), (18, 5), (18, 15), (13, 15)]])
        records = points(data, 'container', frame, boundary)
        self.assertEqual([r['id'] for r in records], ['mor_acv_containers.2', 'mor_acv_containers.4'])
        self.assertEqual(grouped(records), [records])
        data['features'][0]['geometry']['coordinates'] = [5.66, 52.04]
        with self.assertRaisesRegex(ValueError, 'Unexpected RD'):
            points(data, 'container', frame, boundary)

    def test_footway_adjustment_stays_on_support_and_never_moves_a_lane_conflict(self):
        line = LineString([(0, -2), (0, 2)])
        dims = (.46, .46, .91)
        foot = STRtree([line])
        empty = STRtree([])
        pavements = STRtree([box(-2, -3, 2, 3)])
        footprint = runpy.run_path(str(TOOLS / 'build-ede-bgt-detail.py'))['footprint']
        traffic = {'walking-line': STRtree([line.buffer(.7, cap_style='flat')])}
        index = (traffic, pavements, empty, foot, empty, empty, empty, empty, None)
        prop, audit = placement(Point(.86, 0), dims, index, ([], empty), None, footprint)
        self.assertEqual(prop['position'], [1.06, 0])
        self.assertEqual(prop['baseOffset'], .065)
        self.assertEqual(audit['adjustment'], .2)
        traffic['vehicle-or-cycle-paving'] = STRtree([box(.75, -2, 2, 2)])
        prop, audit = placement(Point(.86, 0), dims, index, ([], empty), None, footprint)
        self.assertIsNone(prop)
        self.assertIn('vehicle-or-cycle-paving', audit['reasons'])

    def test_photo_verified_bin_can_move_out_of_facade_without_guessing_an_entrance(self):
        empty = STRtree([])
        pavement = STRtree([box(-2, -2, 2, 2)])
        obstacles = {'building': STRtree([box(0, -2, 2, 2)])}
        index = (obstacles, pavement, empty, empty, empty, empty, empty, empty, None)
        footprint = runpy.run_path(str(TOOLS / 'build-ede-bgt-detail.py'))['footprint']
        site = Point(-.1, 0)
        prop, _ = placement(site, (.42, .74, 1.02), index, ([], empty), None, footprint)
        self.assertIsNone(prop)
        prop, audit = placement(site, (.42, .74, 1.02), index, ([], empty), None, footprint, -1.5708)
        self.assertEqual(prop['position'], [-.25, 0])
        self.assertEqual(audit['orientation'], 'reviewed facade photo')


if __name__ == '__main__':
    unittest.main()
