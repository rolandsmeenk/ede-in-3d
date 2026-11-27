#!/usr/bin/env python3
"""Bake the final 2025 BRP crop fields and documented flower sites into Ede scene tiles.

Run with a snapshot directory and --fetch to acquire the public source extracts.
Subsequent runs use those snapshots and the checked-in GIS scene assets.
Each tile row holds a manifest field ID and open X/Z rings in quarter-metre tile-local units.
"""

import argparse
from collections import Counter, defaultdict
from hashlib import blake2s
import gzip
import json
import math
from pathlib import Path
import struct
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import numpy as np
from rasterio.features import shapes
from rasterio.transform import Affine
from shapely import intersection, make_valid, set_precision, transform, union_all
from shapely.geometry import LineString, Point, Polygon, box, shape
from shapely.ops import nearest_points
from shapely.strtree import STRtree

from ede_gis import Frame, source_crs
from ede_map import ROOT, load_playable_boundary, load_playable_scene, read_packed

TILE = 512
GRID = 0.25
MIN_AREA = 1
BRP = 'https://api.pdok.nl/rvo/gewaspercelen/ogc/v1/collections/brpgewas/items'
HABITAT = 'https://geoportaal.gelderland.nl/gisserver/rest/services/Natuurbeheerplan/Natuurbeheerplan/MapServer/96'
FLORON = 'https://www.verspreidingsatlas.nl/projecten/floron/nectarindex/'
BGT_VERGES = 'https://api.pdok.nl/kadaster/bgt/ogc/v1/collections/ondersteunendwegdeel/items'
N224_SURVEYS = {'2928', '3945'}
CADASTRE = 'https://api.pdok.nl/kadaster/brk-kadastrale-kaart/ogc/v1/collections/perceel/items'
LEASE = 'https://www.ede.nl/fileadmin/ede.nl/Pdf-en/Bekendmakingen_Didam_arest/'
RD = 'http://www.opengis.net/def/crs/EPSG/0/28992'
PAVING_ASSETS = ('ede-road-surfaces.json.gz', 'ede-corridor-paving.json.gz', 'ede-north-paving.json.gz',
                 'ede-fringe-paving.json.gz', 'ede-terrain-paving.json.gz')
UNSEALED = {'sand', 'gravel', 'dirt', 'grass'}
TRAVEL_FUNCTIONS = {'voetpad', 'voetgangersgebied', 'fietspad', 'ruiterpad', 'inrit', 'parkeervlak',
                    'ov-baan', 'verbindingsweg', 'verkeersdrempel', 'woonerf', 'overweg', 'spoorbaan'}
PLANT_SETBACK = 0.55
HABITAT_RECIPES = {'N12.02': 'G1', 'N12.05': 'A6', 'N10.01': 'G3', 'N10.02': 'G3', 'N11.01': 'G1'}
RETAIN = {335, 338, 863, 1936}
RECIPES = {1926: 'A6', 657: 'A6'}
STANDING, SPARSE = 1, 2
SOURCES = {
    'brp': {
        'name': 'RVO via PDOK, BRP Gewaspercelen 2025 definitief', 'url': BRP, 'date': '2025-05-15',
        'archive': 'https://service.pdok.nl/rvo/gewaspercelen/atom/downloads/brpgewaspercelen_definitief_2025.gpkg',
        'license': 'Public Domain Mark 1.0',
        'bearing': 'Estimated from the longest edge of each original parcel minimum rotated rectangle',
        'recipes': 'Reference species mixes when a registry crop label describes a mixed planting',
    },
    'gelderland': {
        'name': 'Provincie Gelderland, Beheergebied Natuurbeheerplan 2027', 'url': HABITAT,
        'recipes': 'Reference mixtures assigned by management type. The designation does not record a sowing',
    },
    'floron': {
        'name': 'FLORON / NDFF Verspreidingsatlas, Nectarindex', 'url': FLORON,
        'placement': 'Survey line buffered 2.5 m per side and clipped to mapped grass, planting bed or supporting road verge',
        'vergeGeometry': BGT_VERGES,
        'recipes': 'Representative G1 or G3 for the surveyed habitat. Survey lines do not describe seed mixes',
    },
    'van-balverenweg': {
        'name': 'Ede Doet, Vernieuwen groenstroken Van Balverenweg Bennekom', 'url': 'https://www.ededoet.nl/verslag/2329',
        'placement': 'Published address span projected to OSM street and clipped to BGT greenspace on the house side',
        'recipes': 'G1 reference for the documented sand seedbed. The project did not publish the recipe',
    },
    'ginkel': {
        'name': 'Gemeente Ede, De Ginkel nature-inclusive lease margin',
        'url': LEASE + 'Vraag-en-antwoordlijst_pachtuitgifte_De_Ginkel.pdf',
        'parcels': LEASE + 'Voornemen_tot_uitgifte_circa_30_5_ha._grond_in_geliberaliseerde_pacht_aan_de_Ginkel_in_Ede.pdf',
        'cadastre': CADASTRE,
        'placement': 'Representative inner 3 m strips where listed cadastral parcels overlap registered cereal fields',
        'recipes': 'Optional Edese Biodivers mix documented by Natuurinclusieve Landbouw Gelderland',
        'recipeSource': 'https://www.natuurinclusievelandbouwgelderland.nl/nieuws/duurzame-gronduitgifte-landbouwenclave-de-ginkel/',
    },
}


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()


def read_json(path):
    with (gzip.open(path, 'rt', encoding='utf-8') if path.suffix == '.gz' else path.open(encoding='utf-8')) as handle:
        return json.load(handle)


def fetch_json(url):
    request = Request(url, headers={'User-Agent': 'Ede in 3D offline GIS (github.com/rolandsmeenk/ede-in-3d)'})
    with urlopen(request, timeout=60) as response:
        return json.load(response)


def paged(url):
    while url:
        page = fetch_json(url)
        yield from page['features']
        url = next((link['href'] for link in page['links'] if link['rel'] == 'next'), None)


def refresh(directory, boundary, frame):
    directory.mkdir(parents=True, exist_ok=True)
    rd_bounds = transform(boundary, frame.scene_to_rd, interleaved=False).bounds
    geographic_bounds = transform(boundary, frame.scene_to_lon_lat, interleaved=False).bounds
    rows = [row for row in paged(BRP + '?' + urlencode({
        'limit': 1000, 'bbox': ','.join(map(str, geographic_bounds)), 'crs': RD, 'f': 'json',
    })) if row['properties']['jaar'] == 2025 and row['properties']['status'] == 'Definitief']
    if not rows:
        raise ValueError('Live PDOK endpoint no longer serves final 2025. Use an archived 2025 snapshot.')
    snapshot = {'type': 'FeatureCollection', 'crs': {'type': 'name', 'properties': {'name': RD}}, 'features': rows}
    (directory / 'brp.geojson.gz').write_bytes(gzip.compress(json_bytes(snapshot), mtime=0))
    print(f'Read {len(rows)} final 2025 BRP features', flush=True)

    habitat = fetch_json(HABITAT + '/query?' + urlencode({
        'f': 'geojson', 'where': 'beheertype IN (' + ','.join(f"'{key}'" for key in HABITAT_RECIPES) + ')',
        'geometry': ','.join(map(str, rd_bounds)), 'geometryType': 'esriGeometryEnvelope',
        'inSR': 28992, 'outSR': 28992, 'outFields': 'objectid,beheertype',
        'returnGeometry': 'true', 'geometryPrecision': 2, 'orderByFields': 'objectid',
    }))
    if habitat.get('exceededTransferLimit') or habitat.get('properties', {}).get('exceededTransferLimit'):
        raise ValueError('Gelderland habitat service exceeded the record limit')
    (directory / 'habitat.geojson').write_bytes(json_bytes(habitat))
    surveys = fetch_json(FLORON + 'export.aspx?type=plots')
    (directory / 'floron.geojson').write_bytes(json_bytes(surveys))
    supporting_verges = {}
    for survey in surveys['features']:
        if survey['properties']['PlotId'] not in N224_SURVEYS or not survey['geometry']:
            continue
        area = transform(shape(survey['geometry']).buffer(5), frame.rd_to_scene, interleaved=False)
        geographic = transform(area, frame.scene_to_lon_lat, interleaved=False).bounds
        for verge in paged(BGT_VERGES + '?' + urlencode({
            'bbox': ','.join(map(str, geographic)), 'limit': 100, 'crs': RD, 'f': 'json',
        })):
            if herbaceous_verge(verge):
                supporting_verges[verge['id']] = verge
    snapshot['features'] = list(supporting_verges.values())
    (directory / 'survey-support.geojson').write_bytes(json_bytes(snapshot))
    parcels = list(paged(CADASTRE + '?' + urlencode({
        'filter': "sectie = 'C' AND perceelnummer IN (4003,2489,3556,1371)",
        'filter-lang': 'cql2-text', 'bbox': '5.70,52.02,5.80,52.08', 'limit': 100, 'crs': RD, 'f': 'json',
    })))
    snapshot['features'] = parcels
    (directory / 'ginkel.geojson').write_bytes(json_bytes(snapshot))


def herbaceous_verge(row):
    props = row['properties']
    return (props.get('functie') == 'berm' and props.get('plus_fysiek_voorkomen') == 'gras- en kruidachtigen'
            and props.get('eind_registratie') is None and props.get('termination_date') is None
            and props.get('relatieve_hoogteligging') == 0)


def polygons(geometry):
    if geometry.is_empty:
        return
    if geometry.geom_type == 'Polygon':
        yield geometry
    elif hasattr(geometry, 'geoms'):
        for piece in geometry.geoms:
            yield from polygons(piece)


def pairs(values):
    return list(zip(values[::2], values[1::2]))


def polygon(outer, *holes):
    return make_valid(Polygon(pairs(outer), [pairs(hole) for hole in holes]))


def footprint(row):
    return polygon(row['ring'], *row.get('holes', ()))


def bearing(geometry):
    rectangle = geometry.minimum_rotated_rectangle
    if rectangle.geom_type != 'Polygon':
        return 0
    ring = list(rectangle.exterior.coords)
    dx, dz = max(((b[0] - a[0], b[1] - a[1]) for a, b in zip(ring, ring[1:])),
                 key=lambda edge: math.hypot(*edge))
    return round(math.atan2(dz, dx) % math.pi, 5)


def read_rd(path):
    snapshot = read_json(path)
    if source_crs(snapshot).to_epsg() != 28992:
        raise ValueError(f'Expected an explicit RD New CRS for {path}')
    return snapshot['features']


def scene_geometry(row, boundary, frame):
    geometry = transform(make_valid(shape(row['geometry'])), frame.rd_to_scene, interleaved=False)
    return geometry.intersection(boundary) if not boundary.covers(geometry) else geometry


class LandMask:
    """Reuse the same BGT grass, planting bed and woody/heath cells as scene terrain."""

    def __init__(self):
        with gzip.open(ROOT / 'assets/ede-bgt-land.bin.gz', 'rb') as stream:
            magic, width, height, self.x0, self.z0, self.step = struct.unpack('<IIIfff', stream.read(24))
            if magic != 0x314C4742:
                raise ValueError('Unexpected BGT land mask version')
            self.cells = np.frombuffer(stream.read(), dtype=np.uint8).reshape(height, width)

    def areas(self, bounds, classes):
        xmin, zmin, xmax, zmax = bounds
        rows, cols = self.cells.shape
        first_column = max(0, math.floor((xmin - self.x0) / self.step))
        last_column = min(cols, math.ceil((xmax - self.x0) / self.step))
        first_row = max(0, math.floor((zmin - self.z0) / self.step))
        last_row = min(rows, math.ceil((zmax - self.z0) / self.step))
        if first_column >= last_column or first_row >= last_row:
            return []
        cells = self.cells[first_row:last_row, first_column:last_column]
        selected = np.isin(cells, classes)
        if not selected.any():
            return []
        offset = Affine(self.step, 0, self.x0 + first_column * self.step,
                        0, self.step, self.z0 + first_row * self.step)
        return [shape(row) for row, _ in shapes(cells, mask=selected, transform=offset)]

    def grassy_strip(self, area):
        grass = self.areas(area.bounds, (3, 4))
        return area.intersection(union_all(grass)) if grass else Polygon()


def travel_masks(roads, snapshots):
    covered = defaultdict(set)
    for snapshot in snapshots:
        for road_id, segments in snapshot['covered'].items():
            covered[road_id].update(segments)
        for row in snapshot['surfaces']:
            kind = row.get('function', '')
            travel = row.get('traffic') or kind.startswith('rijbaan ') or kind in TRAVEL_FUNCTIONS
            if row['layer'] == 0 and (travel or row['material'] not in UNSEALED):
                for outer, *holes in row['polygons']:
                    surface = polygon(outer, *holes)
                    yield surface.buffer(PLANT_SETBACK, quad_segs=2) if travel else surface
    # A measured strip can cover only part of a mapped way.
    for row in roads:
        if row['bridge'] or row['tunnel'] or row.get('layer', 0) != 0:
            continue
        points = list(pairs(row['pts']))
        last = len(points) - 1
        start = 0
        half = max(0.75, row.get('width', 0) / 2) + PLANT_SETBACK
        for segment in sorted(covered[row['id']] | {last}):
            if start < segment <= last:
                yield LineString(points[start:segment + 1]).buffer(half, quad_segs=2)
            start = segment + 1


def feature_masks(scene, boundary, land, crops):
    exclusions = [footprint(row) for row in (*scene['buildings'], *scene['water'], *scene['squares'])]
    exclusions.extend(land.areas(boundary.bounds, (1, 2)))
    exclusions.extend(polygon(outer, *holes) for row in read_packed('assets/ede-bag-exterior/footprints.json.gz')
                      if boundary.intersects(box(row['minX'], row['minZ'], row['maxX'], row['maxZ']))
                      for outer, *holes in row['polygons'])
    exclusions.extend(travel_masks(scene['roads'], (read_packed(f'assets/{name}') for name in PAVING_ASSETS)))
    exclusions.extend(row[2] for row in crops if row[1] in {343, 2617, 2619, 2620, 2621, 2622, 2624,
                                                            2625, 2626, 2628, 2629, 2630, 2631, 2639, 2642, 6809})
    surface_exclusions = [geometry for geometry in exclusions if geometry.area > 0]
    mapped_woods = [footprint(row) for row in scene['parks'] if row['kind'] in {'wood', 'forest', 'heath', 'scrub'}]
    return STRtree([*surface_exclusions, *mapped_woods]), STRtree(surface_exclusions)


def remove_overlaps(geometry, tree):
    ids = tree.query(geometry, predicate='intersects')
    if not len(ids):
        return geometry
    return geometry.difference(union_all(tree.geometries[ids]))


def brp_rows(directory, boundary, frame):
    rows, codes = [], {}
    municipal_rd = transform(boundary, frame.scene_to_rd, interleaved=False)
    for row in read_rd(directory / 'brp.geojson.gz'):
        props = row['properties']
        if props['jaar'] != 2025 or props['status'] != 'Definitief':
            raise ValueError('The crop asset must use only definitive 2025 records')
        raw = make_valid(shape(row['geometry']))
        inside = raw.intersection(municipal_rd) if not municipal_rd.covers(raw) else raw
        if inside.area <= MIN_AREA:
            continue
        crop = transform(inside, frame.rd_to_scene, interleaved=False)
        original = crop if inside is raw else transform(raw, frame.rd_to_scene, interleaved=False)
        code = props['gewascode']
        record = codes.setdefault(code, {'name': props['gewas'], 'category': props['category'], 'parcels': 0, 'area': 0})
        record['parcels'] += 1
        record['area'] += inside.area
        rows.append((row['id'], code, crop, bearing(original), record['category']))
    for item in codes.values():
        item['area'] = round(item['area'])
    if len({row[0] for row in rows}) != len(rows):
        raise ValueError('Duplicate BRP source identifier')
    if len(codes) < 100 or len(rows) < 12000:
        raise ValueError(f'Incomplete final 2025 coverage: {len(rows)} records, {len(codes)} codes')
    return sorted(rows), codes


def local_plantings(directory, scene, boundary, frame, land, crops):
    # The addresses bound the documented stroke of the verge. Map only the house side.
    houses = [Point(frame.rd_to_scene(*point)) for point in ((174027, 446379), (173948, 446332))]
    street = union_all([LineString(pairs(row['pts'])) for row in scene['roads'] if row['name'] == 'Van Balverenweg'])
    road_points = [nearest_points(house, street)[1] for house in houses]
    section = Polygon([point.coords[0] for point in (*road_points, *reversed(houses))]).buffer(1)
    area = land.grassy_strip(section)
    yield 'Van Balverenweg 71–83', area, 'G1', 'van-balverenweg', 0

    # Current cadastral limits cross-reference the lease without drawing through unrelated crops.
    cereal = {233, 234, 235, 236, 238, 314, 382, 2652, 7129, 7130}
    for row in read_rd(directory / 'ginkel.geojson'):
        if row['properties']['akr_kadastrale_gemeente_code_waarde'] != 'EDE01':
            continue
        parcel = scene_geometry(row, boundary, frame)
        if parcel.is_empty:
            continue
        number = row['properties']['perceelnummer']
        for identity, code, geometry, _, _ in crops:
            if code not in cereal or not geometry.intersects(parcel):
                continue
            overlap = geometry.intersection(parcel)
            if overlap.area < 5000:
                continue
            margin = overlap.difference(geometry.buffer(-3))
            yield f'Ede C {number}/{identity}', margin, 'ginkel-margin', 'ginkel', STANDING

    verges = union_all([scene_geometry(row, boundary, frame) for row in read_rd(directory / 'survey-support.geojson')
                        if herbaceous_verge(row)])
    for row in read_rd(directory / 'floron.geojson'):
        if not row['geometry']:
            continue
        geometry = scene_geometry(row, boundary, frame)
        properties = row['properties']
        description = f'{properties["Locatie"]} {properties["Omschrijving"]}'.lower()
        if geometry.is_empty or 'heidecorridor' in description:
            continue
        moist = any(word in description for word in ('veensteeg', 'poel', 'pitrus', 'plas'))
        sparse = any(word in description for word in ('controle', 'grassige'))
        strip = geometry.buffer(2.5, cap_style='flat')
        area = land.grassy_strip(strip)
        if properties['PlotId'] in N224_SURVEYS:
            area = area.union(strip.intersection(verges))
        yield properties['PlotId'], area, 'G3' if moist else 'G1', 'floron', SPARSE if sparse else 0


def flower_rows(directory, scene, boundary, frame, land, crops, masks, surface_masks):
    local = list(local_plantings(directory, scene, boundary, frame, land, crops))
    agriculture = STRtree([row[2] for row in crops if row[4] == 'Bouwland' and row[1] not in RECIPES])
    for row in read_rd(directory / 'habitat.geojson'):
        if not row['geometry']:
            continue
        properties = row['properties']
        recipe = HABITAT_RECIPES[properties['beheertype']]
        geometry = scene_geometry(row, boundary, frame)
        if not geometry.is_empty:
            area = remove_overlaps(geometry, agriculture)
            local.append((properties['objectid'], area, recipe, 'gelderland', 0))
    flowers = []
    for identity, area, recipe, source, flags in local:
        if area.is_empty:
            continue
        # Exact BGT grass and documented verges refine coarse OSM forest polygons beside roads.
        exclusions = surface_masks if source in {'floron', 'van-balverenweg'} else masks
        clipped = remove_overlaps(area.intersection(boundary), exclusions)
        clipped = remove_overlaps(clipped, STRtree([row[1] for row in flowers]))
        if clipped.area > MIN_AREA:
            flowers.append((identity, clipped, recipe, source, flags))
    return flowers


def encode_ring(ring, origin_x, origin_z):
    return [value for x, z in list(ring.coords)[:-1]
            for value in (round((x - origin_x) / GRID), round((z - origin_z) / GRID))]


def bake(directory, scene, boundary, frame, output):
    crops, codes = brp_rows(directory, boundary, frame)
    land = LandMask()
    masks, surface_masks = feature_masks(scene, boundary, land, crops)
    flowers = flower_rows(directory, scene, boundary, frame, land, crops, masks, surface_masks)
    flower_mask = STRtree([row[1] for row in flowers])
    print(f'{len(crops)} BRP features and {len(flowers)} flower sites after source reconciliation', flush=True)

    fields, tiles = {}, defaultdict(list)
    painted_codes, planted_sites = Counter(), defaultdict(dict)

    def add(identity, geometry, code, angle, recipe, source, flags):
        if geometry.is_empty:
            return False
        identity_text = str(identity)
        stable_id = int.from_bytes(blake2s(f'{source}:{identity_text}'.encode(), digest_size=4).digest(), 'little')
        if stable_id in fields:
            raise ValueError(f'Field identifier collision for {identity_text}')
        prepared = set_precision(geometry.simplify(.3, preserve_topology=True), GRID)
        tiled = False
        for piece in polygons(prepared):
            if piece.area < MIN_AREA:
                continue
            xmin, zmin, xmax, zmax = piece.bounds
            for tx in range(math.floor(xmin / TILE), math.ceil(xmax / TILE)):
                for tz in range(math.floor(zmin / TILE), math.ceil(zmax / TILE)):
                    ox, oz = tx * TILE, tz * TILE
                    tile = box(ox, oz, ox + TILE, oz + TILE)
                    clipped = intersection(piece, tile, grid_size=GRID)
                    for part in polygons(clipped):
                        if part.area >= MIN_AREA:
                            rings = [encode_ring(ring, ox, oz) for ring in (part.exterior, *part.interiors)]
                            tiles[f'{tx}_{tz}'].append([stable_id, rings])
                            tiled = True
        if tiled:
            fields[stable_id] = [code, angle, recipe, source, flags]
            if source != 'brp':
                planted_sites[source][str(stable_id)] = identity_text
            else:
                painted_codes[code] += 1
        return tiled

    for identity, code, geometry, angle, category in crops:
        if category == 'Landschapselement' or code in RETAIN:
            continue
        area = remove_overlaps(remove_overlaps(geometry, masks), flower_mask)
        add(identity, area, code, angle, RECIPES.get(code), 'brp', SPARSE if code == 1926 else 0)
    for identity, area, recipe, source, flags in flowers:
        add(identity, area, 0, bearing(area), recipe, source, flags)

    if not planted_sites['van-balverenweg'] or not planted_sites['ginkel'] or not planted_sites['floron']:
        raise ValueError('A documented local flower placement disappeared during clipping')
    if not {'2928', '3945'}.intersection(planted_sites['floron'].values()):
        raise ValueError('No surveyed N224 verge survived the paved-surface and vegetation masks')

    assert set(fields) == {row[0] for tile in tiles.values() for row in tile}
    tile_keys = sorted(tiles)
    index = {
        'version': 1, 'tileSize': TILE, 'coordinateUnit': GRID, 'tiles': tile_keys, 'fields': fields,
        'sources': SOURCES, 'codes': codes,
        'siteIds': planted_sites,
        'coverage': {
            'brpParcels': len(crops), 'plantedParcels': dict(painted_codes),
            'flowerSites': sum(map(len, planted_sites.values())),
            'mask': ['Municipal boundary GM0228', 'BGT ground-level roads and paths including unsealed surfaces',
                     'BGT land classes, BAG and OSM building outlines', 'scene shorelines and OSM travel footprint fallback',
                     'BRP water and woody landscape elements'],
        },
    }
    output.mkdir(parents=True, exist_ok=True)
    index_path = output / 'index.json'
    previous_tiles = set(read_json(index_path).get('tiles', ())) if index_path.is_file() else set()
    for name in tile_keys:
        compressed = gzip.compress(json_bytes(tiles[name]), mtime=0)
        (output / f'{name}.json.gz').write_bytes(compressed)
    index_path.write_bytes(json_bytes(index) + b'\n')
    for name in sorted(previous_tiles.difference(tiles)):
        parts = name.split('_')
        if len(parts) == 2 and all(part.lstrip('-').isdigit() for part in parts):
            (output / f'{name}.json.gz').unlink(missing_ok=True)
    print(f'{len(tile_keys)} tiles, {len(fields)} drawn fields, {len(codes)} BRP codes, '
          f'{sum(path.stat().st_size for path in output.iterdir())} bytes')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshots', type=Path)
    parser.add_argument('--fetch', action='store_true', help='Refresh the PDOK, Gelderland and FLORON source snapshots')
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/ede-fields-v1')
    args = parser.parse_args()
    scene = load_playable_scene()
    boundary = load_playable_boundary()
    frame = Frame(scene['meta']['lonLatAffine'])
    if args.fetch:
        refresh(args.snapshots, boundary, frame)
    bake(args.snapshots, scene, boundary, frame, args.output)


if __name__ == '__main__':
    main()
