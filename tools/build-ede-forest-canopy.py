#!/usr/bin/env python3
"""Bake Ede's distant forest surface from the KEA canopy mask and PDOK AHN."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import json
import math
import re
from pathlib import Path
import subprocess

import numpy as np
import rasterio
from rasterio.features import rasterize
from rasterio.transform import from_origin
from scipy.ndimage import map_coordinates
from shapely.geometry import LineString

from ede_gis import Frame
from ede_map import load_scene
from ede_raster import require_rd_raster
from ede_scene import SCENE_NAP_ORIGIN

ROOT = Path(__file__).resolve().parents[1]
WCS = 'https://service.pdok.nl/rws/ahn/wcs/v1_0'
CANOPY = 'https://image.arcgisonline.nl/arcgis/rest/services/KEA/Monitoring_boomkroonbedekking/ImageServer'
CANOPY_YEAR = 2022  # AHN4. The 2024 slice returns empty coverage in Ede.
SOURCE_SIZE, SOURCE_STEP = 2000, 2
SAMPLE_STEP = 2.5
CELLS = 50
STEPS = (10, 20)
MIN_CROWN_HEIGHT, MAX_CROWN_HEIGHT = 3, 42
MIN_CROWN_FRACTION = 0.33
ROAD_CLASSES = {'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'secondary',
                'tertiary', 'unclassified', 'residential'}


def download(path, url, parameters, offline):
    if path.is_file() or offline:
        return
    temporary = path.with_suffix('.part')
    try:
        subprocess.run(['curl', '-fsSG', '--retry', '3', '--max-time', '90', url,
                        *[arg for key, value in parameters for arg in ('--data-urlencode', f'{key}={value}')],
                        '-o', str(temporary)], check=True)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def source_tile(cache, x, y, offline):
    e, n = x + SOURCE_SIZE, y + SOURCE_SIZE
    dtm, dsm = [cache / f'{kind}-{x}-{y}.tif' for kind in ('dtm', 'dsm')]
    for kind, path in (('dtm', dtm), ('dsm', dsm)):
        download(path, WCS, [('service', 'WCS'), ('request', 'GetCoverage'), ('version', '2.0.1'),
                             ('coverageId', f'{kind}_05m'), ('format', 'image/tiff'), ('scaleFactor', '0.25'),
                             ('subset', f'x({x},{e})'), ('subset', f'y({y},{n})')], offline)
    mask = cache / f'canopy-{CANOPY_YEAR}-{x}-{y}.tif'
    size = SOURCE_SIZE // SOURCE_STEP
    download(mask, f'{CANOPY}/exportImage', [('bbox', f'{x},{y},{e},{n}'), ('bboxSR', '28992'),
             ('imageSR', '28992'), ('size', f'{size},{size}'), ('format', 'tiff'),
             ('interpolation', 'RSP_NearestNeighbor'), ('sliceId', '1'), ('f', 'image')], offline)
    return dtm, dsm, mask


def source_grids(bounds, cache, offline):
    west, south, east, north = bounds
    samples = SOURCE_SIZE // SOURCE_STEP
    shape = ((north - south) // SOURCE_STEP, (east - west) // SOURCE_STEP)
    dtm, dsm = [np.empty(shape, dtype=np.float32) for _ in range(2)]
    mask = np.empty(shape, dtype=bool)
    coordinates = [(x, y) for x in range(west, east, SOURCE_SIZE) for y in range(south, north, SOURCE_SIZE)]
    with ThreadPoolExecutor(max_workers=6) as workers:
        files = workers.map(lambda xy: source_tile(cache, *xy, offline), coordinates)
        for (x, y), paths in zip(coordinates, files):
            row, col = (north - y - SOURCE_SIZE) // SOURCE_STEP, (x - west) // SOURCE_STEP
            for index, (path, output) in enumerate(zip(paths, (dtm, dsm, mask))):
                with rasterio.open(path) as raster:
                    require_rd_raster(raster)
                    if (raster.shape != (samples, samples) or raster.res != (SOURCE_STEP, SOURCE_STEP)
                            or tuple(raster.bounds) != (x, y, x + SOURCE_SIZE, y + SOURCE_SIZE)):
                        raise ValueError(f'Unexpected raster geometry in {path}')
                    read = raster.read(1, masked=True)
                    if index < 2:
                        values = read.astype(np.float32).filled(np.nan)
                        values[(values <= -9999) | (values > 300)] = np.nan
                    else:
                        if not np.isin(read.compressed(), (0, 1)).all():
                            raise ValueError(f'Expected binary coverage classes in {path}')
                        values = read.filled(0).astype(bool)
                    output[row:row + samples, col:col + samples] = values
    if not mask.any():
        raise ValueError('Canopy survey returned no measured coverage')
    return dtm, dsm, mask


def observed_crowns(frame, bounds, sources, rd_bounds):
    x0, z0, x1, z1 = bounds
    easting_origin, _, _, northing_origin = rd_bounds
    rows, cols = int((z1 - z0) / SAMPLE_STEP), int((x1 - x0) / SAMPLE_STEP)
    crowns = np.zeros((rows, cols), dtype=np.int16)
    dtm, dsm, mask = sources
    missing, observed, rejected = 0, 0, 0
    x = x0 + (np.arange(cols) + 0.5) * SAMPLE_STEP
    for start in range(0, rows, 128):
        end = min(start + 128, rows)
        z = z0 + (np.arange(start, end) + 0.5) * SAMPLE_STEP
        e, n = frame.scene_to_rd(*np.meshgrid(x, z))
        coordinates = ((northing_origin - n) / SOURCE_STEP - 0.5, (e - easting_origin) / SOURCE_STEP - 0.5)
        covered = map_coordinates(mask, coordinates, order=0, mode='constant')
        ground = map_coordinates(dtm, coordinates, order=0, mode='constant', cval=np.nan)
        surface = map_coordinates(dsm, coordinates, order=0, mode='constant', cval=np.nan)
        height = surface - ground
        valid = covered & (height >= MIN_CROWN_HEIGHT) & (height <= MAX_CROWN_HEIGHT)
        present = np.isfinite(height)
        if np.any(surface[valid] <= 0):
            raise ValueError('Canopy top below zero NAP')
        observed += np.count_nonzero(covered)
        missing += np.count_nonzero(covered & ~present)
        rejected += np.count_nonzero(covered & present & ~valid)
        crowns[start:end] = np.rint(np.where(valid, surface, 0) * 100).astype(np.int16)
    return crowns, dict(observed=int(observed), missingAhn=int(missing), rejectedHeight=int(rejected))


def corridor_shapes(scene):
    for road in scene['roads']:
        if road.get('tunnel') or road.get('layer', 0) < 0:
            continue
        if road.get('kind') not in ROAD_CLASSES:
            continue
        yield LineString(list(zip(road['pts'][::2], road['pts'][1::2]))).buffer(max(3, road.get('width', 6) / 2))
    for railway in scene['railways']:
        if not railway.get('tunnel'):
            yield LineString(list(zip(railway['pts'][::2], railway['pts'][1::2]))).buffer(4)


def osm_corridors(elements, frame):
    for element in elements:
        geometry = element.get('geometry')
        if element.get('type') != 'way' or not geometry or len(geometry) < 2:
            continue
        tags = element.get('tags', {})
        if tags.get('tunnel', 'no') != 'no' or tags.get('layer', '0').startswith('-'):
            continue
        if tags.get('railway') == 'rail':
            halfwidth = 4
        elif tags.get('highway') in ROAD_CLASSES:
            lanes = tags.get('lanes', '2')
            halfwidth = max(3, (int(lanes) if lanes.isdigit() else 2) * 1.6)
        else:
            continue
        path = [frame.lon_lat_to_scene(point['lon'], point['lat']) for point in geometry]
        yield LineString(path).buffer(halfwidth)


def canopy_grid(crowns, bounds, terrain_bounds, step, corridors):
    stride = int(step / SAMPLE_STEP)
    rows, cols = (value // stride for value in crowns.shape)
    coverage = np.empty((rows, cols), dtype=np.uint8)
    top = np.zeros((rows, cols), dtype=np.int16)
    for start in range(0, rows, 32):
        end = min(start + 32, rows)
        quads = crowns[start * stride:end * stride].reshape(end - start, stride, cols, stride)
        quads = quads.transpose(0, 2, 1, 3).reshape(end - start, cols, stride * stride)
        count = np.count_nonzero(quads, axis=2)
        fraction = count / stride**2
        coverage[start:end] = np.where(fraction >= MIN_CROWN_FRACTION, np.rint(fraction * 255), 0)
        # Zeros sort ahead of returns. Pick a robust high return from each patch.
        rank_from_top = np.maximum(1, np.ceil(count * 0.2).astype(np.int32))
        values = np.sort(quads, axis=2)
        top[start:end] = np.take_along_axis(values, (stride**2 - rank_from_top)[..., None], axis=2)[..., 0]
    corridor = rasterize(corridors, out_shape=(rows, cols),
                         transform=from_origin(bounds[0], bounds[1], step, -step), dtype='uint8')
    coverage[corridor == 1] = 0
    x, z = bounds[0] + step * np.arange(cols), bounds[1] + step * np.arange(rows)
    coverage[:, (x < terrain_bounds[0]) | (x + step > terrain_bounds[2])] = 0
    coverage[(z < terrain_bounds[1]) | (z + step > terrain_bounds[3]), :] = 0
    top[coverage == 0] = 0
    # Average the adjacent occupied quadrants. Compute globally so adjacent tiles
    # use identical edge vertices at the same resolution.
    vertices = np.zeros((rows + 1, cols + 1), dtype=np.int32)
    counts = np.zeros(vertices.shape, dtype=np.uint8)
    for dr, dc in ((0, 0), (0, 1), (1, 0), (1, 1)):
        vertices[dr:dr + rows, dc:dc + cols] += top
        counts[dr:dr + rows, dc:dc + cols] += coverage > 0
    vertices = np.rint(np.divide(vertices, counts, out=np.zeros_like(vertices, dtype=np.float32), where=counts > 0))
    return coverage, vertices.astype('<i2')


def write_canopy(directory, bounds, grids, stats):
    min_x, min_z, _, _ = bounds
    cells = {}
    for step, (coverage, vertices) in grids.items():
        rows, cols = coverage.shape
        size = CELLS * step
        for row in range(0, rows - CELLS + 1, CELLS):
            for col in range(0, cols - CELLS + 1, CELLS):
                area = coverage[row:row + CELLS, col:col + CELLS]
                if not area.any():
                    continue
                x, z = min_x + col * step, min_z + row * step
                name = f'{size}_{x}_{z}'
                height = vertices[row:row + CELLS + 1, col:col + CELLS + 1]
                (directory / f'{name}.bin').write_bytes(area.tobytes() + height.tobytes())
                cells[name] = dict(id=name, bounds=[x, z, x + size, z + size], step=step)
                if size == 1000:
                    children = [f'500_{x + dx}_{z + dz}' for dx in (0, 500) for dz in (0, 500)
                                if f'500_{x + dx}_{z + dz}' in cells]
                    if children:
                        cells[name]['children'] = children
    manifest_path = directory / 'manifest.json'
    if manifest_path.exists():
        for previous in json.loads(manifest_path.read_text())['cells']:
            key = previous['id']
            if key not in cells and re.fullmatch(r'(500|1000)_-?\d+_-?\d+', key):
                (directory / f'{key}.bin').unlink(missing_ok=True)
    manifest = dict(version=1, napOrigin=SCENE_NAP_ORIGIN, cells=list(cells.values()),
                    source=dict(canopyYear=CANOPY_YEAR, canopy=CANOPY, surface=WCS, **stats))
    manifest_path.write_text(json.dumps(manifest, separators=(',', ':')) + '\n')
    print(f'{len(cells)} measured forest canopy tiles; {stats}', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('--offline', action='store_true')
    parser.add_argument('--osm-source', type=Path, help='Optional expansion Overpass JSON with way geometry')
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/ede-forest-canopy')
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    args.output.mkdir(parents=True, exist_ok=True)
    scene = load_scene()
    frame = Frame(scene['meta']['lonLatAffine'])
    terrain = json.loads((ROOT / 'assets/ede-terrain-tiles/manifest.json').read_text())
    terrain_bounds = terrain['bounds']
    x0, z0, x1, z1 = terrain_bounds
    bounds = (math.floor(x0 / 500) * 500, math.floor(z0 / 500) * 500,
              math.ceil(x1 / 500) * 500, math.ceil(z1 / 500) * 500)
    x0, z0, x1, z1 = bounds
    x, y = zip(*(frame.scene_to_rd(a, b) for a in (x0, x1) for b in (z0, z1)))
    rd_bounds = (math.floor((min(x) - 5) / SOURCE_SIZE) * SOURCE_SIZE,
                 math.floor((min(y) - 5) / SOURCE_SIZE) * SOURCE_SIZE,
                 math.ceil((max(x) + 5) / SOURCE_SIZE) * SOURCE_SIZE,
                 math.ceil((max(y) + 5) / SOURCE_SIZE) * SOURCE_SIZE)
    print(f'Canopy coverage {bounds}; source cache {rd_bounds}', flush=True)
    crowns, stats = observed_crowns(frame, bounds, source_grids(rd_bounds, args.cache, args.offline), rd_bounds)
    corridors = list(corridor_shapes(scene))
    if args.osm_source:
        raw = args.osm_source.read_bytes()
        corridors.extend(osm_corridors(json.loads(raw)['elements'], frame))
        stats['corridorOsmSha256'] = sha256(raw).hexdigest()
    grids = {step: canopy_grid(crowns, bounds, terrain_bounds, step, corridors) for step in STEPS}
    write_canopy(args.output, bounds, grids, stats)


if __name__ == '__main__':
    main()
