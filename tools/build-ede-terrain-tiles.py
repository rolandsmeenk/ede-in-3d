#!/usr/bin/env python3
"""Bake Ede's outer terrain from public PDOK elevation and 2025 aerial imagery."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import math
from pathlib import Path
import struct
import subprocess

import numpy as np
from PIL import Image
import rasterio
from scipy.ndimage import distance_transform_edt, map_coordinates

from ede_gis import Frame
from ede_map import load_scene
from ede_raster import require_rd_raster
from ede_scene import SCENE_NAP_ORIGIN

ROOT = Path(__file__).resolve().parents[1]
COVERAGE = ROOT / 'tools/data/ede-outer-coverage.json'
WCS = 'https://service.pdok.nl/rws/ahn/wcs/v1_0'
WMS = 'https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0'
SOURCE_SIZE = 2000
SOURCE_PIXEL = 2
STEP = 5
GROUND_STEP = 10
CELLS = 50
LEAF = STEP * CELLS
ROOT_SIZE = LEAF * 16
TRANSITION = 80
AHN_HEADER = struct.Struct('<4sIIffff')


def download(path, service, parameters):
    if path.is_file():
        return
    temporary = path.with_suffix(path.suffix + '.part')
    try:
        subprocess.run([
            'curl', '-fsSG', '--retry', '3', '--max-time', '90', service,
            *[arg for key, value in parameters
              for arg in ('--data-urlencode', f'{key}={value}')],
            '-o', str(temporary)
        ], check=True)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def source_tile(cache, easting, northing, offline):
    east, north = easting + SOURCE_SIZE, northing + SOURCE_SIZE
    image_size = SOURCE_SIZE // SOURCE_PIXEL
    dtm = cache / f'dtm-{easting}-{northing}.tif'
    aerial = cache / f'rgb-{easting}-{northing}.jpg'
    if not offline:
        download(dtm, WCS, [
            ('service', 'WCS'), ('version', '2.0.1'), ('request', 'GetCoverage'),
            ('coverageId', 'dtm_05m'), ('format', 'image/tiff'), ('scaleFactor', '0.25'),
            ('subset', f'x({easting},{east})'), ('subset', f'y({northing},{north})'),
        ])
        download(aerial, WMS, dict(
            SERVICE='WMS', VERSION='1.3.0', REQUEST='GetMap', LAYERS='2025_ortho25',
            STYLES='', CRS='EPSG:28992', FORMAT='image/jpeg', WIDTH=image_size,
            HEIGHT=image_size, BBOX=f'{easting},{northing},{east},{north}'
        ).items())
    return dtm, aerial


def aligned_bounds(points, step, padding=0):
    x, z = zip(*points)
    return (math.floor((min(x) - padding) / step) * step,
            math.floor((min(z) - padding) / step) * step,
            math.ceil((max(x) + padding) / step) * step,
            math.ceil((max(z) + padding) / step) * step)


def legacy_grid():
    data = (ROOT / 'assets/ede-ahn.bin').read_bytes()
    magic, cols, rows, x, z, step, nap_origin = AHN_HEADER.unpack_from(data)
    if magic != b'AHN1' or abs(nap_origin - SCENE_NAP_ORIGIN) > 0.00001:
        raise ValueError('Legacy ground has a different terrain format or NAP datum')
    heights = np.frombuffer(data, dtype='<i2', offset=AHN_HEADER.size).reshape(rows, cols)
    return (x, z, x + (cols - 1) * step, z + (rows - 1) * step), step, heights


def sample_triangles(heights, column, row):
    max_row, max_column = np.subtract(heights.shape, 1)
    column = np.clip(column, 0, max_column)
    row = np.clip(row, 0, max_row)
    i = np.minimum(column.astype(np.int32), max_column - 1)
    j = np.minimum(row.astype(np.int32), max_row - 1)
    u, v = column - i, row - j
    a = heights[j, i]
    b = heights[j, i + 1]
    c = heights[j + 1, i]
    d = heights[j + 1, i + 1]
    return np.where(u + v <= 1, a + (b - a) * u + (c - a) * v,
                    d + (c - d) * (1 - u) + (b - d) * (1 - v))


def join_source_tiles(cache, bounds, offline):
    west, south, east, north = bounds
    width, height = (east - west) // SOURCE_PIXEL, (north - south) // SOURCE_PIXEL
    dtm = np.empty((height, width), dtype=np.float32)
    rgb = np.empty((height, width, 3), dtype=np.uint8)
    locations = [(x, y) for x in range(west, east, SOURCE_SIZE)
                 for y in range(south, north, SOURCE_SIZE)]
    pixels = SOURCE_SIZE // SOURCE_PIXEL
    with ThreadPoolExecutor(max_workers=6) as workers:
        files = workers.map(lambda xy: source_tile(cache, *xy, offline), locations)
        for (x, y), (dtm_file, rgb_file) in zip(locations, files):
            column, row = (x - west) // SOURCE_PIXEL, (north - y - SOURCE_SIZE) // SOURCE_PIXEL
            with rasterio.open(dtm_file) as raster:
                require_rd_raster(raster)
                if (raster.shape != (pixels, pixels)
                        or tuple(raster.bounds) != (x, y, x + SOURCE_SIZE, y + SOURCE_SIZE)
                        or raster.count != 1 or raster.res != (SOURCE_PIXEL, SOURCE_PIXEL)):
                    raise ValueError(f'Unexpected AHN geometry in {dtm_file}')
                data = raster.read(1, masked=True).astype(np.float32).filled(np.nan)
                data[(data <= -9999) | (data > 300)] = np.nan
                dtm[row:row + pixels, column:column + pixels] = data
            with Image.open(rgb_file) as image:
                if image.size != (pixels, pixels):
                    raise ValueError(f'Unexpected orthophoto size in {rgb_file}')
                rgb[row:row + pixels, column:column + pixels] = image.convert('RGB')
    return dtm, rgb


def scene_grid(frame, bounds, sources, source_bounds, legacy):
    x0, z0, x1, z1 = bounds
    old_bounds, old_step, old_heights = legacy
    west, _, _, north = source_bounds
    dtm, rgb = sources
    columns, rows = (x1 - x0) // STEP + 1, (z1 - z0) // STEP + 1
    heights = np.empty((rows, columns), dtype=np.float32)
    colors = np.empty((rows, columns, 3), dtype=np.uint8)
    # Interpolate only measured returns, renormalizing at nodata boundaries.
    valid = np.isfinite(dtm)
    weights = valid.astype(np.float32)
    dtm[~valid] = 0
    x = np.arange(x0, x1 + STEP, STEP)
    for start in range(0, rows, 128):
        end = min(start + 128, rows)
        x_grid, z_grid = np.meshgrid(x, z0 + STEP * np.arange(start, end))
        easting, northing = frame.scene_to_rd(x_grid, z_grid)
        coord = ((north - northing) / SOURCE_PIXEL - 0.5,
                 (easting - west) / SOURCE_PIXEL - 0.5)
        h = map_coordinates(dtm, coord, order=1, mode='constant')
        w = map_coordinates(weights, coord, order=1, mode='constant')
        heights[start:end] = np.divide(h * 100, w, out=np.full_like(h, np.nan), where=w > 0)
        for band in range(3):
            colors[start:end, :, band] = map_coordinates(rgb[:, :, band], coord, order=1, mode='nearest')
    missing = ~np.isfinite(heights)
    count = np.count_nonzero(missing)
    if count:
        if count > heights.size * 0.15:
            raise ValueError(f'Insufficient AHN coverage: {count:,} of {heights.size:,} samples are missing')
        nearest = distance_transform_edt(missing, return_distances=False, return_indices=True)
        heights[missing] = heights[tuple(axis[missing] for axis in nearest)]
    for start in range(0, rows, 128):
        end = min(start + 128, rows)
        z = z0 + STEP * np.arange(start, end)[:, np.newaxis]
        clamped_x = np.clip(x, old_bounds[0], old_bounds[2])
        clamped_z = np.clip(z, old_bounds[1], old_bounds[3])
        fraction = np.minimum(1, np.hypot(x - clamped_x, z - clamped_z) / TRANSITION)
        edge = sample_triangles(old_heights, (clamped_x - old_bounds[0]) / old_step,
                                (clamped_z - old_bounds[1]) / old_step)
        influence = fraction * fraction * (3 - 2 * fraction)
        heights[start:end] = edge + (heights[start:end] - edge) * influence
    print(f'{columns} × {rows} samples at {STEP} m, {count} AHN gaps filled', flush=True)
    return np.rint(heights).astype('<i2'), colors


def write_tiles(directory, bounds, heights, colors, legacy_bounds, retained=None):
    west, south, east, north = bounds
    tiles, roots = {}, []
    dtype = np.dtype([('height', '<i2'), ('rgb', 'u1', (3,))])

    def hidden(x, z, size):
        a, b, c, d = legacy_bounds
        return x >= a and z >= b and x + size <= c and z + size <= d

    def emit(x, z, size, root=False):
        if x >= east or z >= north or x + size <= west or z + size <= south or hidden(x, z, size):
            return None
        half = size // 2
        if x < west or z < south or x + size > east or z + size > north:
            for dx, dz in ((0, 0), (half, 0), (0, half), (half, half)):
                emit(x + dx, z + dz, half, root=True)
            return None
        stride = size // LEAF
        col, row = (x - west) // STEP, (z - south) // STEP
        end_col, end_row = col + size // STEP + 1, row + size // STEP + 1
        samples = heights[row:end_row, col:end_col]
        data = np.empty((CELLS + 1, CELLS + 1), dtype=dtype)
        data['height'] = samples[::stride, ::stride]
        data['rgb'] = colors[row:end_row:stride, col:end_col:stride]
        name = f'{size}_{x}_{z}'
        error = 0
        if stride > 1:
            axis = np.arange(samples.shape[0]) / stride
            coarse = sample_triangles(data['height'], axis, axis[:, np.newaxis])
            error = math.ceil(np.max(np.abs(coarse - samples)) - 1e-9) / 100
        entry = dict(bounds=[x, z, x + size, z + size], error=error, bytes=data.nbytes)
        if stride > 1:
            children = [child for dx, dz in ((0, 0), (half, 0), (0, half), (half, half))
                        if (child := emit(x + dx, z + dz, half))]
            if children:
                entry['children'] = children
        tiles[name] = entry
        (directory / f'{name}.bin').write_bytes(data.tobytes())
        if root:
            roots.append(name)
        return name

    for x in range(west // ROOT_SIZE * ROOT_SIZE, east, ROOT_SIZE):
        for z in range(south // ROOT_SIZE * ROOT_SIZE, north, ROOT_SIZE):
            emit(x, z, ROOT_SIZE, root=True)
    overview_pixels = colors[::GROUND_STEP // STEP, ::GROUND_STEP // STEP]
    if retained is not None:
        previous, prior_heights, prior_colors = retained
        tiles = {**previous['tiles'], **tiles}
        roots = [*previous['roots'], *roots]
        north = previous['bounds'][3]
        bounds = [west, south, east, north]
        heights = np.concatenate((heights[:-1], prior_heights))
        overview_pixels = np.concatenate((overview_pixels[:-1], prior_colors))
    rows, columns = heights.shape
    (directory / 'collision.bin').write_bytes(
        AHN_HEADER.pack(b'AHN1', columns, rows, west, south, STEP, SCENE_NAP_ORIGIN) + heights.tobytes())
    overview = Image.fromarray(overview_pixels)
    overview.save(directory / 'ground.jpg', quality=88, optimize=True, subsampling=0)
    ground = dict(minX=west, minZ=south, step=GROUND_STEP, width=overview.width, height=overview.height)
    manifest = dict(version=1, napOrigin=SCENE_NAP_ORIGIN, bounds=bounds, roots=roots, tiles=tiles, ground=ground)
    (directory / 'manifest.json').write_text(json.dumps(manifest, separators=(',', ':')) + '\n')
    print(f'Wrote {len(tiles)} terrain tiles in {len(roots)} roots', flush=True)


def retained_terrain(directory, bounds):
    previous = json.loads((directory / 'manifest.json').read_text())
    west, edge, east, south = previous['bounds']
    if previous['version'] != 1 or (west, east, south) != (bounds[0], bounds[2], bounds[3]) or bounds[1] >= edge:
        raise ValueError('Expected a strictly northward extension of the existing terrain')
    raw = (directory / 'collision.bin').read_bytes()
    magic, columns, rows, x, z, step, nap = AHN_HEADER.unpack_from(raw)
    if (magic, x, z, step) != (b'AHN1', west, edge, STEP) or abs(nap - SCENE_NAP_ORIGIN) > 1e-5:
        raise ValueError('Retained collision grid has a different frame')
    if (columns, rows) != ((east - west) // STEP + 1, (south - edge) // STEP + 1):
        raise ValueError('Retained collision grid does not match its manifest')
    heights = np.frombuffer(raw, dtype='<i2', offset=AHN_HEADER.size).reshape(rows, columns)
    with Image.open(directory / 'ground.jpg') as image:
        overview = np.array(image.convert('RGB'))
    if overview.shape != ((south - edge) // GROUND_STEP + 1, (east - west) // GROUND_STEP + 1, 3):
        raise ValueError('Retained colour grid does not match its manifest')
    return previous, heights, overview


def join_retained_edge(directory, retained, heights, colors):
    prior, prior_heights, _ = retained
    west, edge, east, _ = prior['bounds']
    edge_colors = np.empty((heights.shape[1], 3), dtype=np.uint8)
    for x in range(west, east, LEAF):
        start = (x - west) // STEP
        raw = np.frombuffer((directory / f'{LEAF}_{x}_{edge}.bin').read_bytes(), dtype=np.uint8)
        edge_colors[start:start + CELLS + 1] = raw.reshape(CELLS + 1, CELLS + 1, 5)[0, :, 2:]
    elevation_difference = prior_heights[0].astype(np.float32) - heights[-1]
    color_difference = edge_colors.astype(np.float32) - colors[-1]
    span = min(TRANSITION // STEP + 1, heights.shape[0])
    t = np.linspace(0, 1, TRANSITION // STEP + 1)[-span:]
    weight = (t * t * (3 - 2 * t))[:, np.newaxis]
    heights[-span:] = np.rint(heights[-span:] + weight * elevation_difference)
    colors[-span:] = np.rint(np.clip(colors[-span:] + weight[:, :, np.newaxis] * color_difference, 0, 255))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path, help='Local directory for downloaded source tiles')
    parser.add_argument('--offline', action='store_true', help='Require cached source files')
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/ede-terrain-tiles')
    parser.add_argument('--retain-existing', action='store_true',
                        help='Append a northward strip to the existing output and reuse its tile payloads')
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    args.output.mkdir(parents=True, exist_ok=True)
    frame = Frame(load_scene()['meta']['lonLatAffine'])
    legacy = legacy_grid()
    lat0, lon0, lat1, lon1 = json.loads(COVERAGE.read_text())['geographicBounds']
    scene = [frame.lon_lat_to_scene(lon, lat) for lon in (lon0, lon1) for lat in (lat0, lat1)]
    x0, z0, x1, z1 = legacy[0]
    bounds = aligned_bounds([*scene, (x0, z0), (x1, z1)], LEAF)
    # Complete the northern root so the edge does not create a row of extra overview batches.
    bounds = (bounds[0], bounds[1] // ROOT_SIZE * ROOT_SIZE, *bounds[2:])
    retained = retained_terrain(args.output, bounds) if args.retain_existing else None
    if retained is not None:
        bounds = (*bounds[:3], retained[0]['bounds'][1])
    a, b, c, d = bounds
    edge = [(x, z) for x in (a, c) for z in (b, d)]
    rd_bounds = aligned_bounds([frame.scene_to_rd(x, z) for x, z in edge], SOURCE_SIZE, STEP)
    print(f'Scene coverage {bounds}, PDOK cache bounds {rd_bounds}', flush=True)
    sources = join_source_tiles(args.cache, rd_bounds, args.offline)
    heights, colors = scene_grid(frame, bounds, sources, rd_bounds, legacy)
    if retained is not None:
        join_retained_edge(args.output, retained, heights, colors)
    write_tiles(args.output, bounds, heights, colors, legacy[0], retained)


if __name__ == '__main__':
    main()
