import gzip
import importlib.util
import json
from math import floor
from pathlib import Path
import unittest

from shapely import Point, box

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    'road_furniture', ROOT / 'scripts/fetch-road-furniture.py')
furniture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(furniture)


class RoadFurnitureTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.frame = furniture.Frame(furniture.load_scene_metadata()['lonLatAffine'])

    def test_daytime_badge_only_on_motorway_mainline(self):
        for road in ('A12', 'A30'):
            for side in ('Re', 'Li'):
                self.assertTrue(furniture.daytime_badge(road, side, '', 'R'))
                self.assertFalse(furniture.daytime_badge(road, side, 'a', 'R'))
                self.assertFalse(furniture.daytime_badge(road, side, '', 'B'))
        self.assertFalse(furniture.daytime_badge('N224', 'Re', '', 'R'))
        self.assertFalse(furniture.daytime_badge('A12', '', '', 'R'))

    def test_cell_index_round_trips_signed_scene_coordinates(self):
        cases = [('west', (-500.01, -0.01)), ('east', (500.01, 0.01)),
                 ('outside', (700.01, 0.01)), ('west', (-500.01, -0.01))]
        records = [(self.frame.scene_to_rd(*position), {'id': key}) for key, position in cases]
        index = furniture.index_records(records, box(-600, -100, 600, 100), self.frame)
        self.assertEqual(set(index['cells']), {'-2/-1', '1/0'})
        self.assertEqual(sum(map(len, index['cells'].values())), 2)
        e, n = index['rdOrigin']
        west = index['cells']['-2/-1'][0]
        dx, dz = west['sceneCorrection']
        self.assertAlmostEqual(west['rdX'] - e + dx, -500.01, places=4)
        self.assertAlmostEqual(n - west['rdY'] + dz, -0.01, places=4)

    def test_published_index_clips_and_buckets_each_source(self):
        path = ROOT / 'assets/ede-road-furniture.json.gz'
        with gzip.open(path, 'rt') as stream:
            index = json.load(stream)
        boundary = furniture.load_playable_boundary()
        e, n = index['rdOrigin']
        ids, kinds, roads, exits, surveyed = set(), set(), set(), set(), set()
        for cell, rows in index['cells'].items():
            for row in rows:
                dx, dz = row['sceneCorrection']
                x, z = row['rdX'] - e + dx, n - row['rdY'] + dz
                self.assertTrue(boundary.covers(Point(x, z)), row['id'])
                self.assertEqual(cell, f'{floor(x / index["cellSize"])}/{floor(z / index["cellSize"])}')
                self.assertNotIn(row['id'], ids)
                ids.add(row['id'])
                kinds.add(row['type'])
                if row['type'] == 'hecto':
                    self.assertRegex(row['hectometer'], r'^\d+,\d$')
                    roads.add(row['wegnummer'])
                elif row['type'] == 'exit':
                    exits.add((row['roadRef'], row['exitNumber']))
                    if row['isOverheadGantry']:
                        self.assertEqual(row['id'], row['surveyedId'])
                        self.assertEqual(len(row['span']), 2)
                        self.assertGreater(row['centerNap'], 0)
                        surveyed.add((row['roadRef'], row['exitNumber']))
        self.assertEqual(kinds, {'hecto', 'rvv', 'exit'})
        self.assertEqual(roads, furniture.ROADS)
        self.assertEqual(exits, {('A12', '24'), ('A12', '25'), ('A30', '1'), ('A30', '2'), ('A30', '3')})
        self.assertEqual(surveyed, {('A12', '24'), ('A30', '1')})


if __name__ == '__main__':
    unittest.main()
