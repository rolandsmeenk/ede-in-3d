import runpy
import sys
import unittest
from pathlib import Path

from shapely import union_all
from shapely.geometry import Point


TOOLS = Path(__file__).resolve().parents[1] / 'tools'
sys.path.insert(0, str(TOOLS))
travel_masks = runpy.run_path(str(TOOLS / 'build-ede-fields.py'))['travel_masks']


class FieldTravelTest(unittest.TestCase):
    def test_unsealed_paths_and_partially_surveyed_tracks_exclude_crops(self):
        def strip(north, kind, material, layer=0):
            return {'layer': layer, 'function': kind, 'material': material,
                    'polygons': [[[0, north, 8, north, 8, north + 1, 0, north + 1]]]}

        survey = {'covered': {'track': [0]}, 'surfaces': [
            strip(5, 'voetpad', 'sand'), strip(10, 'fietspad', 'gravel'),
            strip(20, 'berm', 'gravel'), strip(25, 'ruiterpad', 'sand', layer=1),
        ]}
        road = {'id': 'track', 'bridge': False, 'tunnel': False, 'width': 1, 'pts': [0, 0, 10, 0, 20, 0]}
        exclusions = union_all(list(travel_masks([road], [survey])))
        for x, z in [(5, 5.5), (5, 4.6), (5, 10.5), (15, 1.1)]:
            self.assertTrue(exclusions.covers(Point(x, z)), (x, z))
        for x, z in [(5, 0), (5, 20.5), (5, 25.5), (15, 2)]:
            self.assertFalse(exclusions.covers(Point(x, z)), (x, z))


if __name__ == '__main__':
    unittest.main()
