#!/usr/bin/env python3
"""Draw paired Ede lane and vehicle traces on their fixed PDOK evidence crops."""

import argparse
from collections import Counter, defaultdict
from hashlib import sha256
from io import BytesIO
import gzip
import json
from math import cos, hypot, sin
from pathlib import Path
from types import SimpleNamespace
from urllib.request import urlopen

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from rasterio import Affine
from rasterio.crs import CRS
from shapely import make_valid, union_all
from shapely.geometry import Polygon

from ede_gis import Frame, raster_pixel_to_rd, source_crs, to_rd

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'tools/data/ede-lane-aerial-traces.json'
DEFAULT_SITES = ('maanderbroek', 'exit24', 'akulaan', 'nachtegaallaan', 'frans-halslaan',
                 'kolkakkerweg', 'albertstunnel')
PROTECTED = {'fietspad', 'voetpad', 'voetgangersgebied', 'verkeerseiland', 'parkeervlak'}
COLORS = {'pavement': '#6cffa9', 'survey': '#8eb8ff', 'aerial': '#22e7fe',
          'exclusion': '#ffb380', 'fitted': '#ee9bff', 'legacy': '#ffdd65',
          'actor': '#ff586d'}


def read(path):
    opener = gzip.open if path.suffix == '.gz' else open
    with opener(path, 'rt') as stream:
        return json.load(stream)


def checksum(payload):
    return sha256(payload).hexdigest()


def load_image(entry, cache, fetch):
    # Content keys allow the same cached raster to be shared by multiple reviews.
    path = cache / (entry['sha256'] + '.jpg')
    payload = path.read_bytes() if path.is_file() else next(
        (candidate.read_bytes() for candidate in cache.glob('*.jpg')
         if checksum(candidate.read_bytes()) == entry['sha256']), None)
    if payload is None and fetch:
        with urlopen(entry['url'], timeout=30) as response:
            payload = response.read()
    if payload is None:
        raise ValueError(f"Missing photo {entry['id']}. Supply the evidence cache or --fetch.")
    if checksum(payload) != entry['sha256']:
        raise ValueError(f"Unexpected aerial image revision for {entry['id']}")
    if fetch and not path.is_file():
        cache.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)
    image = Image.open(BytesIO(payload)).convert('RGB')
    if image.size != (entry['width'], entry['height']):
        raise ValueError(f"Unexpected raster size for {entry['id']}")
    return image


def overlaps(points, bounds):
    west, south, east, north = bounds
    if len(points) == 0:
        return False
    x, y = points.T
    return (x.min() <= east and x.max() >= west and y.min() <= north and y.max() >= south)


class Crop:
    def __init__(self, meta, photo, frame):
        self.meta = meta
        self.frame = frame
        self.raster = SimpleNamespace(transform=Affine(*meta['rasterTransform']),
                                      crs=CRS.from_string(meta['crs']))
        self.inverse = ~self.raster.transform
        self.scale = min(900 / photo.width, 760 / photo.height)
        self.photo = photo.resize((round(photo.width * self.scale), round(photo.height * self.scale)),
                                  Image.Resampling.LANCZOS)
        west, south, east, north = meta['bbox']
        x, z = frame.rd_to_scene(np.array([west, west, east, east]),
                                 np.array([south, north, south, north]))
        self.scene = (min(x) - 1, min(z) - 1, max(x) + 1, max(z) + 1)

    def rd_pixels(self, coords):
        col, row = self.inverse * coords.T
        return list(zip((col - .5) * self.scale, (row - .5) * self.scale))

    def scene_rd(self, coords):
        easting, northing = self.frame.scene_to_rd(*coords.T)
        return np.column_stack((easting, northing))

    def scene_pixels(self, coords):
        return self.rd_pixels(self.scene_rd(coords))

    def validate_annotation(self, row):
        x, y = np.asarray(row['pixelPoints']).T
        easting, northing = raster_pixel_to_rd(self.raster, x, y)
        observed = np.column_stack((easting, northing))
        error = np.linalg.norm(observed - row['points'], axis=1).max()
        if error > .008:
            raise ValueError(f"Photo trace {row['id']} has {error:.3f} m georeferencing error")


def motor_surface(surface):
    role = surface['function']
    return role.startswith('rijbaan ') or role in {'ov-baan', 'verbindingsweg', 'verkeersdrempel', 'woonerf'}


def draw_pavement(image, crop, surfaces):
    # One mask per layer keeps polygon holes transparent without erasing its neighbours.
    by_layer = {}
    for surface in surfaces:
        if not motor_surface(surface):
            continue
        for polygon in surface['polygons']:
            shell = np.asarray(polygon[0]).reshape(-1, 2)
            if not overlaps(shell, crop.scene):
                continue
            layer = surface['layer']
            if layer not in by_layer:
                by_layer[layer] = Image.new('L', image.size)
            mask = by_layer[layer]
            left, top, right, bottom = image.width, image.height, 0, 0
            rings = []
            for flat in polygon:
                pixels = crop.scene_pixels(np.asarray(flat).reshape(-1, 2))
                rings.append(pixels)
                for x, y in pixels:
                    left, top = min(left, x), min(top, y)
                    right, bottom = max(right, x), max(bottom, y)
            left, top = max(0, int(left)), max(0, int(top))
            right, bottom = min(image.width, int(right) + 1), min(image.height, int(bottom) + 1)
            if right <= left or bottom <= top:
                continue
            area = Image.new('L', (right - left, bottom - top))
            paint = ImageDraw.Draw(area)
            for index, ring in enumerate(rings):
                paint.polygon([(x - left, y - top) for x, y in ring], fill=255 if index == 0 else 0)
            mask.paste(255, (left, top), area)
    for layer in sorted(by_layer):
        color = (90, 255, 154, 62 if layer >= 0 else 40)
        ink = Image.new('RGBA', image.size, color)
        image.paste(ink, (0, 0), by_layer[layer].point(lambda value: value * color[3] // 255))


def path_dashes(points, stroke=9, gap=6):
    offset = 0
    for (ax, ay), (bx, by) in zip(points, points[1:]):
        dx, dy = bx - ax, by - ay
        length = hypot(dx, dy)
        distance = 0
        while distance < length:
            lit = offset < stroke
            step = min(length - distance, (stroke if lit else stroke + gap) - offset)
            end = distance + step
            if lit:
                yield [(ax + dx * distance / length, ay + dy * distance / length),
                       (ax + dx * end / length, ay + dy * end / length)]
            distance = end
            offset = (offset + step) % (stroke + gap)


def draw_path(draw, pixels, color, width, *, dashed=False):
    if len(pixels) < 2:
        return
    for path in path_dashes(pixels) if dashed else [pixels]:
        draw.line(path, fill='#182536', width=width + 2, joint='curve')
        draw.line(path, fill=color, width=width, joint='curve')


def draw_reference(crop, surfaces, survey, annotations):
    photo = crop.photo.copy()
    draw_pavement(photo, crop, surfaces)
    draw = ImageDraw.Draw(photo, 'RGBA')
    for coords in survey:
        if overlaps(coords, crop.meta['bbox']):
            draw.line(crop.rd_pixels(coords), fill=(142, 184, 255, 200), width=2)
    for row in annotations:
        crop.validate_annotation(row)
        coords = np.asarray(row['points'])
        pixels = crop.rd_pixels(coords)
        if row.get('closed'):
            draw.polygon(pixels, fill=(255, 113, 70, 70))
        draw_path(draw, pixels, COLORS['exclusion' if row.get('closed') else 'aerial'], 2)
    return photo


def draw_phase(reference, crop, record, top_layer):
    photo = reference.copy()
    draw = ImageDraw.Draw(photo)
    counts = Counter()
    scoped = lambda rows: sorted((row for row in rows if row['site'] == crop.meta['id']),
                                 key=lambda row: row['layer'])
    for row in scoped(record['lanes']):
        points = np.asarray(row['points'])
        if not overlaps(points, crop.scene) or len(points) < 2:
            continue
        label = 'fitted' if row.get('accepted') is True else 'legacy'
        draw_path(draw, crop.scene_pixels(points), COLORS[label], 2, dashed=row['layer'] < top_layer)
        counts[label] += 1
    for row in scoped(record['traces']):
        points = np.asarray(row['points'])
        if not overlaps(points, crop.scene) or len(points) < 2:
            continue
        pixels = crop.scene_pixels(points)
        draw_path(draw, pixels, COLORS['actor'], 4, dashed=row['layer'] < top_layer)
        x, y = pixels[-1]
        draw.ellipse((x - 4, y - 4, x + 4, y + 4), fill=COLORS['actor'], outline='#182536', width=1)
        counts['actor'] += 1
    return photo, counts


def pose_masks(crop, surfaces, annotations):
    road = defaultdict(list)
    protected = defaultdict(list)
    paint = defaultdict(list)
    for surface in surfaces:
        if motor_surface(surface):
            target = road
        elif surface['function'] in PROTECTED:
            target = protected
        else:
            continue
        for polygon in surface['polygons']:
            rings = [np.asarray(ring).reshape(-1, 2) for ring in polygon]
            if overlaps(rings[0], crop.scene):
                outer, *holes = [crop.scene_rd(ring) for ring in rings]
                target[surface['layer']].append(make_valid(Polygon(outer, holes)))
    for row in annotations:
        if row.get('closed'):
            paint[row['layer']].append(Polygon(row['points']))
    return {layer: (union_all(road[layer]).buffer(.06), union_all(protected[layer]),
                    union_all(paint[layer])) for layer in set(road) | set(protected) | set(paint)}


def pose_coverage(crop, masks, record):
    rows = []
    for trace in record['traces']:
        if trace['site'] != crop.meta['id']:
            continue
        samples = Counter()
        outside_max = 0
        empty = Polygon()
        road, protected, paint = masks.get(trace['layer'], (empty, empty, empty))
        for x, z, yaw, half_length, half_width in trace.get('poses', []):
            if not overlaps(np.array([[x, z]]), crop.scene):
                continue
            forward, right = (sin(yaw), cos(yaw)), (cos(yaw), -sin(yaw))
            corners = [(x + forward[0] * u + right[0] * v, z + forward[1] * u + right[1] * v)
                       for u, v in ((-half_length, -half_width), (-half_length, half_width),
                                    (half_length, half_width), (half_length, -half_width))]
            vehicle = Polygon(crop.scene_rd(np.asarray(corners)))
            outside = vehicle.difference(road)
            outside_max = max(outside_max, outside.area)
            if vehicle.intersection(paint).area > .1:
                samples['paintedExclusion'] += 1
            elif outside.intersection(protected).area > .1:
                samples['mappedNonMotor'] += 1
            elif outside.area > .5 * vehicle.area:
                samples['insufficientBgtCoverage'] += 1
            elif outside.area > .1:
                samples['mappedBoundary'] += 1
            else:
                samples['withinMotorSurface'] += 1
        rows.append({'wayId': trace['wayId'], 'lane': trace['lane'], 'layer': trace['layer'],
                     'fitActive': trace.get('accepted'), 'vehicle': trace.get('vehicle'),
                     'samples': dict(samples), 'maxOutsideMotorM2': round(outside_max, 2)})
    return rows


def row_label(counts):
    return f"{counts['fitted']} fitted · {counts['legacy']} legacy · {counts['actor']} vehicle tracks"


def make_figure(crop, reference, before, after):
    gutter, margin, top, bottom = 18, 22, 101, 109
    top_layer = max((0, *(row['layer'] for phase in (before, after) for row in phase['lanes']
                          if row['site'] == crop.meta['id'])))
    panes = [draw_phase(reference, crop, phase, top_layer) for phase in (before, after)]
    w, h = reference.size
    figure = Image.new('RGB', (2 * w + gutter + 2 * margin, top + h + bottom), '#121b28')
    draw = ImageDraw.Draw(figure)
    title, label, small = (ImageFont.load_default(size=size) for size in (24, 16, 13))
    draw.text((margin, 15), crop.meta['label'], font=title, fill='white')
    draw.text((margin, 45), '2026 PDOK aerial image · North up · RD New · Lower paths shown dashed', font=small, fill='#bacce4')
    for index, (photo, counts) in enumerate(panes):
        x = margin + index * (w + gutter)
        draw.text((x, 70), ('Before', 'After')[index], font=label, fill='white')
        draw.text((x + 62, 72), row_label(counts), font=small, fill='#bacce4')
        figure.paste(photo, (x, top))
    entries = [('BGT motor surface', 'pavement'), ('1GIS surveyed paint', 'survey'),
               ('Digitized photo evidence', 'aerial'), ('Painted exclusion', 'exclusion'),
               ('Fitted lane', 'fitted'), ('Legacy lane', 'legacy'), ('Simulated vehicle', 'actor')]
    column = (figure.width - 2 * margin) / 4
    for index, (name, key) in enumerate(entries):
        x = margin + index % 4 * column
        y = top + h + 24 + index // 4 * 24
        draw.line((x, y + 8, x + 20, y + 8), fill=COLORS[key], width=4)
        draw.text((x + 27, y), name, font=small, fill='white')
    draw.text((margin, top + h + 78),
              'Aerial imagery © Beeldmateriaal Nederland via PDOK · CC BY 4.0',
              font=small, fill='#bacce4')
    return figure, [dict(counts) for _, counts in panes]


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('before', type=Path)
    cli.add_argument('after', type=Path)
    cli.add_argument('--cache', type=Path, required=True, help='Local directory of PDOK JPEGs')
    cli.add_argument('--out', type=Path, required=True)
    cli.add_argument('--fetch', action='store_true', help='Fetch missing pinned photos from PDOK')
    cli.add_argument('--site', action='append', help='Site ID to plot. Repeat to select multiple sites.')
    args = cli.parse_args()
    manifest = read(MANIFEST)
    before, after = read(args.before), read(args.after)
    frame = Frame(read(ROOT / 'assets/ede-map-v1.json.gz')['meta']['lonLatAffine'])
    surfaces = read(ROOT / 'assets/ede-road-surfaces.json.gz')['surfaces']
    raw = read(ROOT / 'tools/data/ede-1gis.snapshot.json.gz')
    crs = source_crs(raw)
    survey = []
    for row in raw['layers']['30']:
        for path in row['geometry'].get('paths', []):
            tracked = np.asarray(path)[:, :2]
            easting, northing = to_rd(*tracked.T, crs, axis_order='xy')
            survey.append(np.column_stack((easting, northing)))
    images = {entry['id']: entry for entry in manifest['images']}
    selected = args.site or DEFAULT_SITES
    if unknown := set(selected) - images.keys():
        cli.error(f"Unknown site: {', '.join(sorted(unknown))}")
    args.out.mkdir(parents=True, exist_ok=True)
    clearance = {}
    for site in selected:
        meta = images[site]
        crop = Crop(meta, load_image(meta, args.cache, args.fetch), frame)
        annotations = [row for row in manifest['markings'] if row['site'] == site]
        reference = draw_reference(crop, surfaces, survey, annotations)
        figure, counts = make_figure(crop, reference, before, after)
        masks = pose_masks(crop, surfaces, annotations)
        clearance[site] = {name: pose_coverage(crop, masks, record)
                           for name, record in (('before', before), ('after', after))}
        target = args.out / f'{site}.jpg'
        figure.save(target, quality=94, subsampling=0)
        print(json.dumps({'site': site, 'file': str(target), 'before': counts[0], 'after': counts[1]}))
    (args.out / 'pose-coverage.json').write_text(json.dumps(clearance, indent=2) + '\n')


if __name__ == '__main__':
    main()
