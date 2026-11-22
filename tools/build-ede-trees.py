#!/usr/bin/env python3
"""Build assets/ede-trees.bin from local PDOK BGT and Ede tree snapshots.

PDOK input is active tree Points in RD New (EPSG:28992). Municipal input is
Ede:monumentale-bomen in WGS84. Optionally supply the source Overpass JSON.
Uses the pinned Ede GIS datum grid.
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

from ede_map import load_scene

ROOT = Path(__file__).resolve().parents[1]
PDOK, MUNICIPAL, OSM, SURVEYED = 1, 2, 4, 8
MOR, ROADSIDE, AHN, PHENOLOGY = 16, 32, 64, 128
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
    crown_width: float = 0
    season_group: int = 0
    source_ids: tuple = ()


def read_json(path):
    raw = path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    print(f'{path.name} SHA-256 {digest}')
    return json.loads(raw)


def read_geojson(path, geometry_type):
    from ede_gis import Frame, source_crs

    data = read_json(path)
    if data.get('type') != 'FeatureCollection' or not isinstance(data.get('features'), list):
        raise ValueError(f'Expected a GeoJSON FeatureCollection in {path}')
    crs = source_crs(data)
    for feature in data['features']:
        geometry = feature.get('geometry') or {}
        if geometry.get('type') != geometry_type:
            raise ValueError(f'Expected {geometry_type} features in {path}')
        coordinates = geometry['coordinates']
        points = [coordinates] if geometry_type == 'Point' else coordinates
        properties = feature.get('properties') or {}
        identity = properties.get('lokaal_id') or feature.get('id')
        for point in points:
            # GeoJSON ordinates are x/y even if an older source declares EPSG:4326.
            yield Frame.to_rd(*coordinate(point), crs, axis_order='xy'), properties, identity


def coordinate(point):
    x, y, *_ = point
    if not math.isfinite(x) or not math.isfinite(y):
        raise ValueError(f'Invalid tree coordinate {point}')
    return x, y


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
            yield unproject(t['x'], t['z']), t['h'] if t['h'] != 8 else 0, 0, UNKNOWN, None
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
        yield coordinate((entry['lon'], entry['lat'])), measure(tags.get('height'), 'm'), diameter, species, entry.get('id')


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
    site.source_ids += extra.source_ids


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


def merge_surveyed(sites, records, frame):
    for record in records:
        rd = coordinate(record['rd'])
        identity = record.get('id')
        surveyed = Tree(rd, frame.rd_to_scene(*rd), float(record['height']),
                        float(record['trunkDiameterCm']), int(record['species']), SURVEYED,
                        float(record['crownWidth']), source_ids=((SURVEYED, identity),) if identity else ())
        nearest = min(sites, key=lambda t: math.dist(t.world, surveyed.world), default=None)
        if nearest and math.dist(nearest.world, surveyed.world) <= MUNICIPAL_REACH:
            merge(nearest, surveyed)
            nearest.crown_width = surveyed.crown_width
        else:
            sites.append(surveyed)


def pack(trees):
    expanded = any(t.sources & (MOR | ROADSIDE | AHN | PHENOLOGY) for t in trees)
    has_crowns = any(t.sources & SURVEYED for t in trees)
    rows = [(round(t.world[0] / STEP), round(t.world[1] / STEP),
             min(65535, round(t.height * 10)), min(255, round(t.diameter)),
             t.species, t.sources, min(255, round(t.crown_width * 10)), t.season_group) for t in trees]
    tile_step = round(TILE / STEP)
    rows.sort(key=lambda row: (row[0] // tile_step, row[1] // tile_step, row))
    wide = any(not (-32768 <= row[0] <= 32767 and -32768 <= row[1] <= 32767) for row in rows)
    record = struct.Struct('<iiHBBB' if wide else '<hhHBBB')
    version = b'EDT4' if wide else b'EDT3' if expanded else b'EDT2' if has_crowns else b'EDT1'
    data = bytearray(struct.pack('<4sI', version, len(rows)))
    for *fields, crown, season_group in rows:
        data.extend(record.pack(*fields))
        sources = fields[-1]
        if sources & (SURVEYED | AHN):
            data.append(crown)
        if sources & PHENOLOGY:
            data.append(season_group)
    return bytes(data)


def unpack_baseline(path, frame):
    data = path.read_bytes()
    magic, count = struct.unpack_from('<4sI', data)
    if magic not in {b'EDT1', b'EDT2', b'EDT3', b'EDT4'}:
        raise ValueError('Unexpected Ede tree inventory format')
    record = struct.Struct('<iiHBBB' if magic == b'EDT4' else '<hhHBBB')
    expanded = magic in {b'EDT3', b'EDT4'}
    offset, sites = 8, []
    for _ in range(count):
        x, z, height, diameter, species, sources = record.unpack_from(data, offset)
        offset += record.size
        crown = 0
        if (expanded and sources & (SURVEYED | AHN)) or (magic == b'EDT2' and sources & SURVEYED):
            crown = data[offset] / 10
            offset += 1
        season_group = data[offset] if sources & PHENOLOGY else 0
        if sources & PHENOLOGY:
            offset += 1
        world = x / 5, z / 5
        sites.append(Tree(frame.scene_to_rd(*world), world, height / 10, diameter, species, sources, crown, season_group))
    if offset != len(data):
        raise ValueError('Invalid baseline tree inventory size')
    return sites

def build(pdok_path, municipal_path, osm_path, output, audit=None):
    from ede_gis import Frame

    scene = load_scene()
    west, north, east, south = scene['meta']['bounds']
    frame = Frame(scene['meta']['lonLatAffine'])

    def inside(world):
        return west <= world[0] <= east and north <= world[1] <= south

    def source_id(kind, identity):
        return ((kind, identity),) if audit and identity is not None else ()

    pdok = [Tree(rd, world, sources=PDOK, source_ids=source_id(PDOK, identity))
            for rd, properties, identity in read_geojson(pdok_path, 'Point')
            if properties.get('plus_type', 'boom') == 'boom' and properties.get('status', 'bestaand') == 'bestaand'
            and inside(world := frame.rd_to_scene(*rd))]
    municipal = [Tree(rd, world, measure(p.get('boomhoogte'), 'm'), measure(p.get('diameter_n'), 'cm'),
                      classify(p.get('boomsoort_')), MUNICIPAL, source_ids=source_id(MUNICIPAL, identity))
                 for rd, p, identity in read_geojson(municipal_path, 'MultiPoint')
                 if inside(world := frame.rd_to_scene(*rd))]
    osm = [Tree(Frame.to_rd(*ll, 'OGC:CRS84'), world, height, diameter, species, OSM,
                source_ids=source_id(OSM, identity))
           for ll, height, diameter, species, identity in osm_points(osm_path, scene, frame.scene_to_lon_lat)
           if inside(world := frame.lon_lat_to_scene(*ll))]
    if not pdok:
        raise ValueError('No active PDOK trees in the Ede scene')

    sites = unique(pdok)
    print(f'PDOK {len(pdok)} in bounds, {len(sites)} after same-source deduplication')
    for name, rows, radius in (('Municipal', municipal, MUNICIPAL_REACH), ('OSM', osm, OSM_REACH)):
        extras = unique(rows)
        before = len(sites)
        join(sites, extras, radius)
        added = len(sites) - before
        print(f'{name} {len(rows)} in bounds, {len(extras) - added} matched, {added} added')
    merge_surveyed(sites, read_json(ROOT / 'tools/data/ede-surveyed-trees.json'), frame)
    data = pack(sites)
    output.write_bytes(data)
    if audit:
        audit.write_text(json.dumps({
            'assetSha256': hashlib.sha256(data).hexdigest(),
            'sourceSha256': {path.name: hashlib.sha256(path.read_bytes()).hexdigest()
                             for path in (pdok_path, municipal_path, osm_path) if path},
            'sourceFlags': {'1': 'PDOK BGT', '2': 'Gemeente Ede', '4': 'OpenStreetMap', '8': 'surveyed'},
            'trees': [[t.rd, [round(value / STEP) for value in t.world], t.source_ids] for t in sites],
            'scenePositionQuantumM': STEP,
        }, separators=(',', ':')) + '\n')
    flags = ', '.join(f'{sources}: {count}' for sources, count in sorted(Counter(t.sources for t in sites).items()))
    print(f'{len(sites)} trees, {len(data)} bytes, source flag counts {{{flags}}}')
    print(f'{sum(t.height > 0 for t in sites)} heights, {sum(t.diameter > 0 for t in sites)} diameters, '
          f'{sum(t.species != UNKNOWN for t in sites)} classified species')
    print(f'{output.name} SHA-256 {hashlib.sha256(data).hexdigest()}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdok', type=Path, nargs='?', help='Active PDOK BGT tree Points in EPSG:28992')
    parser.add_argument('municipal', type=Path, nargs='?', help='Ede monumentale-bomen GeoJSON in WGS84')
    parser.add_argument('--osm', type=Path, help='Raw Overpass JSON, defaulting to the existing Ede scene')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--mor', type=Path, help='Public MOR WFS snapshot for an expanded bake')
    parser.add_argument('--roadside', type=Path, help='Gelderland road tree ArcGIS JSON snapshot')
    parser.add_argument('--playable', action='store_true', help='Clip the combined inventory to expanded Gemeente Ede')
    parser.add_argument('--preserve', type=Path, help='Retain existing reviewed and measured tree attributes at matching trunks')
    parser.add_argument('--baseline', type=Path, default=ROOT / 'assets/ede-trees.bin')
    parser.add_argument('--audit', type=Path, help='Write per-record match and placement decisions as JSON')
    parser.add_argument('--canopy', type=Path, help='Directory of native canopy, DSM and DTM audit tiles')
    args = parser.parse_args()
    if args.mor:
        if not args.roadside:
            parser.error('the MOR bake requires a Gelderland snapshot via --roadside')
        from ede_tree_expansion import expand
        expand(args, Tree, unpack_baseline, pack, classify, read_geojson, unique, join)
    else:
        if not args.pdok or not args.municipal:
            parser.error('both baseline snapshots or --mor and --roadside are required')
        build(args.pdok, args.municipal, args.osm, args.output or ROOT / 'assets/ede-trees.bin', args.audit)
