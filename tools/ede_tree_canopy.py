"""Download local 25 cm tree canopy and AHN samples and derive isolated crowns."""

import argparse
from collections import Counter, deque
from concurrent.futures import ThreadPoolExecutor
import ctypes as c
from ctypes.util import find_library
from functools import cache
from hashlib import sha256
import json
import math
from pathlib import Path
import subprocess
from urllib.parse import urlencode

import numpy as np
from PIL import Image
from shapely import STRtree, contains_xy, points, union_all
from shapely.geometry import box

from ede_gis import Frame, rd_pipeline
from ede_map import load_scene
from ede_tree_expansion import AHN, MOR, SURVEYED, polygons

CANOPY = 'https://image.arcgisonline.nl/arcgis/rest/services/KEA/Monitoring_boomkroonbedekking/ImageServer'
AHN_WCS = 'https://service.pdok.nl/rws/ahn/wcs/v1_0'
ORIGIN = (10425, 617098)
PIXEL = 0.25
TILE_SIZE = 256
REGION_SIZE = 200
# De Vuurvogel, N224, Sijsselt, the northeast woodland and the Hoekelum estate.
SAMPLE_CELLS = [(-4, 3), (-5, -3), (6, 9), (4, -7), (8, -3), (1, 17), (3, 17), (-11, -3)]
SLICE = 1  # AHN4 / 2022. AHN5 / 2024 returns empty native tiles here.


def fetch_file(url, path):
    if not path.exists():
        temporary = path.with_suffix(path.suffix + '.tmp')
        subprocess.run(['curl', '-fsSL', '--retry', '2', '--max-time', '30', url, '-o', temporary], check=True)
        temporary.replace(path)


def cell_bounds(x, z, frame, margin=0):
    coords = [frame.scene_to_rd(a, b) for a in (x * REGION_SIZE - margin, (x + 1) * REGION_SIZE + margin)
              for b in (z * REGION_SIZE - margin, (z + 1) * REGION_SIZE + margin)]
    es, ns = zip(*coords)
    return math.floor(min(es)), math.floor(min(ns)), math.ceil(max(es)), math.ceil(max(ns))


def tile_grid(bounds):
    w, s, e, n = bounds
    dx = TILE_SIZE * PIXEL
    col0, col1 = math.floor((w - ORIGIN[0]) / dx), math.floor((e - ORIGIN[0]) / dx)
    row0, row1 = math.floor((ORIGIN[1] - n) / dx), math.floor((ORIGIN[1] - s) / dx)
    return range(col0, col1 + 1), range(row0, row1 + 1)


def download_samples(directory, frame):
    directory.mkdir(parents=True, exist_ok=True)
    requests = {}
    for x, z in SAMPLE_CELLS:
        bounds = cell_bounds(x, z, frame, 14)
        cols, rows = tile_grid(bounds)
        for col in cols:
            for row in rows:
                requests[directory / f'canopy-{SLICE}-{col}-{row}.lerc'] = f'{CANOPY}/tile/13/{row}/{col}?sliceId={SLICE}'
        w, s, e, n = bounds
        for model in ('dsm', 'dtm'):
            query = urlencode([('service', 'WCS'), ('request', 'GetCoverage'), ('version', '2.0.1'),
                               ('coverageId', f'{model}_05m'), ('format', 'image/tiff'),
                               ('subset', f'x({w},{e})'), ('subset', f'y({s},{n})')])
            requests[directory / f'{model}-{x}-{z}.tif'] = f'{AHN_WCS}?{query}'
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(lambda item: fetch_file(item[1], item[0]), requests.items()))
    print(f'{len(requests)} native canopy and AHN samples cached in {directory}')


@cache
def lerc_decoder():
    lib_path = find_library('Lerc') or find_library('lerc')
    if not lib_path:
        raise RuntimeError('Could not find libLerc. Install the Esri LERC C library or provide LERC_LIBRARY.')
    return setup_lerc(lib_path)


@cache
def setup_lerc(lib_path):
    lib = c.CDLL(lib_path)
    lib.lerc_getBlobInfo.argtypes = (c.c_char_p, c.c_uint, c.POINTER(c.c_uint), c.POINTER(c.c_double), c.c_int, c.c_int)
    lib.lerc_decode.argtypes = (c.c_char_p, c.c_uint, c.c_int, c.c_void_p, c.c_int, c.c_int, c.c_int, c.c_int, c.c_uint, c.c_void_p)
    return lib


def read_canopy_tile(path):
    from os import environ
    lib = setup_lerc(environ['LERC_LIBRARY']) if 'LERC_LIBRARY' in environ else lerc_decoder()
    blob = path.read_bytes()
    info, rasters = (c.c_uint * 11)(), (c.c_double * 3)()
    if lib.lerc_getBlobInfo(blob, len(blob), info, rasters, len(info), len(rasters)):
        raise ValueError(f'Invalid canopy data {path}')
    _, datatype, depth, width, height, bands, valid, _, mask_count, _, _ = info
    if (datatype, depth, width, height, bands) != (1, 1, TILE_SIZE, TILE_SIZE, 1) or mask_count not in (0, 1):
        raise ValueError(f'Unexpected canopy tile shape {path}')
    values = np.zeros((height, width), dtype=np.uint8)
    mask = np.ones((height, width), dtype=np.uint8)
    if not valid:
        return values.astype(bool)
    if lib.lerc_decode(blob, len(blob), mask_count, mask.ctypes.data if mask_count else None,
                       1, width, height, 1, datatype, values.ctypes.data):
        raise ValueError(f'Undecodable canopy tile {path}')
    if not np.isin(values[mask == 1], [0, 1]).all():
        raise ValueError(f'Unexpected canopy pixel class in {path}')
    return (mask == 1) & (values == 1)


def canopy_patch(directory, bounds):
    cols, rows = tile_grid(bounds)
    mask = np.zeros((len(rows) * TILE_SIZE, len(cols) * TILE_SIZE), dtype=bool)
    for i, row in enumerate(rows):
        for j, col in enumerate(cols):
            mask[i*TILE_SIZE:(i+1)*TILE_SIZE, j*TILE_SIZE:(j+1)*TILE_SIZE] = read_canopy_tile(
                directory / f'canopy-{SLICE}-{col}-{row}.lerc')
    return (ORIGIN[0] + cols[0]*TILE_SIZE*PIXEL, ORIGIN[1] - rows[0]*TILE_SIZE*PIXEL, mask)


def read_ahn(path):
    with Image.open(path) as image:
        keys = image.tag_v2[34735]
        crs = next(keys[i + 3] for i in range(4, len(keys), 4) if keys[i:i+3] == (3072, 0, 1))
        tie = image.tag_v2[33922]
        if crs != 28992 or image.tag_v2[33550][:2] != (0.5, 0.5) or tie[:2] != (0.0, 0.0):
            raise ValueError(f'Unexpected AHN transform in {path}')
        return (tie[3], tie[4], np.asarray(image).copy())


def sample_ahn(raster, es, ns):
    w, n, values = raster
    rows = np.floor((n - ns) * 2).astype(int)
    cols = np.floor((es - w) * 2).astype(int)
    valid = (rows >= 0) & (rows < values.shape[0]) & (cols >= 0) & (cols < values.shape[1])
    result = np.full(len(rows), np.nan)
    elevations = values[rows[valid], cols[valid]]
    result[valid] = np.where(np.abs(elevations) < 1000, elevations, np.nan)
    return result


def connected_canopy(mask, row, col):
    reach = 52  # 13 m, treating anything beyond the window as a merging crown.
    if not (reach <= row < mask.shape[0] - reach and reach <= col < mask.shape[1] - reach):
        return None
    patch = mask[row-reach:row+reach+1, col-reach:col+reach+1].copy()
    seeds = [(dr, dc) for dr in range(-4, 5) for dc in range(-4, 5) if patch[reach+dr, reach+dc]]
    if not seeds:
        return np.empty((0, 2))
    dr, dc = min(seeds, key=lambda p: p[0]**2 + p[1]**2)
    first = reach+dr, reach+dc
    queue, shape = deque([first]), [first]
    patch[first] = False
    while queue:
        r, p = queue.popleft()
        if r in (0, 2*reach) or p in (0, 2*reach):
            return None
        for y, x in ((r-1, p), (r+1, p), (r, p-1), (r, p+1)):
            if patch[y, x]:
                queue.append((y, x))
                shape.append((y, x))
                patch[y, x] = False
    return np.asarray(shape) + (row - reach, col - reach)


def compute_height(record, patch, dsm, dtm, frame, blockers, trees):
    w, n, mask = patch
    e, north = record.rd
    row, col = math.floor((n - north) / PIXEL), math.floor((e - w) / PIXEL)
    crown = connected_canopy(mask, row, col)
    if crown is None:
        return 'overlapping or window edge', {}
    if not len(crown):
        return 'no 2022 canopy', {}
    rows, cols = crown.T
    half = max(np.max(np.hypot(rows - row, cols - col)) * PIXEL, 1.5) + 1.5
    if len(trees.query(points([record.rd]), predicate='dwithin', distance=half)[1]) > 1:
        return 'neighbouring trunk', {}
    es, ns = w + (cols + 0.5) * PIXEL, n - (rows + 0.5) * PIXEL
    ll = rd_pipeline().transform(es, ns, errcheck=True)
    x, z = frame.lon_lat_to_scene(*ll)
    tree_block = np.zeros(len(crown), dtype=bool)
    neighbourhood = box(record.world[0] - 18, record.world[1] - 18, record.world[0] + 18, record.world[1] + 18)
    for index in blockers:
        candidates = index.geometries.take(index.query(neighbourhood))
        if len(candidates):
            tree_block |= contains_xy(union_all(candidates).buffer(0.35), x, z)
    if tree_block.mean() > 0.1:
        return 'structure overlap', {}
    heights = sample_ahn(dsm, es, ns) - sample_ahn(dtm, es, ns)
    supported = heights[(~tree_block) & np.isfinite(heights)]
    if len(supported) < 12 or (supported > 2).mean() < 0.55:
        return 'weak current AHN height', {}
    height = round(float(np.quantile(supported, 0.9)), 1)
    diameter = round(math.sqrt(4 * len(crown) * PIXEL**2 / math.pi), 1)
    if not (2 <= height <= 37 and 1.5 <= diameter <= 22):
        return 'implausible dimensions', {}
    values = {}
    if not record.height:
        record.height = height
        values['heightM'] = height
    if not record.crown_width:
        record.crown_width = diameter
        values['crownWidthM'] = diameter
    if values:
        record.sources |= AHN
    return 'inferred', values


def woodland_fraction(cell, patch, frame, woodland):
    min_x, min_z = (v * REGION_SIZE for v in cell)
    outline = box(min_x, min_z, min_x + REGION_SIZE, min_z + REGION_SIZE)
    forest = woodland.geometries.take(woodland.query(outline))
    if not len(forest):
        return None
    w, n, mask = patch
    horizontal = w + (np.arange(mask.shape[1]) + 0.5) * PIXEL
    vertical = n - (np.arange(mask.shape[0]) + 0.5) * PIXEL
    es, ns = np.meshgrid(horizontal, vertical)
    ll = rd_pipeline().transform(es.ravel(), ns.ravel(), errcheck=True)
    x, z = (v.reshape(mask.shape) for v in frame.lon_lat_to_scene(*ll))
    inside = ((x >= min_x) & (x < min_x + REGION_SIZE) & (z >= min_z) & (z < min_z + REGION_SIZE))
    mapped = contains_xy(union_all(forest), x[inside], z[inside])
    if not len(mapped) or mapped.mean() < 0.1:
        return None
    return round(float(mask[inside][mapped].mean()), 3)


def enrich_canopy(directory, asset, records, scene, frame, masks):
    trees = STRtree(points([r.rd for r in records]))
    blockers = [masks[key] for key in ('building', 'BGT structure', 'grade separation')]
    woodland = STRtree(polygons([item for item in scene['parks'] if item['kind'] in ('forest', 'wood')]))
    summaries, rows = [], []
    scene_cells = {cell: [] for cell in SAMPLE_CELLS}
    for tree in records:
        if tree.sources & SURVEYED or not tree.sources & MOR:
            continue
        cell = tuple(math.floor(v / REGION_SIZE) for v in tree.world)
        if cell in scene_cells:
            scene_cells[cell].append(tree)
    counts = Counter()
    for cell, trees_in_cell in scene_cells.items():
        x, z = cell
        patch = canopy_patch(directory, cell_bounds(x, z, frame, 14))
        dsm = read_ahn(directory / f'dsm-{x}-{z}.tif')
        dtm = read_ahn(directory / f'dtm-{x}-{z}.tif')
        fraction = woodland_fraction(cell, patch, frame, woodland)
        if fraction is not None:
            summaries.append([x, z, fraction])
        for record in trees_in_cell:
            if not record.height or not record.crown_width:
                decision, derived = compute_height(record, patch, dsm, dtm, frame, blockers, trees)
                counts[decision] += 1
                counts.update(derived.keys())
                rows.append({'rd': record.rd, 'decision': decision, 'derived': derived})
    asset.write_text(json.dumps({'version': 1, 'tileMeters': REGION_SIZE, 'cells': summaries},
                                separators=(',', ':')) + '\n')
    return {'year': 2022, 'sampledCells': len(scene_cells), 'woodlandCells': summaries,
            'counts': dict(counts), 'woodlandAsset': asset.name,
            'woodlandAssetHash': sha256(asset.read_bytes()).hexdigest()}, rows


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    args = parser.parse_args()
    download_samples(args.directory, Frame(load_scene()['meta']['lonLatAffine']))
