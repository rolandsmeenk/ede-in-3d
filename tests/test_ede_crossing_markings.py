"""Crossing paint evidence must not depend on signal or priority controls."""

from importlib.util import find_spec
from pathlib import Path
import runpy
import sys
import unittest


TOOLS = Path(__file__).resolve().parents[1] / 'tools'


@unittest.skipUnless(find_spec('shapely') and find_spec('pyproj'), 'requires Shapely and pyproj')
class CrossingMarkingsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        sys.path.insert(0, str(TOOLS))
        importer = runpy.run_path(str(TOOLS / 'build-ede-street-surfaces.py'))
        cls.resolve = staticmethod(importer['apply_crossing_marking'])
        cls.review = staticmethod(importer['marking_reviews'])
        features = runpy.run_path(str(TOOLS / 'build-ede-street-features.py'))
        cls.preserve_ids = staticmethod(features['preserve_surface_ids'])

    def test_non_zebra_styles_do_not_change_signal_control(self):
        for raw, style in [(None, None), ('no', 'no'), ('dots', 'dots'), ('dashes', 'dashes'), ('zebrafake', 'zebrafake')]:
            with self.subTest(raw=raw):
                crossing = {'control': 'signal', 'sources': [{'source': 'osm', 'markings': raw}]}
                self.resolve(crossing)
                self.assertEqual(crossing['control'], 'signal')
                self.assertEqual(crossing['markings'], style)
                self.assertFalse(crossing['marked'])
                self.assertNotIn('markingEvidence', crossing)

    def test_documented_osm_zebra_and_legacy_tag_are_explicit_evidence(self):
        for raw in [{'markings': 'zebra'}, {'markings': 'zebra:paired'}, {'crossing': 'zebra'}]:
            crossing = {'control': 'signal', 'sources': [{'source': 'osm', **raw}]}
            self.resolve(crossing)
            self.assertTrue(crossing['marked'])
            self.assertEqual(crossing['markingEvidence'], 'osm')
            self.assertEqual(crossing['control'], 'signal')

    def test_vop_and_conflicting_osm_tags_require_review(self):
        crossing = {'id': 'vop', 'control': 'signal', 'sources': [{'source': 'vop'}]}
        self.resolve(crossing)
        self.assertEqual(crossing['markingEvidence'], 'vop')
        crossing['sources'].append({'source': 'osm', 'markings': 'dashes'})
        self.resolve(crossing)
        self.assertFalse(crossing['marked'])
        self.assertEqual(crossing['markings'], 'dashes')
        self.assertEqual(crossing['markingReview'], 'conflicting-markings')
        self.review([crossing], {'vop': dict(markings='zebra', imagery='https://example.test/image',
                                           date='2026-11-19', note='Paint confirmed on the matched carriageway')})
        self.assertTrue(crossing['marked'])
        self.assertEqual(crossing['markingEvidence'], 'pdok')
        self.assertEqual(crossing['control'], 'signal')
        self.assertNotIn('markingReview', crossing)

    def test_vop_preserves_explicit_zebra_variant_overlay_and_colours(self):
        crossing = {'control': 'uncontrolled', 'sources': [
            {'source': 'vop'},
            {'source': 'osm', 'crossing': 'zebra', 'markings': 'zebra:bicolour;dots',
             'markingColour': 'white;red'},
        ]}
        self.resolve(crossing)
        self.assertTrue(crossing['marked'])
        self.assertEqual(crossing['markings'], 'zebra:bicolour;dots')
        self.assertEqual(crossing['markingColour'], 'white;red')
        self.assertEqual(crossing['markingEvidence'], 'vop')
        self.assertEqual(crossing['control'], 'uncontrolled')


    def test_regrouped_crossing_keeps_existing_id_through_same_level_source(self):
        def feature(identity, sources, layer=0):
            return dict(id=identity, sources=sources, layer=layer, bridge=False, tunnel=False)

        osm = dict(source='osm', id='n12')
        vop = dict(source='vop', id='32451')
        previous = {'bumps': [], 'crossings': [feature('osm-crossing-n12', [osm])]}
        current = {'bumps': [], 'crossings': [feature('ndw-vop-32451', [vop, osm])]}
        self.preserve_ids(current, previous)
        self.assertEqual(current['crossings'], [feature('osm-crossing-n12', [vop, osm])])

        current = {'bumps': [], 'crossings': [feature('ndw-vop-32451', [vop, osm], layer=1)]}
        self.preserve_ids(current, previous)
        self.assertEqual(current['crossings'][0]['id'], 'ndw-vop-32451')
