#!/usr/bin/env python3
"""Bake 3 m motorway terrain patches from native PDOK AHN DTM caches."""

import argparse
import gzip
from pathlib import Path

import numpy as np
import rasterio

from ede_gis import Frame
from ede_height_field import AHN_HEADER, read_height_field
from ede_map import load_scene
from ede_raster import require_rd_raster, sample_bilinear

ROOT = Path(__file__).resolve().parents[1]
STEP = 3
# The rectangles follow 12 m town-grid edges, well beyond the corrected carriageways.
BOUNDS = {
    'maanderbroek': (-4284, 1884, -3696, 2676),
    'a30-galvanistraat': (-3924, 1176, -3732, 1452),
    'a12-ede-east': (-504, 3492, 300, 3780),
    'a12-wageningen': (768, 3660, 1284, 3780),
}


def smoothstep(start, end, values):
    t = np.clip((values - start) / (end - start), 0, 1)
    return t * t * (3 - 2 * t)


def corridor_weights(roads, x, z, bounds):
    west, north, east, south = bounds
    shoulders = np.zeros_like(x, dtype=float)
    decks = np.zeros_like(x, dtype=float)
    for road in roads:
        if road['tunnel'] or (not road['bridge'] and
                              (road['layer'] != 0 or road['kind'] not in ('motorway', 'motorway_link'))):
            continue
        points = list(zip(road['pts'][::2], road['pts'][1::2]))
        width = max(road['width'], (road.get('bgt') or {}).get('width') or 0)
        for (ax, az), (bx, bz) in zip(points, points[1:]):
            margin = width / 2 + 24
            if (min(ax, bx) > east + margin or max(ax, bx) < west - margin
                    or min(az, bz) > south + margin or max(az, bz) < north - margin):
                continue
            length = np.hypot(bx - ax, bz - az)
            if not length:
                continue
            ux, uz = (bx - ax) / length, (bz - az) / length
            along = (x - ax) * ux + (z - az) * uz
            across = np.abs((z - az) * ux - (x - ax) * uz)
            beyond = np.maximum(0, np.maximum(-along, along - length))
            if road['bridge']:
                apron = 1 - smoothstep(0, STEP, beyond)
                decks = np.maximum(decks, apron * (1 - smoothstep(width / 2 + STEP, width / 2 + 2 * STEP, across)))
            else:
                distance = np.hypot(across, beyond)
                shoulders = np.maximum(shoulders, 1 - smoothstep(width / 2 + 5, margin, distance))
    return shoulders, decks


def fill_short_gaps(native):
    # Interpolate a missing vertex only between two nearby, agreeing ground samples.
    radius = np.full_like(native, np.inf)
    result = native.copy()
    for shift in ((1, 0), (0, 1), (1, 1), (1, -1)):
        left = np.roll(native, shift, axis=(0, 1))
        right = np.roll(native, tuple(-value for value in shift), axis=(0, 1))
        spread = np.abs(left - right)
        supported = ~np.isfinite(native) & (spread < 0.55) & (spread < radius)
        result[supported] = (left[supported] + right[supported]) / 2
        radius[supported] = spread[supported]
    return result


def build(name, bounds, cache, roads, frame, coarse):
    columns, rows, min_x, min_z, step, datum, nap = coarse
    west, north, east, south = bounds
    assert step == 12 and all((edge - origin) % step == 0 for edge, origin in
                              ((west, min_x), (east, min_x), (north, min_z), (south, min_z)))
    x, z = np.meshgrid(np.arange(west, east + 1, STEP), np.arange(north, south + 1, STEP))
    raster_path = cache / f'{name}-dtm.tif'
    eastings, northings = np.array([frame.scene_to_rd(a, b) for a, b in zip(x.flat, z.flat)]).T
    with rasterio.open(raster_path) as raster:
        require_rd_raster(raster)
        if raster.res != (0.5, 0.5):
            raise ValueError(f'Expected native 0.5 m AHN: {raster_path}')
        pixels = raster.read(1, masked=True).filled(np.nan)
        native = sample_bilinear(pixels, raster.transform, eastings.reshape(x.shape),
                                 northings.reshape(x.shape), footprint=1)

    # Match the same coarse triangle diagonal as js/terrain.js along the patch perimeter.
    col, row = (x - min_x) / step, (z - min_z) / step
    i, j = np.floor(col).astype(int), np.floor(row).astype(int)
    u, v = col - i, row - j
    nap = np.asarray(nap).reshape(rows, columns) / 100
    a, b, c, d = nap[j, i], nap[j, i + 1], nap[j + 1, i], nap[j + 1, i + 1]
    base = np.where(u + v <= 1, a + (b - a) * u + (c - a) * v, d + (c - d) * (1 - u) + (b - d) * (1 - v))

    shoulders, decks = corridor_weights(roads, x, z, bounds)
    edge = np.minimum(np.minimum(x - west, east - x), np.minimum(z - north, south - z))
    weight = shoulders * smoothstep(0, 36, edge)
    native = np.where((native > 0) & (native < 40), native, np.nan)
    native = np.where(decks > 0, native, fill_short_gaps(native))
    valid = np.isfinite(native)
    if not valid[weight > 0.9].any():
        raise ValueError(f'No native elevations intersect the motorway patch: {raster_path}')
    # Missing native ground keeps the old terrain. A higher return under a bridge may be the deck.
    correction = np.where(valid, native - base, 0)
    correction = np.minimum(correction, 0) + np.maximum(correction, 0) * (1 - decks)
    heights = np.rint((base + correction * weight) * 100).astype('<i2')
    delta = heights.copy()
    delta[:, 1:] -= heights[:, :-1]
    header = AHN_HEADER.pack(b'AHN2', x.shape[1], x.shape[0], west, north, STEP, datum)
    output = ROOT / 'assets' / f'ede-motorway-{name}.bin.gz'
    output.write_bytes(gzip.compress(header + delta.tobytes(), mtime=0))
    print(f'{name}: {np.count_nonzero(abs(correction * weight) > .02)} refined, '
          f'largest correction {np.max(abs(correction * weight)):.2f} m, {output.stat().st_size} bytes')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path, help='Directory with <site>-dtm.tif at the native 0.5 m resolution')
    args = parser.parse_args()
    scene = load_scene(include_shorelines=False)
    frame = Frame(scene['meta']['lonLatAffine'])
    coarse = read_height_field(ROOT / 'assets/ede-ahn.bin')
    for name, bounds in BOUNDS.items():
        build(name, bounds, args.cache, scene['roads'], frame, coarse)


if __name__ == '__main__':
    main()
