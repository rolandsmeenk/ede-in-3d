"""Check the pixel centre convention independently of GDAL reprojection."""

from pathlib import Path
import sys
import unittest

import numpy as np
from rasterio.transform import Affine

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from ede_raster import sample_bilinear


class RasterGIS(unittest.TestCase):
    def test_rotated_pixel_centres_and_fractional_samples(self):
        transform = Affine(0.48, 0.12, 174500, 0.12, -0.48, 450900)
        rows, cols = np.indices((12, 12))
        heights = rows * 10.0 + cols
        x, y = transform * (np.array([3.5, 3.75]), np.array([4.5, 4.75]))
        for footprint in (0, 1.5):
            got = sample_bilinear(heights, transform, x, y, footprint=footprint)
            # The widened discrete tent approximates a linear ramp closely
            # when its radius is not an integer number of pixels.
            np.testing.assert_allclose(got, [43, 45.75], atol=0.1)

    def test_nodata_centre_remains_a_gap(self):
        transform = Affine(1, 0, 174500, 0, -1, 450900)
        heights = np.full((6, 6), 22.54)
        heights[3, 4] = np.nan
        x, y = transform * (np.array([3.8, 4.1]), 3.5)
        got = sample_bilinear(heights, transform, x, y)
        self.assertAlmostEqual(got[0], 22.54)
        self.assertTrue(np.isnan(got[1]))


if __name__ == '__main__':
    unittest.main()
