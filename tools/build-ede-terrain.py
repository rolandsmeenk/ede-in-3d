#!/usr/bin/env python3
"""Build the Slop Ede terrain asset from a PDOK AHN GeoTIFF in EPSG:28992."""

import argparse
from array import array
import json
import math
from pathlib import Path
import struct
import subprocess
import sys
from tempfile import TemporaryDirectory

from ede_map import load_scene

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
    info = json.loads(subprocess.check_output(['gdalinfo', '-json', str(source)]))
    wkt = info.get('coordinateSystem', {}).get('wkt', '')
    if 'Amersfoort / RD New' not in wkt:
        raise ValueError('Expected a PDOK AHN raster in RD New (EPSG:28992)')
    frame = map_frame()
    west, north, east, south = frame['bounds']
    step = CELL_SIZE
    x0 = math.floor((west - PADDING) / step) * step
    z0 = math.floor((north - PADDING) / step) * step
    columns = math.ceil((east + PADDING - x0) / step) + 1
    rows = math.ceil((south + PADDING - z0) / step) + 1
    affine = frame['lonLatAffine']
    kx, kz = affine['x'][1], affine['z'][2]

    # Sample centres coincide with the existing scene mesh vertices. All source
    # heights are metres NAP and no vertical datum transformation is applied.
    lon = lambda x: affine['lon0'] + x / kx
    lat = lambda z: affine['lat0'] + z / kz
    bounds = [lon(x0 - step / 2), lat(z0 + (rows - 0.5) * step),
              lon(x0 + (columns - 0.5) * step), lat(z0 - step / 2)]
    with TemporaryDirectory() as tmp:
        area = Path(tmp) / 'scene.tif'
        raw = Path(tmp) / 'scene.dat'
        subprocess.run(['gdalwarp', '-q', '-novshift', '-t_srs', 'EPSG:4326',
                        '-te', *map(str, bounds), '-ts', str(columns), str(rows),
                        '-r', 'bilinear', '-dstnodata', str(NODATA), '-ot', 'Float32',
                        str(source), str(area)], check=True)
        subprocess.run(['gdal_translate', '-q', '-of', 'ENVI', str(area), str(raw)], check=True)
        samples = array('f')
        samples.frombytes(raw.read_bytes())
    if len(samples) != columns * rows:
        raise ValueError('Unexpected AHN sample count')
    missing = fill_gaps(samples, columns, rows)
    elevations = array('h', (round(h * 100) for h in samples))
    nap_origin = elevations[(-z0 // step) * columns + (-x0 // step)] / 100
    if sys.byteorder == 'big':
        elevations.byteswap()
    header = struct.pack('<4sIIffff', b'AHN1', columns, rows, x0, z0, step, nap_origin)
    destination.write_bytes(header + elevations.tobytes())
    print(f'{columns} × {rows} AHN samples at {step} m, {missing} gaps filled')
    print(f'NAP range {min(samples):.2f} to {max(samples):.2f} m, scene Y = NAP − {nap_origin:.2f} m')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('raster', type=Path, help='PDOK AHN DTM GeoTIFF in RD New')
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/ede-ahn.bin')
    args = parser.parse_args()
    build(args.raster, args.output)
