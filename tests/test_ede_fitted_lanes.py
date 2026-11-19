"""Swept clearance and the versioned offline Ede lane export."""

import gzip
import json
import math
from pathlib import Path
import runpy
import sys
import unittest

from shapely.geometry import Polygon, box

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / 'tools'
sys.path.insert(0, str(TOOLS))
BAKER = runpy.run_path(str(TOOLS / 'build-ede-fitted-lanes.py'))
sys.path.pop(0)


class EdeFittedLanesTest(unittest.TestCase):
    def test_aerial_boundaries_can_widen_a_four_lane_approach(self):
        edge = {'laneDefinition': {'lanes': [{'offset': offset, 'width': 2.45}
                                             for offset in (-3.675, -1.225, 1.225, 3.675)]}}
        hits = [(-5.55, 'edge', 'curb', 'aerial'), (-2.05, 'divider', 'divider-1', 'aerial'),
                (1.85, 'divider', 'divider-2', 'aerial'), (5.15, 'divider', 'divider-3', 'aerial')]
        fitted, matched = BAKER['marking_fit'](edge, hits, False)
        self.assertEqual(len(fitted), 4)
        self.assertEqual(matched, hits)
        for (_, width), expected in zip(fitted[:3], (3.5, 3.9, 3.3)):
            self.assertAlmostEqual(width, expected)
        self.assertTrue(3.2 < fitted[3][1] < 3.9)

    def test_swept_footprint_preserves_pavement_holes_and_deck_ends(self):
        rows = [(0, 0, 0, 3.2), (20, 20, 0, 3.2)]
        deck = box(0, -2, 20, 2)
        self.assertTrue(BAKER['swept'](rows, deck, segment=True))
        self.assertFalse(BAKER['swept'](rows, deck))
        pavement = Polygon(deck.exterior.coords, [box(9, 1.04, 11, 1.95).exterior.coords])
        # A centre line would fit here, but a full vehicle would clip the island.
        self.assertFalse(BAKER['swept'](rows, pavement, segment=True))

    def test_export_has_monotonic_original_and_fitted_distances(self):
        with gzip.open(ROOT / 'assets/ede-fitted-lanes.json.gz') as source:
            asset = json.load(source)
        self.assertEqual(asset['version'], 1)
        self.assertEqual(asset['gisVersion'], BAKER['GIS_VERSION'])
        edge_examples = {'w1156964960': 'bgt+aerial', 'w6953282': 'bgt', 'w840619077': 'bgt',
                         'w723962249': '1gis', 'w6960104': '1gis'}
        for way, expected in edge_examples.items():
            sources = [row['source'] for key, row in asset['edges'].items() if f'|{way}|' in key]
            self.assertTrue(any(source.startswith(expected) for source in sources), way)

        curves = [lane for edge in asset['edges'].values() for lane in edge['lanes'] if lane]
        curves.extend(lane for starts in asset['connectors'].values() for ends in starts.values()
                      for lane in ends.values())
        for lane in curves:
            self.assertEqual(lane[0], 0)
            self.assertEqual(lane[3], 0)
            self.assertEqual(len(lane) % 5, 0)
            for i in range(5, len(lane), 5):
                self.assertGreater(lane[i], lane[i - 5])
                self.assertGreater(lane[i + 3], lane[i - 2])
                self.assertGreater(lane[i + 4], 0)
                step = math.hypot(lane[i + 1] - lane[i - 4], lane[i + 2] - lane[i - 3])
                self.assertAlmostEqual(lane[i + 3] - lane[i - 2], step, delta=.001001)


if __name__ == '__main__':
    unittest.main()
