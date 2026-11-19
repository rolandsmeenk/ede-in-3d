"""Check the parking fitter and the checked-in inventory."""
import collections
import gzip
import json
import math
from pathlib import Path
import runpy
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / 'tools'
try:
    import osmium
    from shapely import STRtree
    from shapely.geometry import LineString, Point, box
except ImportError:
    BUILDER = None
else:
    sys.path.insert(0, str(TOOLS))
    try:
        BUILDER = runpy.run_path(str(TOOLS / 'build-ede-parking.py'))
    finally:
        sys.path.pop(0)


class ParkingInventoryTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with gzip.open(ROOT / 'assets/ede-parking-spaces.json.gz', 'rt') as source:
            cls.data = json.load(source)

    @unittest.skipUnless(BUILDER, 'requires the parking builder’s geometry dependencies')
    def test_row_fits_parallel_perpendicular_and_diagonal(self):
        fit = BUILDER['fit_rows']
        footprint = BUILDER['footprint']
        for angle, row, expected in [(0, box(0, 0, 20, 2.2), 3),
                                     (90, box(0, 0, 12, 5), 5),
                                     (45, box(0, 0, 12, 5), 3)]:
            stalls = fit(row, 0, angle)
            self.assertEqual(len(stalls), expected)
            for point, radians, orientation in stalls:
                self.assertEqual(orientation, angle)
                self.assertTrue(row.covers(footprint(point.x, point.y, radians)))
        self.assertEqual(fit(box(0, 0, 9, 1.5), 0, 0), [])

    @unittest.skipUnless(BUILDER, 'requires the parking builder’s geometry dependencies')
    def test_wkd_match_uses_line_direction_and_same_level(self):
        feature, spatial = BUILDER['Feature'], BUILDER['Spatial']
        road = feature('osm', LineString([(0, 0), (12, 0)]), 0)
        wkd = spatial([feature('wkd', LineString([(12, 1), (0, 1)]), 0, {'zijde': 'links'})])
        match = BUILDER['find_wkd']
        self.assertEqual(match(wkd, road, Point(6, 0), 'right', 0), 'wkd')
        self.assertIsNone(match(wkd, road, Point(6, 0), 'left', 0))
        self.assertIsNone(match(wkd, feature('bridge', road.shape, 1), Point(6, 0), 'right', 0))
        self.assertIsNone(match(wkd, road, Point(6, 0), 'right', math.pi / 2))

    def test_inventory_spaces_are_unique(self):
        spaces = self.data['spaces']
        self.assertGreater(len(spaces), 10_000)
        self.assertEqual(len(spaces), len({space['id'] for space in spaces}))
        counts = collections.Counter(space['areaId'] for space in spaces)
        self.assertEqual(dict(counts), {area['id']: area['fittedSpaces'] for area in self.data['areas']})
        angles = {space['orientation'] for space in spaces}
        self.assertEqual(angles, {'parallel', 'diagonal', 'perpendicular'})
        for space in spaces:
            self.assertTrue(-math.pi <= space['heading'] <= math.pi)
            self.assertFalse(space['maneuver'] and space['wayId'] is None)
            self.assertTrue(math.isfinite(space['y']))

    @unittest.skipUnless(BUILDER, 'requires the parking builder’s geometry dependencies')
    def test_inventory_footprints_do_not_overlap(self):
        by_layer = collections.defaultdict(list)
        footprint = BUILDER['footprint']
        for space in self.data['spaces']:
            by_layer[space['layer']].append(footprint(space['x'], space['z'], math.pi / 2 - space['heading']))
        for footprints in by_layer.values():
            tree = STRtree(footprints)
            for a, b in zip(*tree.query(footprints, predicate='intersects')):
                if a < b:
                    self.assertLess(footprints[a].intersection(footprints[b]).area, .12)

    def test_kuiperplein_uses_scene_relative_ground_height(self):
        sys.path.insert(0, str(TOOLS))
        try:
            terrain = runpy.run_path(str(TOOLS / 'build-ede-grade.py'))['Terrain']()
        finally:
            sys.path.pop(0)
        spaces = [row for row in self.data['spaces'] if row['areaId'] == 'kuiperplein']
        self.assertGreater(len(spaces), 50)
        for space in spaces:
            self.assertAlmostEqual(space['y'], terrain.at((space['x'], space['z'])) - terrain.nap, delta=.01)

    def test_kuiperplein_public_gate_and_sample_street(self):
        aisles = {road['id']: road for road in self.data['aisles'] if road['areaId'] == 'kuiperplein'}
        gate = aisles['w1055118985']
        self.assertTrue(gate['yield'])
        self.assertEqual(gate['approachWayId'], 'w1337350654')
        self.assertEqual(gate['junction'], [-251.8, 129.5])
        ring = aisles['w23486745']['pts']
        self.assertIn(tuple(gate['pts'][:2]), set(zip(ring[::2], ring[1::2])))
        self.assertTrue(any(s['maneuver'] and s['areaId'] == 'kuiperplein' for s in self.data['spaces']))
        self.assertTrue(any(s['maneuver'] and s.get('street') == 'Parkweg' for s in self.data['spaces']))


if __name__ == '__main__':
    unittest.main()
