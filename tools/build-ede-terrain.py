#!/usr/bin/env python3
"""Build the Slop Ede terrain asset from a PDOK AHN GeoTIFF in EPSG:28992."""

import argparse
from array import array
import math
from pathlib import Path
import struct
import sys

import numpy as np
import rasterio

from ede_gis import Frame
from ede_map import load_scene
from ede_raster import require_rd_raster, sample_bilinear
from ede_scene import SCENE_NAP_ORIGIN

ROOT = Path(__file__).resolve().parents[1]
CELL_SIZE = 12
PADDING = 300
NODATA = -9999


def map_frame():
    return load_scene()['meta']


def fill_gaps(samples, columns, rows):
    gaps = {i for i, h in enumerate(samples) if not math.isfinite(h) or h == NODATA}
    if len(gaps) > len(samples) * 0.15:
        raise ValueError('AHN has insufficient coverage of the padded Ede scene')
    for i in gaps:
        col, row = i % columns, i // columns
        total = weight = 0
        for dc, dr in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)):
            for step in range(1, 33):
                c, r = col + dc * step, row + dr * step
                if not (0 <= c < columns and 0 <= r < rows):
                    break
                j = r * columns + c
                if j not in gaps:
                    w = 1 / math.hypot(dc * step, dr * step)
                    total += samples[j] * w
                    weight += w
                    break
        if not weight:
            raise ValueError('AHN has a gap too large to interpolate')
        samples[i] = total / weight
    return len(gaps)


def build(source, destination):
    frame = map_frame()
    west, north, east, south = frame['bounds']
    step = CELL_SIZE
    x0 = math.floor((west - PADDING) / step) * step
    z0 = math.floor((north - PADDING) / step) * step
    columns = math.ceil((east + PADDING - x0) / step) + 1
    rows = math.ceil((south + PADDING - z0) / step) + 1
    projection = Frame(frame['lonLatAffine'])

    # Sample the existing scene vertices. Horizontal conversion does not apply an ellipsoid-to-NAP shift.
    x, z = np.meshgrid(x0 + step * np.arange(columns), z0 + step * np.arange(rows))
    easting, northing = projection.scene_to_rd(x, z)
    with rasterio.open(source) as raster:
        require_rd_raster(raster)
        pixels = raster.read(1, masked=True).astype(np.float32).filled(np.nan)
        pixels[pixels == NODATA] = np.nan
        samples = sample_bilinear(pixels, raster.transform, easting, northing, footprint=step).ravel()
    missing = fill_gaps(samples, columns, rows)
    elevations = array('h', (round(h * 100) for h in samples))
    origin_index = (-z0 // step) * columns + (-x0 // step)
    measured_origin = samples[origin_index]
    # The established church point defines scene zero across asset versions.
    elevations[origin_index] = round(SCENE_NAP_ORIGIN * 100)
    nap_origin = SCENE_NAP_ORIGIN
    if sys.byteorder == 'big':
        elevations.byteswap()
    header = struct.pack('<4sIIffff', b'AHN1', columns, rows, x0, z0, step, nap_origin)
    destination.write_bytes(header + elevations.tobytes())
    print(f'{columns} × {rows} AHN samples at {step} m, {missing} gaps filled')
    print(f'NAP range {min(samples):.2f} to {max(samples):.2f} m, scene zero {nap_origin:.2f} m NAP (raster at origin {measured_origin:.3f} m)')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('raster', type=Path, help='PDOK AHN DTM GeoTIFF in RD New')
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/ede-ahn.bin')
    args = parser.parse_args()
    build(args.raster, args.output)
