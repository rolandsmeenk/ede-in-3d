#!/usr/bin/env python3
"""Bake the aerial trace and a native AHN refinement for the WVEde circuit."""

import argparse
import gzip
import json
from math import dist
from pathlib import Path
from struct import pack, unpack_from
from urllib.parse import urlencode
from urllib.request import urlopen

import numpy as np
import rasterio

from ede_gis import Frame
from ede_raster import require_rd_raster, sample_bilinear

ROOT = Path(__file__).resolve().parents[1]
BOUNDS = (-2232, 1284, -1788, 1464)
STEP = 2
# Measured against the 2021 PDOK aerial and checked in the 2026 aerial.
# The main ribbon and east turn use the 450 × 163 m RD crop at 4 px/m.
MAIN = [
    (340,103), (410,125), (480,149), (550,174), (603,190), (648,203), (682,206), (716,201),
    (756,192), (799,184), (844,181), (892,181), (938,189), (982,202), (1029,218), (1072,236),
    (1108,261), (1131,288), (1153,321), (1178,353), (1214,378), (1260,396), (1309,412),
    (1370,429), (1435,445), (1492,445), (1540,434), (1577,429), (1600,435), (1617,449),
    (1629,469), (1630,489), (1621,508), (1605,521), (1588,524),
]
RETURN = [
    (1566,518), (1533,498), (1498,482), (1453,466), (1400,452), (1341,436), (1290,420),
    (1238,402), (1198,386), (1172,370), (1148,343), (1128,311), (1108,282), (1082,259),
    (1054,242), (1019,228), (980,216), (935,208), (890,207), (845,208), (804,213),
    (766,225), (732,238), (704,244), (672,241), (632,236), (583,226), (536,211), (476,192),
    (406,171), (333,149), (253,126), (186,107), (130,91),
]
# The western hairpin extends above the main crop. Use the 196 × 94 m detail at 6 px/m.
WEST = [
    (177,264), (157,253), (148,223), (147,187), (149,154), (166,135), (192,120), (225,115),
    (251,123), (273,137), (293,164), (311,198), (335,233), (365,251), (405,268), (463,288),
]


def build(dtm, fetch):
    with gzip.open(ROOT / 'assets/ede-map-v1.json.gz', 'rt') as file:
        frame = Frame(json.load(file)['meta']['lonLatAffine'])
    route = [frame.rd_to_scene(172284 + x / 4, 449573 - y / 4) for x, y in MAIN + RETURN]
    route += [frame.rd_to_scene(172276 + x / 6, 449596 - y / 6) for x, y in WEST]
    distance = sum(dist(a, b) for a, b in zip(route, route[1:] + route[:1]))
    assert 860 < distance < 900
    x0, z0, x1, z1 = BOUNDS
    if fetch and not dtm.exists():
        east, north = zip(*(frame.scene_to_rd(x, z) for x in (x0, x1) for z in (z0, z1)))
        query = urlencode([('service', 'WCS'), ('request', 'GetCoverage'), ('version', '2.0.1'),
                           ('coverageId', 'dtm_05m'), ('format', 'image/tiff'),
                           ('subset', f'x({int(min(east))-3},{int(max(east))+4})'),
                           ('subset', f'y({int(min(north))-3},{int(max(north))+4})')])
        with urlopen('https://service.pdok.nl/rws/ahn/wcs/v1_0?' + query, timeout=60) as response:
            dtm.write_bytes(response.read())

    x, z = np.meshgrid(np.arange(x0, x1 + 1, STEP), np.arange(z0, z1 + 1, STEP))
    rows, columns = x.shape
    east, north = frame.scene_to_rd(x, z)
    with rasterio.open(dtm) as raster:
        require_rd_raster(raster)
        if raster.res != (0.5, 0.5):
            raise ValueError('Expected native 0.5 m AHN')
        native = sample_bilinear(raster.read(1, masked=True).filled(np.nan), raster.transform, east, north, footprint=4)

    coarse = (ROOT / 'assets/ede-ahn.bin').read_bytes()
    magic, cols, nrows, mx, mz, step, datum = unpack_from('<4sIIffff', coarse)
    assert magic == b'AHN1' and step == 12
    assert all((bound - zero) % step == 0 for bound, zero in ((x0, mx), (x1, mx), (z0, mz), (z1, mz)))
    coarse_nap = np.frombuffer(coarse, dtype='<i2', offset=28).reshape(nrows, cols) / 100
    col, row = (x - mx) / step, (z - mz) / step
    i, j = np.floor(col).astype(int), np.floor(row).astype(int)
    u, v = col - i, row - j
    a, b, c, d = coarse_nap[j, i], coarse_nap[j, i + 1], coarse_nap[j + 1, i], coarse_nap[j + 1, i + 1]
    base = np.where(u + v <= 1, a + (b - a) * u + (c - a) * v, d + (c - d) * (1 - u) + (b - d) * (1 - v))

    nearest = np.full_like(x, np.inf, dtype=float)
    for (ax, az), (bx, bz) in zip(route, route[1:] + route[:1]):
        dx, dz = bx - ax, bz - az
        t = np.clip(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1)
        nearest = np.minimum(nearest, np.hypot(x - ax - t * dx, z - az - t * dz))
    # Preserve the surveyed grade beneath the pavement and blend into town terrain at the shoulders.
    t = np.clip((12 - nearest) / 8, 0, 1)
    weight = t * t * (3 - 2 * t)
    valid = np.isfinite(native) & (native > 0) & (native < 40)
    coverage = valid[nearest < 3].mean()
    if coverage < 0.97:
        raise ValueError(f'Only {coverage:.1%} AHN coverage under the traced circuit')
    result = base + np.where(valid, native - base, 0) * weight
    heights = np.rint(result * 100).astype('<i2')
    (ROOT / 'assets/ede-wvede-terrain.bin').write_bytes(
        pack('<4sIIffff', b'AHN1', columns, rows, x0, z0, STEP, datum) + heights.tobytes()
    )
    lines = ['// Permanent WVEde pavement measured in the 2021 and 2026 PDOK aerials.',
             'export const WVEDE_CIRCUIT = [']
    coords = [json.dumps([round(x, 2), round(z, 2)], separators=(',', ':')) for x, z in route]
    lines += ['  ' + ', '.join(coords[i:i+4]) + ',' for i in range(0, len(coords), 4)]
    lines += ['];', f'export const WVEDE_BRICK_SECTION = [{len(MAIN) - 1}, {len(MAIN) + len(RETURN) - 1}];',
              'export const WVEDE_START_LINE_INDEX = 5;', '']
    (ROOT / 'js/ede-wvede-circuit-survey.js').write_text('\n'.join(lines))
    print(f'{distance:.1f} m, {columns} × {rows} height samples, '
          f'{coverage:.1%} pavement coverage, {np.count_nonzero(abs(result - base) > .02)} refined, largest correction {np.max(abs(result - base)):.2f} m')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('dtm', type=Path)
    parser.add_argument('--fetch', action='store_true')
    args = parser.parse_args()
    build(args.dtm, args.fetch)
