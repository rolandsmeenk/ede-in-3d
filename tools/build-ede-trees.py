#!/usr/bin/env python3
"""Build assets/ede-trees.bin from local PDOK BGT and Ede tree snapshots.

PDOK input is active tree Points in RD New (EPSG:28992). Municipal input is
Ede:monumentale-bomen in WGS84. Optionally supply the source Overpass JSON.
Requires gdaltransform on PATH.
"""

import argparse
from collections import Counter, defaultdict
from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import subprocess


ROOT = Path(__file__).resolve().parents[1]
PDOK, MUNICIPAL, OSM = 1, 2, 4
UNKNOWN = 255
CELL = MUNICIPAL_REACH = 2.5
OSM_REACH = 2
SAME_SOURCE_REACH = 0.2
STEP = 0.2
TILE = 200
GENERA = (
    'acer aesculus alnus castanea corylus crataegus fagus ilex magnolia malus ostrya '
    'platanus prunus pyrus quercus tilia',
    'ailanthus amelanchier betula cercidiphyllum fraxinus gleditsia pterocarya robinia salix',
    'carpinus populus ulmus zelkova',
    'abies cedrus chamaecyparis cupressus juniperus larix metasequoia picea pinus '
    'pseudotsuga sequoia sequoiadendron taxodium taxus thuja',
)
SPECIES = {genus: index for index, genera in enumerate(GENERA) for genus in genera.split()}


@dataclass
class Tree:
    rd: tuple
    world: tuple
    height: float = 0
    diameter: float = 0
    species: int = UNKNOWN
    sources: int = 0


def load_scene(path):
    prefix = 'export const EDE_DATA = '
    with path.open() as lines:
        for line in lines:
            if line.startswith(prefix):
                return json.loads(line[len(prefix):].strip().removesuffix(';'))
    raise ValueError(f'Cannot find the Ede scene data in {path}')


def read_json(path):
    raw = path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    print(f'{path.name} SHA-256 {digest}')
    return json.loads(raw)


def read_geojson(path, crs, geometry_type):
    data = read_json(path)
    if data.get('type') != 'FeatureCollection' or not isinstance(data.get('features'), list):
        raise ValueError(f'Expected a GeoJSON FeatureCollection in {path}')
    crs_name = (data.get('crs') or {}).get('properties', {}).get('name', '')
    if crs_name and not re.search(rf'EPSG:+{crs}$', crs_name, re.IGNORECASE):
        if crs != 4326 or not crs_name.endswith('CRS84'):
            raise ValueError(f'{path} must use EPSG:{crs}, found {crs_name}')
    for feature in data['features']:
        geometry = feature.get('geometry') or {}
        if geometry.get('type') != geometry_type:
            raise ValueError(f'Expected {geometry_type} features in {path}')
        coordinates = geometry['coordinates']
        points = [coordinates] if geometry_type == 'Point' else coordinates
        for point in points:
            yield coordinate(point), feature.get('properties') or {}


def coordinate(point):
    x, y, *_ = point
    if not math.isfinite(x) or not math.isfinite(y):
        raise ValueError(f'Invalid tree coordinate {point}')
    return x, y


def transform(points, source, target):
    if not points:
        return []
    stdin = ''.join(f'{x} {y}\n' for x, y in points)
    result = subprocess.run(
        ['gdaltransform', '-s_srs', f'EPSG:{source}', '-t_srs', f'EPSG:{target}'],
        input=stdin, capture_output=True, text=True, check=True,
    )
    rows = result.stdout.splitlines()
    if len(rows) != len(points):
        raise ValueError(f'Could not project all tree coordinates to EPSG:{target}: {result.stderr.strip()}')
    return [coordinate([float(n) for n in row.split()[:2]]) for row in rows]


def measure(value, unit):
    if value is None:
        return 0
    number = r'\d+(?:[.,]\d+)?'
    match = re.fullmatch(rf'[<>]?\s*({number})(?:\s*[-–]\s*({number}))?\s*(?:{unit})?',
                         str(value).strip(), re.IGNORECASE)
    if not match:
        return 0
    values = [float(n.replace(',', '.')) for n in match.groups() if n is not None]
    return sum(values) / len(values)


def classify(label):
    name = str(label or '').casefold()
    genus = next(iter(name.split()), '')
    species = SPECIES.get(genus, UNKNOWN)
    if species in (0, 1) and re.search(r"fastig|cupressoides|'italica'", name):
        return 2
    return species


def osm_points(osm_path, scene, unproject):
    if osm_path is None:
        print('OSM source: existing EDE_DATA tree positions')
        for t in scene['trees']:
            yield unproject(t['x'], t['z']), t['h'] if t['h'] != 8 else 0, 0, UNKNOWN
        return

    data = read_json(osm_path)
    if not isinstance(data.get('elements'), list) or data.get('remark'):
        raise ValueError('Expected a complete Overpass JSON snapshot')
    for entry in data['elements']:
        tags = entry.get('tags') or {}
        if entry.get('type') != 'node' or tags.get('natural') != 'tree':
            continue
        species = next((s for key in ('species', 'genus', 'taxon')
                        if (s := classify(tags.get(key))) != UNKNOWN), UNKNOWN)
        if species == UNKNOWN and tags.get('leaf_type') == 'needleleaved':
            species = 3
        diameter = measure(tags.get('diameter'), 'm') * 100
        if not diameter:
            diameter = measure(tags.get('circumference'), 'm') * 100 / math.pi
        yield coordinate((entry['lon'], entry['lat'])), measure(tags.get('height'), 'm'), diameter, species


class SpatialGrid:
    def __init__(self):
        self.cells = defaultdict(list)

    def add(self, tree):
        x, y = tree.rd
        self.cells[x // CELL, y // CELL].append(tree)

    def nearby(self, tree, radius):
        x, y = tree.rd
        cx, cy = math.floor(x / CELL), math.floor(y / CELL)
        for ix in range(cx - 1, cx + 2):
            for iy in range(cy - 1, cy + 2):
                for candidate in self.cells.get((ix, iy), ()):
                    distance = (x - candidate.rd[0]) ** 2 + (y - candidate.rd[1]) ** 2
                    if distance <= radius ** 2:
                        yield distance, candidate


def merge(site, extra):
    site.height = site.height or extra.height
    site.diameter = site.diameter or extra.diameter
    if site.species == UNKNOWN:
        site.species = extra.species
    site.sources |= extra.sources


def unique(trees):
    grid = SpatialGrid()
    result = []
    for tree in sorted(trees, key=lambda t: (t.rd, t.species, -t.height, -t.diameter)):
        match = min(grid.nearby(tree, SAME_SOURCE_REACH), key=lambda pair: pair[0], default=None)
        if match is None:
            result.append(tree)
            grid.add(tree)
        else:
            merge(match[1], tree)
    return result


def join(sites, extra, radius):
    grid = SpatialGrid()
    for site in sites:
        grid.add(site)

    # Pair nearest first across the layer so tight rows don't lose distinct trunks.
    pairs = [(distance, tree.rd, site.rd, tree, site)
             for tree in extra for distance, site in grid.nearby(tree, radius)]
    matched = set()
    for _, _, _, tree, site in sorted(pairs, key=lambda pair: pair[:3]):
        if tree.rd in matched or tree.sources & site.sources:
            continue
        merge(site, tree)
        matched.add(tree.rd)
    sites.extend(tree for tree in extra if tree.rd not in matched)


def pack(trees):
    rows = [(round(t.world[0] / STEP), round(t.world[1] / STEP),
             min(65535, round(t.height * 10)), min(255, round(t.diameter)),
             t.species, t.sources) for t in trees]
    tile_step = round(TILE / STEP)
    rows.sort(key=lambda row: (row[0] // tile_step, row[1] // tile_step, row))
    record = struct.Struct('<hhHBBB')
    return struct.pack('<4sI', b'EDT1', len(rows)) + b''.join(record.pack(*r) for r in rows)


def build(pdok_path, municipal_path, osm_path, output):
    scene = load_scene(ROOT / 'js/ede-geodata.js')
    south, west, north, east = scene['meta']['geographicBounds']
    affine = scene['meta']['lonLatAffine']
    lon0, lat0 = affine['lon0'], affine['lat0']
    x0, kx, _ = affine['x']
    z0, _, kz = affine['z']

    def inside(ll):
        return west <= ll[0] <= east and south <= ll[1] <= north

    def project(ll):
        return x0 + (ll[0] - lon0) * kx, z0 + (ll[1] - lat0) * kz

    def unproject(x, z):
        return lon0 + (x - x0) / kx, lat0 + (z - z0) / kz

    rd = [xy for xy, p in read_geojson(pdok_path, 28992, 'Point')
          if p.get('plus_type', 'boom') == 'boom' and p.get('status', 'bestaand') == 'bestaand']
    municipal = [(ll, measure(p.get('boomhoogte'), 'm'), measure(p.get('diameter_n'), 'cm'),
                  classify(p.get('boomsoort_')))
                 for ll, p in read_geojson(municipal_path, 4326, 'MultiPoint') if inside(ll)]
    osm = [r for r in osm_points(osm_path, scene, unproject) if inside(r[0])]
    pdok = [Tree(xy, project(ll), sources=PDOK)
            for xy, ll in zip(rd, transform(rd, 28992, 4326), strict=True) if inside(ll)]
    if not pdok:
        raise ValueError('No active PDOK trees in the Ede scene')

    def in_rd(rows, source):
        rd_coords = transform([ll for ll, *_ in rows], 4326, 28992)
        return [Tree(xy, project(ll), height, diameter, species, source)
                for xy, (ll, height, diameter, species) in zip(rd_coords, rows, strict=True)]

    sites = unique(pdok)
    print(f'PDOK {len(pdok)} in bounds, {len(sites)} after same-source deduplication')
    for name, rows, source, radius in (('Municipal', municipal, MUNICIPAL, MUNICIPAL_REACH),
                                       ('OSM', osm, OSM, OSM_REACH)):
        extras = unique(in_rd(rows, source))
        before = len(sites)
        join(sites, extras, radius)
        added = len(sites) - before
        print(f'{name} {len(rows)} in bounds, {len(extras) - added} matched, {added} added')
    data = pack(sites)
    output.write_bytes(data)
    flags = ', '.join(f'{sources}: {count}' for sources, count in sorted(Counter(t.sources for t in sites).items()))
    print(f'{len(sites)} trees, {len(data)} bytes, source flag counts {{{flags}}}')
    print(f'{sum(t.height > 0 for t in sites)} heights, {sum(t.diameter > 0 for t in sites)} diameters, '
          f'{sum(t.species != UNKNOWN for t in sites)} classified species')
    print(f'{output.name} SHA-256 {hashlib.sha256(data).hexdigest()}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdok', type=Path, help='Active PDOK BGT tree Points in EPSG:28992')
    parser.add_argument('municipal', type=Path, help='Ede monumentale-bomen GeoJSON in WGS84')
    parser.add_argument('--osm', type=Path, help='Raw Overpass JSON, defaulting to the existing Ede scene')
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/ede-trees.bin')
    args = parser.parse_args()
    build(args.pdok, args.municipal, args.osm, args.output)
