import gzip
from importlib.util import find_spec
import json
from math import dist
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(find_spec('pyproj'), 'pyproj is required for offline GIS tests')
class EdeGISTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        sys.path.insert(0, str(ROOT / 'tools'))
        try:
            import ede_gis
        finally:
            sys.path.pop(0)
        cls.gis = ede_gis
        with gzip.open(ROOT / 'assets/ede-map-v1.json.gz', 'rt') as stream:
            cls.meta = json.load(stream)['meta']
        cls.frame = ede_gis.Frame(cls.meta['lonLatAffine'])
        cls.controls = json.loads((ROOT / 'tools/data/ede-gis-controls.json').read_text())

    def test_source_axis_order(self):
        control = self.controls['records'][0]
        lon, lat = control['lonLat']
        point = self.frame.to_rd(lon, lat, self.controls['sourceCrs'])
        self.assertEqual(point, self.frame.to_rd(lat, lon, 'EPSG:4258'))
        self.assertEqual(point, self.frame.to_rd(lon, lat, 4326, axis_order='xy'))
        arcgis = self.gis.source_crs({'spatialReference': {'wkid': 102100, 'latestWkid': 3857}})
        mercator = self.gis.Transformer.from_pipeline(
            self.gis.WEB_MERCATOR_TO_DEGREES).transform(lon, lat, direction=self.gis.TransformDirection.INVERSE)
        self.assertLess(dist(point, self.frame.to_rd(*mercator, arcgis)), 1e-8)
        self.assertEqual(self.gis.source_crs({'coordRefSys': 'EPSG:7415'}).to_epsg(), 28992)
        self.assertEqual(self.gis.source_crs(
            {'referenceSystem': 'https://www.opengis.net/def/crs/EPSG/0/7415'}).to_epsg(), 28992)
        self.assertEqual(self.gis.source_crs({'type': 'FeatureCollection'}).to_authority(), ('OGC', 'CRS84'))
        with self.assertRaises(ValueError):
            self.gis.source_crs({})
        with self.assertRaises(ValueError):
            self.frame.to_rd(lon, lat, 4258, axis_order='auto')

    def test_surveyed_coordinate_pairs(self):
        for control in self.controls['records']:
            with self.subTest(station=control['station']):
                actual = self.frame.to_rd(*control['lonLat'], self.controls['sourceCrs'])
                self.assertLess(dist(actual, control['rd']), 0.035)
                if 'etrs89Dms' in control:
                    def degrees(text):
                        degree, minute, second = map(float, text.replace(',', '.').split())
                        return degree + minute / 60 + second / 3600
                    lon, lat = map(degrees, control['etrs89Dms'])
                    actual = self.frame.to_rd(lat, lon, 'EPSG:4258')
                    self.assertLess(dist(actual, control['rd']), 0.001)

    def test_scene_roundtrip_to_all_four_edges(self):
        west, north, east, south = self.meta['bounds']
        for corner in [(0, 0), (west, north), (west, south), (east, north), (east, south)]:
            self.assertLess(dist(corner, self.frame.rd_to_scene(*self.frame.scene_to_rd(*corner))), 1e-8)
        origin = self.frame.scene_to_rd(0, 0)
        self.assertLess(dist(origin, (174506.8015915, 450892.1369324)), 1e-6)
        self.assertGreater(self.frame.scene_to_rd(10, 0)[0], origin[0])
        self.assertLess(self.frame.scene_to_rd(0, 10)[1], origin[1])

    def test_rotated_raster_uses_pixel_centers_and_native_xy(self):
        class Affine:
            def __mul__(self, point):
                col, row = point
                return 174000 + 0.5 * col + 0.2 * row, 451000 - 0.3 * col - 0.4 * row

        raster = SimpleNamespace(crs=self.gis.horizontal_crs(28992), transform=Affine())
        self.assertLess(dist(self.gis.raster_pixel_to_rd(raster, 10, 20), (174009.35, 450988.65)), 1e-8)
        self.assertLess(dist(self.gis.raster_pixel_to_rd(raster, 10, 20, center=False),
                             (174009, 450989)), 1e-8)


if __name__ == '__main__':
    unittest.main()
