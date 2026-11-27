"""Bake an offline Ede ambience grid from the RIVM Lden coverages (CC0)."""

import argparse
import gzip
import math
from pathlib import Path
import struct
from urllib.parse import urlencode
from urllib.request import urlretrieve

import numpy as np
from pyproj.enums import TransformDirection
import rasterio

from ede_gis import Frame, rd_pipeline
from ede_map import ROOT, load_playable_scene

SERVICE = 'https://data.rivm.nl/geo/alo/wcs'
LAYERS = {
    'road': 'rivm_20250101_Geluid_lden_wegverkeer_2022',
    'rail': 'rivm_20250101_Geluid_lden_treinverkeer_2023',
}
STEP = 64


def download(layer, path, xs, ys):
    axes = (('X', xs), ('Y', ys))
    subsets = [('subset', f'{axis}({math.floor(coords.min() / 10) * 10 - 10},'
                         f'{math.ceil(coords.max() / 10) * 10 + 10})') for axis, coords in axes]
    query = urlencode([('service', 'WCS'), ('version', '2.0.1'), ('request', 'GetCoverage'),
                       ('coverageId', layer), ('format', 'image/tiff'), *subsets])
    urlretrieve(f'{SERVICE}?{query}', path)


def samples(path, xs, ys):
    with rasterio.open(path) as source:
        if source.crs.to_epsg() != 28992:
            raise ValueError(f'Unexpected CRS in {path}: {source.crs}')
        values = source.read(1, masked=True).filled(0)
        columns, rows = ~source.transform * (xs, ys)
        columns, rows = np.floor(columns).astype(int), np.floor(rows).astype(int)
        if (columns.min() < 0 or rows.min() < 0 or
                columns.max() >= source.width or rows.max() >= source.height):
            raise ValueError(f'Raster {path} does not cover the full playable map')
        return np.clip(values[rows, columns], 0, 90).astype(np.uint8)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path, help='Directory for clipped RIVM GeoTIFFs')
    parser.add_argument('--fetch', action='store_true')
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)

    metadata = load_playable_scene()['meta']
    frame = Frame(metadata['lonLatAffine'])
    x0, z0, x1, z1 = metadata['bounds']
    x0, z0 = math.floor(x0 / STEP) * STEP, math.floor(z0 / STEP) * STEP
    xs = np.arange(x0, x1 + STEP, STEP)
    zs = np.arange(z0, z1 + STEP, STEP)
    lon, lat = frame.scene_to_lon_lat(*np.meshgrid(xs, zs))
    east, north = rd_pipeline().transform(lon, lat, direction=TransformDirection.INVERSE)

    channels = []
    for name, layer in LAYERS.items():
        path = args.cache / f'{name}.tif'
        if args.fetch:
            download(layer, path, east, north)
        channel = samples(path, east, north)
        channels.append(channel)
        print(f'{name}: {int(channel.min())}–{int(channel.max())} dB Lden')

    header = struct.pack('<4sIIfff', b'ENA1', len(xs), len(zs), x0, z0, STEP)
    packed = gzip.compress(header + np.stack(channels, axis=-1).tobytes(), mtime=0)
    (ROOT / 'assets/ede-ambient-noise.bin.gz').write_bytes(packed)
    print(f'{len(xs)} × {len(zs)} grid, {len(packed):,} compressed bytes')


if __name__ == '__main__':
    main()
