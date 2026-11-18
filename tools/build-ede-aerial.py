#!/usr/bin/env python3
"""Bake Ede's roof and road colors and a ground JPEG from a local PDOK RGB raster.

Requires gdalinfo, gdaltransform, gdalwarp, and gdal_translate on PATH and a
north-up or rotated RGB/RGBA source in EPSG:28992. A VRT of adjacent tiles should
include an alpha band to mark tile gaps.
"""

import argparse
import json
import math
from mmap import ACCESS_READ, mmap
from pathlib import Path
from statistics import median
import struct
import subprocess
from tempfile import TemporaryDirectory


ROOT = Path(__file__).resolve().parents[1]
PADDING = 150
GROUND_STEP = 3
SAMPLE_STEP = 0.5
MISSING = (0, 0, 0)


def scene_data():
    source = ROOT / 'js/ede-geodata.js'
    prefix = 'export const EDE_DATA = '
    with source.open() as lines:
        for line in lines:
            if line.startswith(prefix):
                return json.loads(line[len(prefix):].strip().removesuffix(';'))
    raise ValueError(f'Cannot read Ede geometry from {source}')


def points(coordinates):
    return zip(coordinates[::2], coordinates[1::2])


def lon_lat(x, z, frame):
    return frame['lon0'] + x / frame['x'][1], frame['lat0'] + z / frame['z'][2]


def ground_grid(bounds):
    west, north, east, south = bounds
    step = GROUND_STEP
    min_x = math.floor((west - PADDING) / step) * step
    min_z = math.floor((north - PADDING) / step) * step
    return {
        'minX': min_x, 'minZ': min_z, 'step': step,
        'width': math.ceil((east + PADDING - min_x) / step) + 1,
        'height': math.ceil((south + PADDING - min_z) / step) + 1,
    }


def ground_bounds(grid, frame):
    west = grid['minX'] - grid['step'] / 2
    north = grid['minZ'] - grid['step'] / 2
    east = west + grid['width'] * grid['step']
    south = north + grid['height'] * grid['step']
    return (*lon_lat(west, south, frame), *lon_lat(east, north, frame))


def to_rd(lon_lat_pairs):
    result = subprocess.run(
        ['gdaltransform', '-s_srs', 'EPSG:4326', '-t_srs', 'EPSG:28992'],
        input=''.join(f'{lon} {lat}\n' for lon, lat in lon_lat_pairs),
        capture_output=True, text=True, check=True,
    )
    projected = [tuple(map(float, row.split()[:2])) for row in result.stdout.splitlines()]
    if len(projected) != len(lon_lat_pairs) or any(
        len(point) != 2 or not all(map(math.isfinite, point)) for point in projected
    ):
        raise ValueError(f'Could not project Ede coordinates to RD New: {result.stderr.strip()}')
    return projected


def projected_geometry(scene, frame):
    geometry = set()
    for building in scene['buildings']:
        for ring in [building['ring'], *building['holes']]:
            geometry.update(points(ring))
    for road in scene['roads']:
        geometry.update(points(road['pts']))
    geometry = sorted(geometry)
    return dict(zip(geometry, to_rd([lon_lat(x, z, frame) for x, z in geometry])))


def raster_info(path):
    return json.loads(subprocess.check_output(['gdalinfo', '-json', str(path)]))


def warp(source, destination, crs, bounds, grid_options, resampling):
    subprocess.run([
        'gdalwarp', '-q', '-t_srs', crs, '-te', *map(str, bounds), *grid_options,
        '-et', '0', '-r', resampling, '-ot', 'Byte', '-srcnodata', '0 0 0',
        '-dstalpha', '-of', 'ENVI', '-co', 'INTERLEAVE=BIP',
        str(source), str(destination),
    ], check=True)


class Image:
    def __init__(self, pixels, width, height, west, north, step):
        if len(pixels) != width * height * 4:
            raise ValueError('Unexpected RGBA image size')
        self.pixels = pixels
        self.width = width
        self.height = height
        self.west = west
        self.north = north
        self.step = step

    def offset(self, x, y):
        column = math.floor((x - self.west) / self.step)
        row = math.floor((self.north - y) / self.step)
        if 0 <= column < self.width and 0 <= row < self.height:
            return (row * self.width + column) * 4
        return None

    def rgb(self, offset):
        if offset is None:
            return None
        r, g, b, a = self.pixels[offset:offset + 4]
        if a == 255 and (r or g or b):
            return r, g, b
        return None


def ring_edges(ring):
    edges = []
    for (x, y), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        dx, dy = x2 - x, y2 - y
        length2 = dx * dx + dy * dy
        if length2:
            edges.append((x, y, dx, dy, length2))
    return edges


def ring_side(x, y, edges, inset2):
    """Return 1 inside, -1 outside, or 0 within the boundary exclusion band."""
    inside = False
    for x0, y0, dx, dy, length2 in edges:
        px, py = x - x0, y - y0
        fraction = max(0, min(1, (px * dx + py * dy) / length2))
        ex, ey = px - fraction * dx, py - fraction * dy
        if ex * ex + ey * ey < inset2:
            return 0
        if (py < 0) != (py < dy) and px < py * dx / dy:
            inside = not inside
    return 1 if inside else -1


def luma(rgb):
    r, g, b = rgb
    return (2 * r + 7 * g + b) / 10


def median_sample(colors, lower, upper):
    colors.sort(key=luma)
    selection = colors[math.floor(len(colors) * lower):math.ceil(len(colors) * upper)]
    return tuple(median(channel) for channel in zip(*selection))


def corrected_color(rgb, minimum, maximum, chroma, chroma_limit):
    gray = luma(rgb)
    brightness = max(minimum, min(maximum, gray))
    return tuple(round(brightness + max(-chroma_limit, min(chroma_limit, (value - gray) * chroma)))
                 for value in rgb)


def vegetation(rgb):
    r, g, b = rgb
    # The orthophoto gives neutral asphalt a slight green cast.
    return (g > r + 19 and g > b + 9) or (g > r - 1 and g > b + 24)


def roof_color(image, ring, holes):
    xs, ys = zip(*ring)
    west, east, south, north = min(xs), max(xs), min(ys), max(ys)
    span_x, span_y = east - west, north - south
    columns = max(1, min(14, math.ceil(span_x / SAMPLE_STEP)))
    rows = max(1, min(14, math.ceil(span_y / SAMPLE_STEP)))
    inset2 = min(1.1, 0.15 * min(span_x, span_y)) ** 2
    outer = ring_edges(ring)
    inner = [ring_edges(hole) for hole in holes]
    colors = []
    for column in range(columns):
        x = west + (column + 0.5) * span_x / columns
        for row in range(rows):
            y = south + (row + 0.5) * span_y / rows
            if ring_side(x, y, outer, inset2) != 1:
                continue
            if any(ring_side(x, y, hole, inset2) != -1 for hole in inner):
                continue
            color = image.rgb(image.offset(x, y))
            if color is not None:
                colors.append(color)
    if len(colors) < 4:
        return MISSING
    color = median_sample(colors, 0.45, 0.9)
    return corrected_color(color, 45, 217, 0.3 if vegetation(color) else 0.85, 40)


def road_color(image, start, end, width):
    x, y = start
    dx, dy = end[0] - x, end[1] - y
    length = math.hypot(dx, dy)
    if length < SAMPLE_STEP:
        return MISSING

    # Stay clear of junctions and sample along the center of the paved strip.
    trim = min(width / 2, length * 0.2, 5) / length
    count = max(3, min(31, math.ceil(length / 1.5)))
    offsets = set()
    for i in range(count):
        fraction = trim + (i + 0.5) * (1 - 2 * trim) / count
        offsets.add(image.offset(x + dx * fraction, y + dy * fraction))
    colors = [color for offset in offsets
              if (color := image.rgb(offset)) is not None and not vegetation(color)]
    if len(colors) < 2 or len(colors) * 2 < len(offsets):
        return MISSING
    r, g, b = color = median_sample(colors, 0.30, 0.84)
    red_paving = r > g + 9 and r > b + 12
    return corrected_color(color, 54, 172, 0.9 if red_paving else 0.52, 40 if red_paving else 22)


def bake_colors(scene, projected, image):
    roofs, segments = bytearray(), bytearray()
    for building in scene['buildings']:
        ring = [projected[point] for point in points(building['ring'])]
        holes = [[projected[point] for point in points(hole)] for hole in building['holes']]
        roofs.extend(roof_color(image, ring, holes))
    for road in scene['roads']:
        path = [projected[point] for point in points(road['pts'])]
        for start, end in zip(path, path[1:]):
            segments.extend(MISSING if road['tunnel'] else road_color(image, start, end, road['width']))
    return struct.pack('<4sII', b'EAC1', len(roofs) // 3, len(segments) // 3) + roofs + segments


def build(source, output):
    info = raster_info(source)
    wkt = info.get('coordinateSystem', {}).get('wkt', '')
    if 'Amersfoort / RD New' not in wkt:
        raise ValueError('Expected a PDOK aerial raster in RD New (EPSG:28992)')
    bands = info.get('bands', [])
    if len(bands) not in (3, 4) or any(band['type'] != 'Byte' for band in bands):
        raise ValueError('Expected three RGB byte bands and an optional alpha band')
    if len(bands) == 4 and bands[3].get('colorInterpretation') != 'Alpha':
        raise ValueError('The fourth source band must be alpha')

    scene = scene_data()
    frame = scene['meta']['lonLatAffine']
    grid = ground_grid(scene['meta']['bounds'])
    west, south, east, north = ground_bounds(grid, frame)
    rd_corners = to_rd([(west, south), (east, south), (west, north), (east, north)])
    xs, ys = zip(*rd_corners)
    rd_bounds = min(xs) - 2, min(ys) - 2, max(xs) + 2, max(ys) + 2
    dimensions = ['-ts', str(grid['width']), str(grid['height'])]

    output.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix='.ede-aerial-', dir=output) as staging:
        staging = Path(staging)
        ground = staging / 'ground.dat'
        ground_jpg = staging / 'ede-aerial-ground.jpg'
        fine = staging / 'fine.dat'
        warp(source, ground, 'EPSG:4326', (west, south, east, north), dimensions, 'average')
        with ground.open('rb') as stream, mmap(stream.fileno(), 0, access=ACCESS_READ) as data:
            alpha = data[3::4]
            if len(alpha) != grid['width'] * grid['height'] or alpha.count(255) != len(alpha):
                raise ValueError('Aerial raster must cover the entire padded ground grid')
        subprocess.run([
            'gdal_translate', '-q', '-of', 'JPEG', '-b', '1', '-b', '2', '-b', '3',
            '-co', 'QUALITY=85', str(ground), str(ground_jpg),
        ], check=True)

        step = str(SAMPLE_STEP)
        warp(source, fine, 'EPSG:28992', rd_bounds, ['-tr', step, step, '-tap'], 'bilinear')
        fine_info = raster_info(fine)
        width, height = fine_info['size']
        west_rd, _, _, north_rd, _, _ = fine_info['geoTransform']
        projected = projected_geometry(scene, frame)
        with fine.open('rb') as stream, mmap(stream.fileno(), 0, access=ACCESS_READ) as data:
            colors = bake_colors(scene, projected, Image(data, width, height, west_rd, north_rd, SAMPLE_STEP))

        (staging / 'ede-aerial-colors.bin').write_bytes(colors)
        (staging / 'ede-aerial.json').write_text(json.dumps(grid, indent=2) + '\n')
        for name in ('ede-aerial-ground.jpg', 'ede-aerial-colors.bin', 'ede-aerial.json'):
            (staging / name).replace(output / name)

    _, roofs, segments = struct.unpack_from('<4sII', colors)
    roof_gaps = sum(colors[i:i + 3] == b'\0\0\0' for i in range(12, 12 + roofs * 3, 3))
    road_gaps = sum(colors[i:i + 3] == b'\0\0\0' for i in range(12 + roofs * 3, len(colors), 3))
    print(f'{grid["width"]} × {grid["height"]} ground pixels at {GROUND_STEP} m')
    print(f'{roofs - roof_gaps}/{roofs} roofs and {segments - road_gaps}/{segments} road segments sampled')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('raster', type=Path, help='PDOK RGB raster or tiled VRT in RD New')
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'assets')
    options = parser.parse_args()
    build(options.raster, options.output_dir)
