"""Regression checks for 1GIS railing spans that crossed lower road levels."""

import gzip
import json
import math
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
FIXED = {
    2102677803: 'n224-a30-upper-',
    2102708871: 'maanderbroek-link-upper-',
    2102709691: 'maanderbroek-link-upper-',
    2102710466: 'maanderdijk-passage-upper-',
    2102710485: 'maanderdijk-passage-upper-',
    2102710663: 'maanderbroek-link-upper-',
    2102711072: 'maanderbroek-link-upper-',
}
MAANDERBROEK_UPPER = {21745, 24978, 6539}
MAANDERBROEK_CONFLICT = 13345


class Ede1gisBarrierTest(unittest.TestCase):
    def test_no_known_fence_can_reappear_on_lower_level(self):
        with gzip.open(ROOT / 'assets/ede-1gis-detail.json.gz', 'rt', encoding='utf-8') as file:
            features = json.load(file)['features']
        corrected = set()
        for feature in features:
            if feature['type'] != 'fence' or feature['collection'] != 31:
                continue
            source_id = feature['sourceId']
            profile = FIXED.get(int(source_id)) if source_id.isdecimal() else None
            if source_id == '2102710985':
                object_id = feature['objectId']
                self.assertNotEqual(object_id, MAANDERBROEK_CONFLICT)
                if object_id in MAANDERBROEK_UPPER:
                    profile = 'maanderbroek-a30-a12-upper-'
            if profile:
                if source_id.isdecimal():
                    corrected.add(int(source_id))
                self.assertGreater(feature['level'], 0, feature['id'])
                self.assertTrue(feature['profileId'].startswith(profile), feature['id'])
                if profile.startswith('maanderdijk'):
                    self.assertEqual(len(feature['points']), len(feature['deckShoulder']))
                    distance = [math.dist(a, b) for a, b in zip(feature['points'], feature['deckShoulder'])]
                    self.assertTrue(all(0 < width < 5 for width in distance))
                else:
                    self.assertIn('surfaceId', feature)

        self.assertTrue(FIXED.keys() <= corrected)

    def test_expanded_motorway_has_east_and_north_guardrails(self):
        with gzip.open(ROOT / 'assets/ede-1gis-detail.json.gz', 'rt', encoding='utf-8') as file:
            asset = json.load(file)
        features = {feature['id']: feature for feature in asset['features']}
        for key in ('1gis:23:2103956779', '1gis:23:2103958813@20269'):
            self.assertEqual(features[key]['type'], 'guardrail')
        self.assertEqual(len(features), len(asset['features']))


if __name__ == '__main__':
    unittest.main()
