"""Sampling helpers for source rasters declared in RD New."""

import numpy as np

from ede_gis import source_crs


def require_rd_raster(dataset):
    if not dataset.crs or source_crs({'crs': dataset.crs.to_wkt()}).to_epsg() != 28992:
        raise ValueError('Expected a source raster with RD New (EPSG:28992) horizontal CRS')
    return dataset


def sample_bilinear(pixels, transform, easting, northing, footprint=0):
    """Interpolate one NAP band at RD coordinates with its full pixel affine."""
    height, width = pixels.shape
    col, row = (~transform) * (easting, northing)
    # GDAL affines describe pixel corners. Array indices address their centres.
    col, row = col - 0.5, row - 0.5
    left, top = np.floor(col).astype(int), np.floor(row).astype(int)
    fx, fy = col - left, row - top
    # Widen the triangular kernel on downsampling to keep the former filtered AHN grade.
    rx = max(1, footprint / np.hypot(transform.a, transform.d))
    ry = max(1, footprint / np.hypot(transform.b, transform.e))
    total, weight = np.zeros_like(col), np.zeros_like(col)
    for dy in range(1 - int(np.ceil(ry)), 1 + int(np.ceil(ry))):
        sy = np.maximum(0, 1 - np.abs(dy - fy) / ry)
        for dx in range(1 - int(np.ceil(rx)), 1 + int(np.ceil(rx))):
            scale = sy * np.maximum(0, 1 - np.abs(dx - fx) / rx)
            c, r = left + dx, top + dy
            value = pixels[np.clip(r, 0, height - 1), np.clip(c, 0, width - 1)]
            valid = np.isfinite(value) & (0 <= c) & (c < width) & (0 <= r) & (r < height)
            total += np.where(valid, value * scale, 0)
            weight += np.where(valid, scale, 0)
    # A source nodata centre denotes an area with no exposed ground return.
    cc, rr = np.floor(col + 0.5).astype(int), np.floor(row + 0.5).astype(int)
    central = pixels[np.clip(rr, 0, height - 1), np.clip(cc, 0, width - 1)]
    valid = np.isfinite(central) & (0 <= cc) & (cc < width) & (0 <= rr) & (rr < height)
    return np.divide(total, weight, out=np.full_like(total, np.nan), where=valid & (weight > 0))
