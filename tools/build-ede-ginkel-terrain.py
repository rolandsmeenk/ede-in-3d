#!/usr/bin/env python3
"""Bake the Ginkelse Heide sheepfold approaches from a native PDOK AHN DTM."""
import argparse
from pathlib import Path
import struct

import numpy as np
import rasterio

from ede_gis import Frame
from ede_map import load_scene
from ede_raster import require_rd_raster, sample_bilinear
from ede_scene import SCENE_NAP_ORIGIN


TILES = Path(__file__).resolve().parents[1] / 'assets/ede-terrain-tiles'
BOUNDS = (4000, 1000, 4500, 1250)
STEP = 1.25
BLEND = 12.5
HEADER = struct.Struct('<4sIIffff')


def build(source, output):
    west, north, east, south = BOUNDS
    cols, rows = int((east - west) / STEP) + 1, int((south - north) / STEP) + 1
    x, z = np.meshgrid(west + STEP * np.arange(cols), north + STEP * np.arange(rows))

    # Use the same 5 m triangles as collision and the original meshes.
    raw = (TILES / 'collision.bin').read_bytes()
    _, base_cols, base_rows, base_x, base_z, base_step, _ = HEADER.unpack_from(raw)
    heights = np.frombuffer(raw, dtype='<i2', offset=HEADER.size).reshape(base_rows, base_cols)
    col, row = (x - base_x) / base_step, (z - base_z) / base_step
    ci, ri = np.floor(col).astype(int), np.floor(row).astype(int)
    u, v = col - ci, row - ri
    a, b, c, d = heights[ri, ci], heights[ri, ci + 1], heights[ri + 1, ci], heights[ri + 1, ci + 1]
    base = np.where(u + v <= 1, a + (b - a) * u + (c - a) * v, d + (c - d) * (1 - u) + (b - d) * (1 - v)) / 100

    frame = Frame(load_scene()['meta']['lonLatAffine'])
    easting, northing = frame.scene_to_rd(x, z)
    with rasterio.open(source) as raster:
        require_rd_raster(raster)
        if raster.res != (0.5, 0.5):
            raise ValueError('Expected native 0.5 m AHN ground samples')
        pixels = raster.read(1, masked=True).astype(np.float32).filled(np.nan)
        pixels[(pixels <= -9999) | (pixels > 300)] = np.nan
        measured = sample_bilinear(pixels, raster.transform, easting, northing)
    valid = np.isfinite(measured)
    if np.mean(valid) < 0.85:
        raise ValueError('Insufficient AHN coverage for the sheepfold patch')

    t = np.minimum(1, np.minimum.reduce([x - west, east - x, z - north, south - z]) / BLEND)
    # A gentle tie to the neighbouring 5 m mesh and a coarse fallback under AHN no-data.
    result = base + np.where(valid, measured - base, 0) * t * t * (3 - 2 * t)
    data = np.rint(result * 100).astype('<i2')
    output.write_bytes(HEADER.pack(b'AHN1', cols, rows, west, north, STEP, SCENE_NAP_ORIGIN) + data.tobytes())
    rz, rx = np.unravel_index(np.argmin(result - base), result.shape)
    print(f'{cols} × {rows} at {STEP:g} m, {np.count_nonzero(valid):,}/{valid.size:,} measured')
    print(f'Maximum extra depth {(base-result)[rz, rx]:.2f} m at scene ({x[rz, rx]:g}, {z[rz, rx]:g})')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('raster', type=Path)
    parser.add_argument('--output', type=Path, default=TILES / 'ginkel-detail.bin')
    args = parser.parse_args()
    build(args.raster, args.output)
