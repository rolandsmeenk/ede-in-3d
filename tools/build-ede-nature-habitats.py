#!/usr/bin/env python3
"""Bake the Gelderland Beheergebied 2027 polygons near De Ginkel and Planken Wambuis."""

import argparse
import gzip
import json
from pathlib import Path
import struct
from urllib.parse import urlencode
from urllib.request import urlopen

import numpy as np
from shapely import contains_xy, make_valid, transform
from shapely.geometry import box, shape

from ede_gis import Frame
from ede_map import ROOT, load_scene_metadata

SOURCE = 'https://geoportaal.gelderland.nl/gisserver/rest/services/Natuurbeheerplan/Natuurbeheerplan/MapServer/96/query'
STEP = 8
BOUNDS = (2600, -5600, 10968, 2000)
# Values are shared with ede-nature-habitats.js. Wetland and sand override broad woodland.
CLASSES = {
    'N15.02': 1, 'N16.03': 1, 'N14.01': 1, 'N14.02': 1, 'N14.03': 1,
    'N17.03': 1, 'L01.02': 1,
    'N07.01': 2, 'N12.02': 3, 'N11.01': 3, 'N12.06': 3,
    'N06.04': 4, 'N07.02': 5,
    'N04.02': 6, 'N06.05': 6, 'L01.01': 6,
}


def fetch_snapshot(frame):
    rd = transform(box(*BOUNDS), frame.scene_to_rd, interleaved=False).bounds
    params = urlencode({
        'f': 'geojson', 'where': '1=1', 'geometry': ','.join(map(str, rd)),
        'geometryType': 'esriGeometryEnvelope', 'inSR': 28992, 'outSR': 28992,
        'outFields': 'objectid,beheertype', 'returnGeometry': 'true', 'geometryPrecision': 1,
        'orderByFields': 'objectid',
    })
    with urlopen(f'{SOURCE}?{params}', timeout=30) as response:
        return response.read()


def bake(snapshot, frame):
    if snapshot.get('crs', {}).get('properties', {}).get('name') != 'EPSG:28992':
        raise ValueError('Expected Gelderland GeoJSON in RD New')
    if snapshot.get('properties', {}).get('exceededTransferLimit'):
        raise ValueError('Habitat query exceeded the service record limit')
    x0, z0, x1, z1 = BOUNDS
    width, height = (x1 - x0) // STEP, (z1 - z0) // STEP
    xs, zs = x0 + (np.arange(width) + .5) * STEP, z0 + (np.arange(height) + .5) * STEP
    cells = np.zeros((height, width), dtype=np.uint8)
    rows = snapshot['features']
    for row in sorted(rows, key=lambda row: CLASSES.get(row['properties']['beheertype'], 0)):
        value = CLASSES.get(row['properties']['beheertype'])
        if value is None or not row['geometry']:
            continue
        polygon = transform(make_valid(shape(row['geometry'])), frame.rd_to_scene, interleaved=False)
        left, top, right, bottom = polygon.bounds
        columns = slice(*np.searchsorted(xs, (left, right)))
        lines = slice(*np.searchsorted(zs, (top, bottom)))
        cells[lines, columns][contains_xy(polygon, xs[None, columns], zs[lines, None])] = value
    counts = np.bincount(cells.ravel(), minlength=7)
    if not np.all(counts[1:]):
        raise ValueError(f'Incomplete habitat raster: {counts.tolist()}')
    header = struct.pack('<4sIIfff', b'ENH1', width, height, x0, z0, STEP)
    return gzip.compress(header + cells.tobytes(), mtime=0), counts.tolist()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshot', type=Path, help='Saved Gelderland GeoJSON source')
    parser.add_argument('--fetch', action='store_true', help='Refresh the source snapshot before baking')
    args = parser.parse_args()
    frame = Frame(load_scene_metadata()['lonLatAffine'])
    raw = fetch_snapshot(frame) if args.fetch else args.snapshot.read_bytes()
    packed, counts = bake(json.loads(raw), frame)
    if args.fetch:
        args.snapshot.write_bytes(raw)
    target = ROOT / 'assets/ede-nature-habitats.bin.gz'
    target.write_bytes(packed)
    print(f'{target.name}: {len(packed)} bytes, cells by class {counts}')


if __name__ == '__main__':
    main()
