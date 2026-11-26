#!/usr/bin/env python3
"""Bake the Rietkampen embankment or the A12 at Lukkien from native AHN."""

import argparse
import gzip
import json
from pathlib import Path
from struct import pack, unpack_from
from urllib.parse import urlencode
from urllib.request import urlopen

import numpy as np
import rasterio
from rasterio.fill import fillnodata

from ede_gis import Frame
from ede_raster import require_rd_raster, sample_bilinear

ROOT = Path(__file__).resolve().parents[1]
BOUNDS = (-2772, 2940, -1668, 3456)
LUKKIEN_BOUNDS = (-3696, 2448, -2892, 3036)
STEP = 3
CREST_WAYS = {'w592685420', 'w24787482'}  # Hoge dijkpad
LUKKIEN_AXIS = {'w208472167', 'w405313254'}  # Eastbound A12


def smoothstep(a, b, values):
    t = np.clip((values - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('dtm', type=Path, help='Native AHN DTM cache')
    parser.add_argument('--fetch', action='store_true')
    parser.add_argument('--lukkien', action='store_true', help='Build the A12 carriageway patch at Lukkien')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    with gzip.open(ROOT / 'assets/ede-map-v1.json.gz', 'rt') as file:
        scene = json.load(file)
    frame = Frame(scene['meta']['lonLatAffine'])
    x0, z0, x1, z1 = LUKKIEN_BOUNDS if args.lukkien else BOUNDS
    if args.fetch and not args.dtm.exists():
        east, north = zip(*(frame.scene_to_rd(x, z) for x in (x0, x1) for z in (z0, z1)))
        west, south = int(min(east)) - 3, int(min(north)) - 3
        right, top = int(max(east)) + 4, int(max(north)) + 4
        query = urlencode([('service', 'WCS'), ('request', 'GetCoverage'), ('version', '2.0.1'),
                           ('coverageId', 'dtm_05m'), ('format', 'image/tiff'),
                           ('subset', f'x({west},{right})'), ('subset', f'y({south},{top})')])
        with urlopen('https://service.pdok.nl/rws/ahn/wcs/v1_0?' + query, timeout=90) as response:
            args.dtm.write_bytes(response.read())

    x, z = np.meshgrid(np.arange(x0, x1 + 1, STEP), np.arange(z0, z1 + 1, STEP))
    rows, columns = x.shape
    rd = np.array([frame.scene_to_rd(a, b) for a, b in zip(x.flat, z.flat)]).T
    east, north = (values.reshape(rows, columns) for values in rd)
    with rasterio.open(args.dtm) as raster:
        require_rd_raster(raster)
        if raster.res != (0.5, 0.5):
            raise ValueError('Expected native 0.5 m AHN')
        pixels = raster.read(1, masked=True).filled(np.nan)
        if args.lukkien:
            # Fill only short gaps in the exposed pavement before filtering to the 3 m grid.
            pixels = fillnodata(pixels, mask=np.isfinite(pixels).astype('uint8'),
                                max_search_distance=8, smoothing_iterations=1)
        native = sample_bilinear(pixels, raster.transform, east, north, footprint=2 if args.lukkien else 1)

    coarse = (ROOT / 'assets/ede-ahn.bin').read_bytes()
    magic, cols, nrows, mx, mz, step, datum = unpack_from('<4sIIffff', coarse)
    assert magic == b'AHN1' and step == 12
    assert all((edge - origin) % step == 0 for edge, origin in ((x0, mx), (x1, mx), (z0, mz), (z1, mz)))
    coarse_nap = np.frombuffer(coarse, dtype='<i2', offset=28).reshape(nrows, cols) / 100
    col, row = (x - mx) / step, (z - mz) / step
    i, j = np.floor(col).astype(int), np.floor(row).astype(int)
    u, v = col - i, row - j
    a, b, c, d = coarse_nap[j, i], coarse_nap[j, i + 1], coarse_nap[j + 1, i], coarse_nap[j + 1, i + 1]
    base = np.where(u + v <= 1, a + (b - a) * u + (c - a) * v, d + (c - d) * (1 - u) + (b - d) * (1 - v))

    path = sorted({(a, b) for road in scene['roads'] if road['id'] in (LUKKIEN_AXIS if args.lukkien else CREST_WAYS)
                   for a, b in zip(road['pts'][::2], road['pts'][1::2])})
    crest_x, crest_z = zip(*path)
    across = z - np.interp(x, crest_x, crest_z)
    if args.lukkien:
        # Include both carriageways, then blend out over the shoulders and along the approaches.
        weight = smoothstep(-50, -29, across) * (1 - smoothstep(16, 36, across))
        weight *= smoothstep(x0, x0 + 63, x) * (1 - smoothstep(x1 - 63, x1, x))
    else:
        # Blend into the town grid at the toes and end the refinement by the cinema.
        weight = smoothstep(-78, -51, across) * (1 - smoothstep(42, 55, across))
        weight *= smoothstep(x0, x0 + 18, x) * (1 - smoothstep(x1 - 15, x1, x))
    weight *= smoothstep(z0, z0 + 12, z) * (1 - smoothstep(z1 - 12, z1, z))
    valid = np.isfinite(native) & (native > 0) & (native < 40)
    if not valid[weight > 0.9].any():
        raise ValueError('No native elevations intersect the A12 terrain patch')
    result = base + np.where(valid, native - base, 0) * weight
    heights = np.rint(result * 100).astype('<i2')
    output = args.output or ROOT / 'assets' / ('ede-a12-lukkien.bin' if args.lukkien else 'ede-a12-embankment.bin')
    output.write_bytes(pack('<4sIIffff', b'AHN1', columns, rows, x0, z0, STEP, datum) + heights.tobytes())
    print(f'{columns} × {rows} samples, {np.count_nonzero(abs(result - base) > .02)} refined, '
          f'largest correction {np.max(abs(result - base)):.2f} m')


if __name__ == '__main__':
    main()
