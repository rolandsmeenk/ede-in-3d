#!/usr/bin/env python3
"""Bake Ede's distant forest surface from the KEA canopy mask and PDOK AHN."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import gzip
import json
import math
import re
from pathlib import Path
import subprocess

import numpy as np
import rasterio
from PIL import Image
from rasterio.features import rasterize
from rasterio.transform import from_origin
from scipy.ndimage import map_coordinates
from shapely.geometry import LineString, MultiPolygon, Polygon

from ede_height_field import expansion_collision_path, read_height_field
from ede_gis import Frame
from ede_map import load_scene
from ede_raster import require_rd_raster
from ede_scene import SCENE_NAP_ORIGIN

ROOT = Path(__file__).resolve().parents[1]
WCS = 'https://service.pdok.nl/rws/ahn/wcs/v1_0'
CANOPY = 'https://image.arcgisonline.nl/arcgis/rest/services/KEA/Monitoring_boomkroonbedekking/ImageServer'
COVERAGE = ROOT / 'assets/ede-coverage-v1.json'
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
    temporary = path.with_suffix(path.suffix + '.part')
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
    with ThreadPoolExecutor(max_workers=12) as workers:
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


def canopy_grid(crowns, bounds, terrain_bounds, step, corridors, coverage_polygon=None):
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
    if coverage_polygon is not None:
        # Inset by half a cell's diagonal so every retained crown cell stays inside the terrain.
        allowed = rasterize([coverage_polygon.buffer(-step / math.sqrt(2))], out_shape=(rows, cols),
                            transform=from_origin(bounds[0], bounds[1], step, -step), dtype='uint8')
        coverage[allowed == 0] = 0
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


def add_neighbor_masks(cells, directory):
    # A tile can seal real forest edges without waiting for neighbouring tiles to load.
    masks = {key: (directory / f'{key}.bin').read_bytes()[:CELLS**2] for key in cells}
    empty = bytes(CELLS**2)
    for cell in cells.values():
        x, z, _, _ = cell['bounds']
        size = cell['step'] * CELLS
        north, east, south, west = [
            masks.get(f'{size}_{x + dx}_{z + dz}', empty)
            for dx, dz in ((0, -size), (size, 0), (0, size), (-size, 0))
        ]
        rows = (north[-CELLS:], east[::CELLS], south[:CELLS], west[CELLS - 1::CELLS])
        cell['neighborMask'] = [sum((value != 0) << index for index, value in enumerate(row)) for row in rows]


def match_retained_edge(directory, bounds, grids, cells):
    west, _, _, edge = bounds
    for step, (_, vertices) in grids.items():
        old_row = np.zeros(vertices.shape[1], dtype='<i2')
        files = []
        for cell in cells.values():
            x, z, _, _ = cell['bounds']
            if cell['step'] != step or z != edge:
                continue
            path = directory / f"{cell['id']}.bin"
            data = bytearray(path.read_bytes())
            top = np.frombuffer(data, dtype='<i2', offset=CELLS**2, count=CELLS + 1)
            col = (x - west) // step
            old_row[col:col + CELLS + 1] = top
            files.append((path, data, col))
        seam = np.where(old_row > 0, old_row, vertices[-1])
        vertices[-1] = seam
        for path, data, col in files:
            top = np.frombuffer(data, dtype='<i2', offset=CELLS**2, count=CELLS + 1)
            corrected = seam[col:col + CELLS + 1]
            if not np.array_equal(top, corrected):
                top[:] = corrected
                path.write_bytes(data)



def northern_tree_samples(directory, cells, frame, terrain_path):
    """Place estimated stems in measured crown patches around northern approaches."""
    coverage = json.loads((ROOT / 'tools/data/ede-outer-coverage.json').read_text())
    north = coverage['northDetail']
    _, north_edge = frame.lon_lat_to_scene(coverage['geographicBounds'][1], coverage['previousNorth'])
    points = [*north['arrivals'], [5.64806, 52.08292], [5.66632, 52.10760]]
    locations = [frame.lon_lat_to_scene(*point) for point in points]
    columns, rows, left, top, step, _, heights = read_height_field(terrain_path)
    terrain = np.frombuffer(heights, dtype=np.int16).reshape(rows, columns)
    trees = []
    for cell in cells.values():
        west, north_z, east, south = cell['bounds']
        if cell['step'] != 10 or north_z > north_edge:
            continue
        candidates = [(x, z) for x, z in locations
                      if math.hypot(max(west - x, 0, x - east), max(north_z - z, 0, z - south)) < 480]
        if not candidates:
            continue
        data = (directory / f"{cell['id']}.bin").read_bytes()
        mask = np.frombuffer(data, dtype='u1', count=CELLS**2).reshape(CELLS, CELLS)
        heights = np.frombuffer(data, dtype='<i2', offset=CELLS**2).reshape(CELLS + 1, CELLS + 1)
        for row, col in zip(*np.nonzero(mask)):
            if (row + col) % 2:
                continue
            # Use a reproducible offset inside the same surveyed crown cell.
            x = west + col * 10 + 2 + (col * 11 + row * 7) % 7
            z = north_z + row * 10 + 2 + (row * 13 + col * 5) % 7
            if z >= north_edge or not any((x - a)**2 + (z - b)**2 < 480**2 for a, b in candidates):
                continue
            gx, gz = round((x - left) / step), round((z - top) / step)
            if not (0 <= gx < columns and 0 <= gz < rows):
                continue
            crown = heights[row:row + 2, col:col + 2]
            height = round((np.median(crown[crown > 0]) - terrain[gz, gx]) / 10) / 10
            if 4 <= height <= 40:
                trees.append([int(x), int(z), height])
    return trees


def write_canopy(directory, bounds, grids, stats, retained=None, tree_samples=None, buffered=False):
    min_x, min_z, _, _ = bounds
    cells = {} if retained is None else {cell['id']: cell for cell in retained['cells']}
    if retained is not None:
        match_retained_edge(directory, bounds, grids, cells)
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
                if buffered:
                    cells[name]['maxY'] = int(height.max()) / 100 - SCENE_NAP_ORIGIN
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
    add_neighbor_masks(cells, directory)
    source = dict(canopyYear=CANOPY_YEAR, canopy=CANOPY, surface=WCS, **stats)
    if retained is not None:
        source = {**retained['source'], 'north': stats}
    manifest = dict(version=1, napOrigin=SCENE_NAP_ORIGIN, cells=list(cells.values()), source=source)
    if buffered:
        manifest['version'] = 2
        mask = grids[20][0] > 0
        image = Image.fromarray(mask.astype('uint8'), 'P')
        image.putpalette([0, 0, 0, 0x20, 0x29, 0x22])
        image.save(directory / 'cover.png', transparency=0, optimize=True)
        manifest['cover'] = dict(bounds=bounds, step=20)
    if tree_samples:
        manifest['northernTreeSamples'] = tree_samples(cells)
        print(f"{len(manifest['northernTreeSamples'])} estimated stems in measured northern crowns", flush=True)
    manifest_path.write_text(json.dumps(manifest, separators=(',', ':')) + '\n')
    print(f'{len(cells)} measured forest canopy tiles; {stats}', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('--offline', action='store_true')
    parser.add_argument('--osm-source', type=Path, help='Optional expansion Overpass JSON with way geometry')
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/ede-forest-canopy')
    parser.add_argument('--terrain-manifest', type=Path, default=ROOT / 'assets/ede-terrain-tiles/manifest.json')
    parser.add_argument('--retain-existing', action='store_true',
                        help='Add northern cells and retain existing canopy away from their shared edge')
    parser.add_argument('--coverage', type=Path, default=COVERAGE)
    parser.add_argument('--fetch-only', action='store_true', help='Download source rasters without rebuilding assets')
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    args.output.mkdir(parents=True, exist_ok=True)
    scene = load_scene()
    frame = Frame(scene['meta']['lonLatAffine'])
    terrain_manifest = json.loads(args.terrain_manifest.read_text())
    coverage = None
    if terrain_manifest['version'] == 2:
        rings = json.loads(args.coverage.read_text())['terrainBoundary']
        coverage = MultiPolygon([Polygon(list(zip(polygon[0][::2], polygon[0][1::2])),
                                         [list(zip(ring[::2], ring[1::2])) for ring in polygon[1:]])
                                 for polygon in rings])
    terrain_bounds = terrain_manifest['bounds']
    x0, z0, x1, z1 = terrain_bounds
    bounds = (math.floor(x0 / 500) * 500, math.floor(z0 / 500) * 500,
              math.ceil(x1 / 500) * 500, math.ceil(z1 / 500) * 500)
    retained = None
    if args.retain_existing:
        retained = json.loads((args.output / 'manifest.json').read_text())
        edge = min(cell['bounds'][1] for cell in retained['cells'])
        if retained['version'] != 1 or z0 >= edge or edge % 500 or any(cell['bounds'][0] < bounds[0]
                or cell['bounds'][2] > bounds[2] for cell in retained['cells']):
            raise ValueError('Expected a strictly northward extension of the existing canopy')
        root_size = max(CELLS * step for step in STEPS)
        bounds = (bounds[0], edge - math.ceil((edge - z0) / root_size) * root_size, bounds[2], edge)
    x0, z0, x1, z1 = bounds
    x, y = zip(*(frame.scene_to_rd(a, b) for a in (x0, x1) for b in (z0, z1)))
    rd_bounds = (math.floor((min(x) - 5) / SOURCE_SIZE) * SOURCE_SIZE,
                 math.floor((min(y) - 5) / SOURCE_SIZE) * SOURCE_SIZE,
                 math.ceil((max(x) + 5) / SOURCE_SIZE) * SOURCE_SIZE,
                 math.ceil((max(y) + 5) / SOURCE_SIZE) * SOURCE_SIZE)
    print(f'Canopy coverage {bounds}; source cache {rd_bounds}', flush=True)
    if args.fetch_only:
        west, south, east, north = rd_bounds
        locations = [(x, y) for x in range(west, east, SOURCE_SIZE) for y in range(south, north, SOURCE_SIZE)]
        with ThreadPoolExecutor(max_workers=12) as workers:
            for _ in workers.map(lambda xy: source_tile(args.cache, *xy, args.offline), locations):
                pass
        return
    crowns, stats = observed_crowns(frame, bounds, source_grids(rd_bounds, args.cache, args.offline), rd_bounds)
    corridors = []
    if retained is None:
        corridors.extend(corridor_shapes(scene))
    for name in ('ede-corridors-v1.json.gz', 'ede-north-v1.json.gz'):
        path = ROOT / 'assets' / name
        if path.exists():
            raw = path.read_bytes()
            corridors.extend(corridor_shapes(json.loads(gzip.decompress(raw))))
            stats[name.removesuffix('.json.gz') + 'Sha256'] = sha256(raw).hexdigest()
    if args.osm_source:
        raw = args.osm_source.read_bytes()
        corridors.extend(osm_corridors(json.loads(raw)['elements'], frame))
        stats['corridorOsmSha256'] = sha256(raw).hexdigest()
    grids = {step: canopy_grid(crowns, bounds, terrain_bounds, step, corridors, coverage) for step in STEPS}
    tree_samples = None
    if 'ede-north-v1Sha256' in stats:
        collision_path = expansion_collision_path(args.terrain_manifest.parent)
        tree_samples = lambda cells: northern_tree_samples(args.output, cells, frame, collision_path)
    write_canopy(args.output, bounds, grids, stats, retained, tree_samples, buffered=coverage is not None)


if __name__ == '__main__':
    main()
