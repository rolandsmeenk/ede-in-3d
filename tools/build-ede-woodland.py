#!/usr/bin/env python3
"""Bake PDOK forest composition for procedural trees in Gemeente Ede."""

import argparse
import gzip
import json
import math
from pathlib import Path
import struct
import subprocess

import numpy as np
from shapely import Polygon, contains_xy, make_valid, transform
from shapely.geometry import shape

from ede_gis import Frame
from ede_map import ROOT, load_playable_boundary, load_scene_metadata

CLASSES = {'loofbos': 1, 'naaldbos': 2, 'gemengd bos': 3}
STEP = 8
# Conservative interior between Koeweg and Mosselseweg in Sovon 2022/03, Figure 2.
# Only mapped conifer cells inside this area are assigned Scots pine.
ROEKEL_PINE = Polygon([(5100, -4900), (6070, -4480), (5860, -4260), (5230, -4390), (4840, -4530)])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('extract', type=Path, help='PDOK BGT Download API GML-light vegetation ZIP')
    args = parser.parse_args()

    boundary = load_playable_boundary()
    frame = Frame(load_scene_metadata()['lonLatAffine'])
    rd_bounds = transform(boundary, frame.scene_to_rd, interleaved=False).bounds
    query = ('"bgt-fysiekVoorkomen" IN (\'loofbos\', \'naaldbos\', \'gemengd bos\') '
             'AND "bgt-status" = \'bestaand\' AND "relatieveHoogteligging" = 0 '
             'AND "eindRegistratie" IS NULL AND "objectEindTijd" IS NULL '
             'AND ("plus-status" IS NULL OR "plus-status" <> \'plan\')')
    source = f'/vsizip/{args.extract.resolve()}/bgt_begroeidterreindeel.gml'
    features = json.loads(subprocess.check_output([
        'ogr2ogr', '-f', 'GeoJSON', '-nlt', 'CONVERT_TO_LINEAR',
        '-dim', 'XY', '-spat', *map(str, rd_bounds), '-select', 'bgt-fysiekVoorkomen',
        '-where', query, '/vsistdout/', source, 'BegroeidTerreindeel',
    ]))['features']

    x0, z0, x1, z1 = boundary.bounds
    x0, z0 = math.floor(x0 / STEP) * STEP, math.floor(z0 / STEP) * STEP
    width, height = math.ceil((x1 - x0) / STEP), math.ceil((z1 - z0) / STEP)
    xs, zs = x0 + (np.arange(width) + .5) * STEP, z0 + (np.arange(height) + .5) * STEP
    cells = np.zeros((height, width), dtype=np.uint8)
    for row in features:
        if not row['geometry']:
            continue
        value = CLASSES[row['properties']['bgt-fysiekVoorkomen']]
        geometry = shape(row['geometry'])
        polygon = make_valid(transform(geometry, frame.rd_to_scene, interleaved=False)).intersection(boundary)
        if polygon.is_empty:
            continue
        left, top, right, bottom = polygon.bounds
        col = slice(*np.searchsorted(xs, (left, right)))
        line = slice(*np.searchsorted(zs, (top, bottom)))
        inside = contains_xy(polygon, xs[None, col], zs[line, None])
        cells[line, col][inside] = value

    left, top, right, bottom = ROEKEL_PINE.bounds
    col = slice(*np.searchsorted(xs, (left, right)))
    line = slice(*np.searchsorted(zs, (top, bottom)))
    patch = cells[line, col]
    patch[(patch == CLASSES['naaldbos']) & contains_xy(ROEKEL_PINE, xs[None, col], zs[line, None])] = 4

    counts = np.bincount(cells.ravel(), minlength=5)
    if not np.all(counts[1:]):
        raise ValueError(f'Incomplete woodland raster, cells by class: {counts.tolist()}')
    header = struct.pack('<4sIIfff', b'EWF1', width, height, x0, z0, STEP)
    output = ROOT / 'assets/ede-woodland.bin.gz'
    output.write_bytes(gzip.compress(header + cells.tobytes(), mtime=0))
    print(f'{output.name}: {len(features)} source polygons, {output.stat().st_size} bytes, {counts.tolist()} cells by class')


if __name__ == '__main__':
    main()
