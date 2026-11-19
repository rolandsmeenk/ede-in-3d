"""Source identities, bearings and face coverage in the Ede sign import."""

from collections import Counter
import gzip
import json
from pathlib import Path
import runpy
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / 'tools'
sys.path.insert(0, str(TOOLS))
try:
    IMPORTER = runpy.run_path(str(TOOLS / 'build-ede-street-signs.py'))
finally:
    sys.path.pop(0)


class EdeStreetSignsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = json.loads(gzip.decompress(IMPORTER['SNAPSHOT'].read_bytes()))
        cls.signs = IMPORTER['sign_records'](cls.raw, IMPORTER['scene_metadata']())

    def test_keeps_latest_feature_and_separate_colocated_ids(self):
        rows = [{'id': 'a', 'when': 1}, {'id': 'a', 'when': 2}, {'id': 'b', 'when': 1}]
        distinct = IMPORTER['distinct'](rows, lambda f: f['id'], lambda f: f['when'])
        self.assertEqual(distinct, rows[1:])

    def test_source_bearing_and_restrictions_survive_import(self):
        signs = {s['id']: s for s in self.signs}
        self.assertEqual(len(signs), len(self.signs))
        source = self.raw['ndw'][0]
        original = source['properties']
        projected = signs[source['id']]
        self.assertEqual(projected['sourceBearing'], original['bearing'])
        self.assertEqual(projected['bearing'], (original['bearing'] + 180) % 360)
        self.assertEqual(projected['conditions'], original['conditions'])
        self.assertEqual(projected['supplementarySigns'], original['supplementarySigns'])
        self.assertTrue(any(s.get('nwbDistance', 100) < 10 and 'appliesBearing' in s for s in self.signs))
        self.assertIn('wayfinder', Counter(s['kind'] for s in self.signs))

    def test_atlas_faces_follow_recorded_values(self):
        keys = {IMPORTER['face_key'](s) for s in self.signs}
        index = json.loads(IMPORTER['ATLAS'].read_bytes())
        self.assertIn('A1:30:BEGIN', index['frames'])
        self.assertIn('A2:30:END', index['frames'])
        self.assertIn('D2:LO', index['frames'])
        self.assertNotIn('onbekend', index['frames'])
        self.assertLessEqual(set(index['frames']), keys)
        for x, y, width, height in index['frames'].values():
            self.assertGreater(width * height, 0)
            self.assertLessEqual(x + width + 4, index['width'])
            self.assertLessEqual(y + height + 4, index['height'])


if __name__ == '__main__':
    unittest.main()
