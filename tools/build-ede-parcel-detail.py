#!/usr/bin/env python3
"""Bake mapped barriers and evidence-based parcel detail across the playable map."""

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from functools import partial
import gzip
import json
from math import ceil
from pathlib import Path
import runpy
import subprocess
from urllib.parse import urlencode

import numpy as np
import osmium
from shapely import STRtree, make_valid, normalize, transform, union_all
from shapely.geometry import LineString, Point, Polygon, box, shape
from shapely.ops import nearest_points

from ede_gis import Frame, source_crs, to_rd
from ede_map import ROOT, load_scene

DETAIL = runpy.run_path(str(Path(__file__).with_name('build-ede-bgt-detail.py')))
parts = DETAIL['parts']
flat_polygon = DETAIL['flat_polygon']
write_json = DETAIL['write_json']

PDOK = 'https://api.pdok.nl/kadaster'
BRK = f'{PDOK}/brk-kadastrale-kaart/ogc/v1/collections'
BAG = f'{PDOK}/bag/ogc/v2/collections'
BGT = f'{PDOK}/bgt/ogc/v1/collections'
WMS = 'https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0'
RD_URI = 'http://www.opengis.net/def/crs/EPSG/0/28992'
HOUSE_EXTRAS = {'overige gebruiksfunctie', 'kantoorfunctie'}
BUSINESS_USES = {'industriefunctie', 'kantoorfunctie', 'winkelfunctie'}
FRONTAGE_ROADS = {'residential', 'living_street', 'unclassified', 'tertiary', 'secondary'}
PAVED_COVER = {'tegels', 'gebakken klinkers', 'betonstraatstenen', 'grasklinkers'}
PILOTS = {
    'bemmelsewaard-west': ('residential', 'w1484241791'),
    'bemmelsewaard-east': ('residential', 'w1013756437'),
    'kelvinstraat': ('business', 'w6959585'),
}
VEHICLE = {'driveway', 'parking_aisle', 'alley'}
GATES = {'gate', 'lift_gate', 'swing_gate', 'entrance', 'kissing_gate', 'sliding_gate', 'stile'}
STYLES = {
    'clippedHedge': ('hedge', 0.55, 0.68, 0x476237),
    'denseHedge': ('hedge', 0.80, 1.65, 0x3b592e),
    'timber': ('fence', 0.12, 1.75, 0x766049),
    'lowTimber': ('fence', 0.12, 0.72, 0x786a56),
    'metalMesh': ('fence', 0.10, 1.55, 0x505956),
    'ivyMesh': ('fence', 0.22, 1.65, 0x425a38),
}
SOURCES = {
    'BRK': {'url': BRK, 'licence': 'CC BY 4.0'},
    'BAG': {'url': BAG, 'licence': 'Public Domain Mark 1.0'},
    'BGT': {'url': BGT, 'licence': 'CC BY 4.0'},
    'OSM': {'url': 'https://www.openstreetmap.org/copyright', 'licence': 'ODbL-1.0'},
    'PDOK aerial imagery': {'url': WMS, 'licence': 'CC BY 4.0'},
}


def request(url):
    return subprocess.check_output(['curl', '-fsSL', '--max-time', '45', '--retry', '2', url])


def snapshot_tiles(scene, frame):
    left, top, right, bottom = scene['meta']['bounds']
    size = 2000
    bounds = transform(box(left, top, right, bottom).segmentize(125), frame.scene_to_rd, interleaved=False).bounds
    x0, y0, x1, y1 = bounds
    for x in range(int(x0 // size), ceil(x1 / size)):
        for y in range(int(y0 // size), ceil(y1 / size)):
            tile = box(x * size, y * size, (x + 1) * size, (y + 1) * size)
            yield f'rd-{x}-{y}', transform(tile.segmentize(125), frame.rd_to_scene, interleaved=False).bounds


def fetch_layers(directory, tiles, frame, day):
    jobs = []
    for tile, bounds in tiles:
        geographic = frame.geographic_bounds(bounds)
        for service, names in (
            (BRK, ('perceel', 'kadastralegrens')),
            (BAG, ('pand',)),
            (BGT, ('begroeidterreindeel', 'onbegroeidterreindeel')),
        ):
            jobs.extend((directory / f'{tile}-{name}.geojson', f'{service}/{name}/items', service == BGT, geographic)
                        for name in names)

    def pages(endpoint, timed, bounds, splits=0):
        params = {'bbox': ','.join(f'{n:.8f}' for n in bounds), 'crs': RD_URI, 'f': 'json', 'limit': 1000}
        if timed:
            params['datetime'] = f'{day}T00:00:00Z'
        url = f'{endpoint}?{urlencode(params)}'
        seen, features = set(), {}
        try:
            while url:
                if url in seen:
                    raise ValueError(f'Repeated page for {endpoint}')
                seen.add(url)
                page = json.loads(subprocess.check_output(['curl', '-fsSL', '--compressed', '--max-time', '18', url]))
                features.update((row['id'], row) for row in page['features'])
                url = next((row['href'] for row in page.get('links', ()) if row['rel'] == 'next'), None)
        except subprocess.CalledProcessError:
            if splits >= 2:
                raise
            west, south, east, north = bounds
            longitude, latitude = (west + east) / 2, (south + north) / 2
            return {key: row for x0, x1 in ((west, longitude), (longitude, east))
                    for y0, y1 in ((south, latitude), (latitude, north))
                    for key, row in pages(endpoint, timed, (x0, y0, x1, y1), splits + 1).items()}
        return features

    def fetch_one(job):
        path, endpoint, timed, bounds = job
        if path.exists():
            return None
        try:
            features = list(pages(endpoint, timed, bounds).values())
            temporary = path.with_suffix('.partial')
            write_json(temporary, {'type': 'FeatureCollection', 'horizontalCrs': RD_URI, 'features': features})
            temporary.replace(path)
            print(f'{path.name}: {len(features)}', flush=True)
            return None
        except (subprocess.CalledProcessError, ValueError, KeyError) as error:
            return f'{path.name}: {error}'

    with ThreadPoolExecutor(max_workers=12) as pool:
        failures = [error for error in pool.map(fetch_one, jobs) if error]
    if failures:
        raise ValueError('Incomplete parcel snapshot:\n' + '\n'.join(failures))


def fetch_review_images(directory):
    # Fixed RD windows make the manually reviewed observations reproducible.
    previews = {
        'kernhem-east': (171210, 451270, 171443, 451394),
        'kernhem-west': (170972, 451110, 171115, 451448),
        'frankeneng': (171227, 448988, 171415, 449208),
    }
    jobs = []
    for place, (x0, y0, x1, y1) in previews.items():
        path = directory / f'{place}-2025_orthoHR.jpg'
        params = {'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetMap',
                  'LAYERS': '2025_orthoHR', 'STYLES': '', 'CRS': 'EPSG:28992',
                  'FORMAT': 'image/jpeg', 'BBOX': f'{x0},{y0},{x1},{y1}',
                  'WIDTH': min(1800, ceil((x1 - x0) * 6)), 'HEIGHT': min(2100, ceil((y1 - y0) * 6))}
        jobs.append((path, f'{WMS}?{urlencode(params)}'))

    def fetch_one(job):
        path, url = job
        if path.exists():
            return
        data = request(url)
        if not data.startswith(b'\xff\xd8'):
            raise ValueError(f'PDOK did not return a JPEG for {path.name}')
        path.write_bytes(data)
        print(path.name, flush=True)

    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(fetch_one, jobs))


def read_shapes(path):
    document = json.loads(path.read_bytes())
    project = partial(to_rd, crs=source_crs(document), axis_order='xy')
    for feature in document['features']:
        if feature.get('geometry'):
            geometry = transform(shape(feature['geometry']), project, interleaved=False)
            if not geometry.is_empty:
                yield feature['id'], feature['properties'], make_valid(geometry)


def extract_osm(directory, paths, bounds):
    path = directory / 'osm.json'
    if path.exists() and not paths and json.loads(path.read_bytes()).get('bounds') == list(bounds):
        return
    if not paths:
        raise ValueError('Provide Gelderland and Utrecht province extracts with --osm')
    west, south, east, north = bounds
    elements, dates = {}, {}
    tags = osmium.filter.TagFilter(
        *(('barrier', tag) for tag in sorted(GATES | {'hedge', 'fence'})),
        *(('entrance', tag) for tag in ('yes', 'main', 'home', 'service', 'private', 'garage', 'staircase')), *(('service', tag) for tag in sorted(VEHICLE)),
    )

    class Extract(osmium.SimpleHandler):
        @staticmethod
        def relevant(coordinates):
            return west <= coordinates[0] <= east and south <= coordinates[1] <= north

        def node(self, node):
            point = [node.location.lon, node.location.lat]
            if self.relevant(point):
                elements[f'n{node.id}'] = {'points': [point], 'tags': dict(node.tags)}

        def way(self, way):
            points = [[node.lon, node.lat] for node in way.nodes if node.location.valid()]
            if len(points) > 1 and any(map(self.relevant, points)):
                elements[f'w{way.id}'] = {'points': points, 'tags': dict(way.tags)}

    for pbf in paths:
        with osmium.io.Reader(str(pbf)) as reader:
            dates[pbf.name] = reader.header().get('osmosis_replication_timestamp')
        Extract().apply_file(str(pbf), locations=True, filters=[tags])
    write_json(path, {'sourceDates': dates, 'bounds': bounds, 'elements': dict(sorted(elements.items()))})
    print(f'OSM: {len(elements)} tagged features', flush=True)


def read_packed(name):
    path = ROOT / 'assets' / name
    return json.loads(gzip.decompress(path.read_bytes()))


def scene_shape(row):
    if row.get('points'):
        return LineString(row['points'])
    return Polygon(row['polygon'], row.get('holes', ()))


def local_union(index, area, margin=0):
    rows = index.geometries[index.query(area, predicate='dwithin', distance=margin)]
    return union_all(rows)


def measured_dimension(value, default, lower, upper):
    try:
        amount = float((value or '').removesuffix(' m').replace(',', '.'))
    except ValueError:
        return default
    return amount if lower <= amount <= upper else default


def stable_lines(figure, minimum=.8):
    return sorted((normalize(line).simplify(.055) for line in parts(figure, 'LineString') if line.length >= minimum),
                  key=lambda line: (*line.bounds, line.wkt))


def to_scene_record(geometry, frame):
    world = transform(geometry, frame.rd_to_scene, interleaved=False)
    if world.geom_type == 'LineString':
        points = []
        for x, z in world.coords:
            point = (round(x, 2), round(z, 2))
            if not points or point != points[-1]:
                points.append(point)
        return {'points': points} if len(points) >= 2 else None
    record = DETAIL['polygon_record'](world)
    # Thin millimetre fragments can close after export rounding.
    polygon = Polygon(record['polygon'], record['holes'])
    return record if polygon.is_valid and polygon.area > .12 else None


def osm_styles(tags, kind, height):
    if kind == 'hedge':
        return 'clippedHedge' if height and height <= 1 else 'denseHedge'
    material = tags.get('fence_type', '')
    if material in {'wood', 'wooden', 'picket', 'split_rail'}:
        return 'lowTimber' if height and height <= 1 else 'timber'
    if material in {'ivy', 'planted'}:
        return 'ivyMesh'
    return 'metalMesh'


def feature_style(style, tags=None):
    tags = tags or {}
    kind, width, height, color = STYLES[style]
    width = measured_dimension(tags.get('width'), width, .05, 4)
    height = measured_dimension(tags.get('height'), height, .35, 4)
    row = {'type': kind, 'style': style, 'width': width, 'height': height, 'color': color}
    if kind == 'fence':
        row['spacing'] = 2 if style in {'timber', 'lowTimber'} else 2.5
    return row


def feature_level(tags):
    layer = tags.get('layer', '0')
    return int(layer) if layer.lstrip('-').isdigit() else None


def access_geometry(osm, area):
    openings = []
    barriers = []
    for identity, osm_row in osm['elements'].items():
        tags = osm_row['tags']
        coords = [to_rd(*p, 'OGC:CRS84') for p in osm_row['points']]
        geometry = Point(coords[0]) if len(coords) == 1 else LineString(coords)
        if geometry.is_empty or not area.intersects(geometry):
            continue
        barrier = tags.get('barrier')
        if geometry.geom_type == 'LineString' and barrier in {'hedge', 'fence'}:
            barriers.append((identity, tags, geometry))
        if feature_level(tags) != 0:
            continue
        if barrier in GATES or tags.get('entrance'):
            fallback = 3.2 if barrier in {'gate', 'lift_gate', 'swing_gate', 'sliding_gate'} else 1.45
            width = measured_dimension(tags.get('maxwidth:physical') or tags.get('width'), fallback, .6, 10)
            openings.append(geometry.buffer(width / 2 + .14))
        elif tags.get('service') in VEHICLE and len(coords) > 1:
            widths = {'driveway': 3.0, 'alley': 2.2, 'parking_aisle': 4.2}
            width = measured_dimension(tags.get('width'), widths[tags['service']], 1, 12)
            openings.append(geometry.buffer(width / 2 + .2, cap_style='flat'))
    return openings, barriers


def import_barriers(osm, base, existing_tree, frame, area, clearance, review):
    rows, replacements, seen = [], set(), {}
    for identity, tags, source in osm:
        if feature_level(tags) != 0 or tags.get('bridge') in {'yes', 'viaduct'} or tags.get('tunnel') == 'yes':
            review.append({'id': identity, 'reason': 'unverified-relative-level'})
            continue
        kind = tags['barrier']
        style = feature_style(osm_styles(tags, kind, measured_dimension(tags.get('height'), None, .35, 4)), tags)
        explicit_appearance = any(tags.get(key) for key in ('fence_type', 'height', 'width'))
        half = style['width'] / 2
        original = source.intersection(area)
        keep = original.difference(local_union(clearance, original, half + .24).buffer(half + .18))
        if keep.length < .8:
            review.append({'id': identity, 'reason': 'inside-access-or-building-clearance'})
            continue
        if original.length - keep.length > .25:
            review.append({'id': identity, 'reason': 'trimmed-access-or-building-clearance',
                           'removedMetres': round(original.length - keep.length, 2)})
        duplicate_ids, duplicate_regions = [], []
        for i in sorted(existing_tree.query(keep, predicate='dwithin', distance=0.8)):
            known, geometry = base[i]
            pad = geometry.buffer(.8, cap_style='flat')
            overlap = keep.intersection(pad).length
            # A transverse crossing produces a short intersection too. Demand alignment for lines.
            aligned = geometry.geom_type != 'LineString' or geometry.intersection(keep.buffer(.55)).length >= 1
            if overlap < min(2.2, keep.length * .75) or not aligned:
                continue
            duplicate_ids.append(known['id'])
            duplicate_regions.append(pad)
            if known.get('source') == 'bgt' and known['type'] == kind and explicit_appearance:
                linked = geometry.intersection(keep.buffer(.85)).length
                if linked >= geometry.length * .8 and known['id'] not in replacements:
                    replacement = {**known, 'id': f"parcel:bgt:{known['id']}", 'status': 'observed',
                                   'sourceIds': [f"BGT:{known['id']}", f"OSM:{identity}"], **style}
                    replacement.pop('source', None)
                    # Keep existing height and width unless evidence supplies a valid measurement.
                    replacement['height'] = measured_dimension(tags.get('height'), known['height'], .35, 4)
                    if 'width' in known:
                        width = measured_dimension(tags.get('width'), known['width'], .05, 4)
                        if geometry.geom_type == 'LineString' and width > known['width']:
                            extended = geometry.buffer(width / 2).difference(geometry.buffer(known['width'] / 2))
                            if not extended.intersection(local_union(clearance, extended)).is_empty:
                                width = known['width']
                                review.append({'id': identity, 'reason': 'kept-surveyed-width-for-clearance'})
                        replacement['width'] = width
                    rows.append(replacement)
                    replacements.add(known['id'])
        if duplicate_ids:
            review.append({'id': identity, 'reason': 'matched-existing-barrier', 'matchedIds': duplicate_ids})
        keep = keep.difference(union_all(duplicate_regions))
        for i, line in enumerate(stable_lines(keep)):
            # OSM can contain duplicate adjacent objects traced with slightly different coordinates.
            geom_key = to_scene_record(line, frame)
            if not geom_key:
                continue
            key = tuple(geom_key['points'])
            if key in seen:
                review.append({'id': identity, 'reason': 'duplicate-osm-line', 'matchedIds': [seen[key]]})
                continue
            seen[key] = identity
            rows.append({'id': f'parcel:osm:{identity}:{i}', 'sourceIds': [f'OSM:{identity}'],
                         'status': 'observed', 'level': 0, 'collidable': kind == 'fence',
                         **style, **geom_key})
    return rows, replacements


def valid_bag(row):
    return row.get('status') in {'Pand in gebruik', 'Pand in gebruik (niet ingemeten)'} and row.get('geconstateerd') in {None, False, 'N'}


def projection_bounds(polygon, origin, axis):
    values = (np.array(polygon.exterior.coords) - origin) @ axis
    return float(min(values)), float(max(values))


def rectangle(origin, direction, a, b, left, right):
    across = np.array([-direction[1], direction[0]])
    return Polygon([origin + direction * x + across * z for x, z in ((a, left), (b, left), (b, right), (a, right))])


def parcel_candidates(parcel_source, bag_source, road, category):
    buildings = []
    for _, prop, geometry in bag_source:
        if not valid_bag(prop) or geometry.geom_type != 'Polygon' or geometry.area < 24:
            continue
        purposes = prop.get('gebruiksdoel') or []
        if isinstance(purposes, str):
            purposes = purposes.replace(',', ' ').split()
        use = 'woonfunctie' in purposes
        if category == 'residential' and not use or category == 'business' and (use or not set(purposes) & {
                'industriefunctie', 'kantoorfunctie', 'winkelfunctie', 'bijeenkomstfunctie'}):
            continue
        buildings.append((prop['identificatie'], geometry))
    building_index = STRtree([building for _, building in buildings])
    for _, prop, geometry in parcel_source:
        if prop.get('status_historie_waarde') != 'Geldig':
            continue
        polygons = list(parts(geometry, 'Polygon'))
        if len(polygons) != 1:
            continue
        parcel = polygons[0]
        if not (30 <= parcel.area <= (750 if category == 'residential' else 12500)) or parcel.distance(road) > 18:
            continue
        hits = []
        for i in building_index.query(parcel, predicate='intersects'):
            identity, footprint = buildings[i]
            overlap = footprint.intersection(parcel).area
            if overlap > footprint.area * .68:
                hits.append((overlap, identity, footprint))
        if not hits:
            continue
        _, building_id, building = max(hits, key=lambda row: (row[0], row[1]))
        if building.distance(road) > (33 if category == 'residential' else 59):
            continue
        road_point, building_point = nearest_points(road, building)
        vector = np.array(road_point.coords[0]) - np.array(building.representative_point().coords[0])
        length = np.linalg.norm(vector)
        if length < 1:
            continue
        direction = vector / length
        origin = np.array(building.representative_point().coords[0])
        rear, front = projection_bounds(building, origin, direction)
        street = parcel.intersection(LineString([building_point, road_point]))
        if street.is_empty or street.length < .9:
            continue
        exit_point = nearest_points(street, road_point)[0]
        if exit_point.distance(road) > 20:
            continue
        yield (prop['identificatie_lokaal_id'], parcel, building_id, building,
               origin, direction, rear, front, exit_point, building_point)


def geometry_pieces(geom, minimum):
    return sorted((normalize(p).simplify(.09, preserve_topology=True) for p in parts(geom, 'Polygon') if p.area >= minimum),
                  key=lambda p: (*p.bounds, p.wkt))


def surface_record(rows, key, surface, geometry, status, source_ids, frame, pilot, minimum=1.2):
    for i, polygon in enumerate(geometry_pieces(geometry, minimum)):
        if (record := to_scene_record(polygon, frame)):
            rows.append({'id': f'parcel:{key}:{surface}:{i}', 'sourceIds': source_ids, 'pilot': pilot,
                         'type': 'parcelSurface', 'surface': surface, 'status': status,
                         'level': 0, **record})


def surveyed_ground(records, collection, category, area):
    for identity, prop, geometry in records:
        if (prop.get('status') != 'bestaand' or prop.get('eind_registratie') or
                prop.get('plus_status') in {'plan', 'historie'} or prop.get('relatieve_hoogteligging') not in (None, 0)):
            continue
        land_class = DETAIL['land_class'](collection, prop)
        if land_class == 'grass':
            surface = 'lawn'
        elif land_class == 'plantingBed':
            surface = 'plantingBed'
        elif prop.get('plus_fysiek_voorkomen') in PAVED_COVER:
            # Pavers establish a ground material, not whether a patio is private parking.
            surface = 'path' if category == 'residential' else 'parking'
        else:
            continue
        if geometry.intersects(area):
            yield prop.get('lokaal_id') or identity, surface, geometry


def choose_edge_style(line, candidate, category):
    _, _, _, _, origin, direction, rear, front, exit_point, _ = candidate
    pmin, pmax = projection_bounds_for_line(line, origin, direction)
    if pmin > front - .2:
        # An unobserved fence might obstruct a forecourt, parking or loading bay.
        if category == 'business':
            return None
        return 'clippedHedge' if line.distance(exit_point) < 19 else None
    if pmax < rear + 0.75:
        return 'metalMesh' if category == 'business' else 'timber'
    return None


def projection_bounds_for_line(line, origin, direction):
    values = (np.array(line.coords) - origin) @ direction
    return float(min(values)), float(max(values))


def garden_surfaces(rows, name, candidate, available, occupied, reserve, frame):
    identity, _, building_id, building, origin, direction, rear, front, exit, wall = candidate
    source_ids = [f'BRK:{identity}', f'BAG:{building_id}']
    access_path = LineString([exit, wall])
    path = reserve.intersection(available).difference(occupied)
    if access_path.length >= 1.15 and path.area < 28:
        surface_record(rows, f'{name}:{identity}:entrance', 'path', path, 'inferred', source_ids, frame, name)
    front_yard = rectangle(origin, direction, front + .30, front + 18, -30, 30)
    planting = available.intersection(front_yard).difference(occupied.union(reserve.buffer(.16)))
    if 1.7 < planting.area < 68:
        surface_record(rows, f'{name}:{identity}:front', 'plantingBed', planting, 'inferred', source_ids,
                       frame, name, 1.7)
    opposite_left, opposite_right = projection_bounds(building, origin, np.array([-direction[1], direction[0]]))
    # Deck defaults are sized from the building frontage and occupy the first few metres beyond its rear wall.
    patio = rectangle(origin, direction, rear - 2.85, rear - .22,
                      opposite_left + .45, opposite_right - .45)
    rear_free = available.difference(occupied.union(reserve))
    patio = patio.intersection(rear_free)
    if 2.0 < patio.area < 32:
        surface_record(rows, f'{name}:{identity}:rear', 'patio', patio, 'inferred', source_ids, frame, name, 2)
    rear_yard = rectangle(origin, direction, rear - 20, rear - 2, -30, 30)
    lawn = rear_free.intersection(rear_yard).difference(patio)
    if 4 < lawn.area < 100:
        surface_record(rows, f'{name}:{identity}:rear', 'lawn', lawn, 'inferred', source_ids, frame, name, 4)


def pilot_features(directory, name, category, road, frame, clearance, base_tree, prior_hedges, prior_fences,
                   photo_surfaces, audit, covered_parcels):
    raw_grounds = [row for suffix in ('begroeidterreindeel', 'onbegroeidterreindeel')
                   for row in surveyed_ground(read_shapes(directory / f'{name}-{suffix}.geojson'), suffix, category,
                                              road.buffer(65))]
    ground_index = STRtree([row[2] for row in raw_grounds])
    rows, inference_access, candidates = [], [], {}
    bag_file = directory / f'{name}-pand.geojson'
    bag_shapes = list(read_shapes(bag_file))
    land_parcels = parcel_candidates(read_shapes(directory / f'{name}-perceel.geojson'), bag_shapes, road, category)
    for candidate in land_parcels:
        identity, parcel, building_id, building, origin, direction, rear, front, exit, wall = candidate
        if identity in candidates:
            continue
        candidates[identity] = candidate
        access_path = LineString([exit, wall])
        base_clear = local_union(clearance, parcel, 1).buffer(.15)
        free = parcel.buffer(-.2).difference(base_clear)
        available = free.difference(building.buffer(.12))
        source_ids = [f'BRK:{identity}', f'BAG:{building_id}']
        traced = local_union(photo_surfaces, parcel)
        observed_areas = [] if traced.is_empty else [traced]
        for i in sorted(ground_index.query(parcel, predicate='intersects')):
            mapped_id, surface, geometry = raw_grounds[i]
            keep = geometry.intersection(available).difference(traced)
            if keep.area < 2.3:
                continue
            surface_record(rows, f'{name}:{identity}:bgt:{mapped_id}', surface, keep, 'observed',
                           [*source_ids, f'BGT:{mapped_id}'], frame, name)
            observed_areas.append(keep)
        occupied = union_all(observed_areas)
        reserve = access_path.buffer(.65 if category == 'residential' else 3.6, cap_style='square')
        inference_access.append(reserve)
        if category == 'residential':
            garden_surfaces(rows, name, candidate, available, occupied, reserve, frame)

    covered_parcels.update(candidates)

    access_index = STRtree(inference_access)
    accepted = set()
    for _, prop, geometry in read_shapes(directory / f'{name}-kadastralegrens.geojson'):
        identity = prop['identificatie_lokaal_id']
        quality = prop.get('classificatie_kwaliteit_waarde')
        if (prop.get('status_historie_waarde') != 'Geldig' or prop.get('type_grens_waarde') != 'Definitief'
                or quality not in {'B', 'C', 'D', 'E'} or identity in accepted):
            continue
        neighbours = [candidates[parcel] for direction in ('links', 'rechts')
                      if (parcel := prop.get(f'perceel_{direction}_identificatie_lokaal_id')) in candidates]
        if not neighbours:
            continue
        accepted.add(identity)
        cuts = []
        for candidate in neighbours:
            _, _, _, _, origin, direction, rear, front, _, _ = candidate
            cuts.extend(rectangle(origin, direction, value - .035, value + .035, -120, 120)
                        for value in (rear + .65, front - .12))
        for i, line in enumerate(stable_lines(geometry.difference(union_all(cuts)), 1.2)):
            styles = [choose_edge_style(line, garden, category) for garden in neighbours]
            if 'clippedHedge' in styles:
                style = 'clippedHedge'
            elif not all(styles):
                continue
            else:
                style = styles[0]
            spec = feature_style(style)
            if style == 'clippedHedge':
                garden = next(candidate for candidate in neighbours if choose_edge_style(line, candidate, category) == style)
                _, parcel, *_ = garden
                inside = parcel.buffer(-.32).boundary.intersection(line.buffer(.63, cap_style='flat'))
                if not inside.is_empty:
                    line = inside
            exclusion = union_all([local_union(index, line, 1.8) for index in
                                   (clearance, access_index, base_tree, prior_fences, prior_hedges)])
            keep = line.difference(exclusion.buffer(spec['width'] / 2 + .38))
            # Structural checks recorded with the audit ensure BGT or OSM access has priority over inferred width.
            for j, segment in enumerate(stable_lines(keep, 1.2)):
                record = to_scene_record(segment, frame)
                if not record:
                    continue
                rows.append({'id': f'parcel:{name}:brk:{identity}:{i}:{j}',
                             'sourceIds': [f'BRK:{identity}', *[f'BRK:{garden[0]}' for garden in neighbours]],
                             'boundaryQuality': quality, 'pilot': name, 'status': 'inferred',
                             'level': 0, 'collidable': False, **spec, **record})
    audit['streetFacingParcels'] = len(candidates)
    audit['consideredBoundaries'] = len(accepted)
    return rows


def tiled_shapes(directory, tiles, collection, key):
    seen = set()
    for tile in tiles:
        for identity, prop, geometry in read_shapes(directory / f'{tile}-{collection}.geojson'):
            stable_id = prop.get(key) or identity
            if stable_id not in seen:
                seen.add(stable_id)
                yield identity, prop, geometry


def parcel_use(prop):
    purposes = set((prop.get('gebruiksdoel') or '').split(','))
    units = prop.get('aantal_verblijfsobjecten') or 0
    if purposes - HOUSE_EXTRAS == {'woonfunctie'} and 1 <= units <= 2:
        return 'residential'
    if purposes & BUSINESS_USES and purposes <= BUSINESS_USES | {'overige gebruiksfunctie'}:
        return 'business'
    return None


def match_frontage(parcel, building, roads, road_index, building_index, category):
    maximum = 27 if category == 'residential' else 48
    interior = building.representative_point()
    origin = np.array(interior.coords[0])
    options = []
    for i in road_index.query(building, predicate='dwithin', distance=maximum):
        road, line = roads[i]
        if parcel.distance(line) > 14 or road['kind'] == 'secondary' and category == 'residential':
            continue
        roadside = nearest_points(line, interior)[0]
        ray = LineString([interior, roadside])
        face = building.boundary.intersection(ray)
        if face.is_empty or building.covers(roadside):
            continue
        wall = nearest_points(face, roadside)[0]
        approach = LineString([wall, roadside])
        if approach.length < 1 or local_union(building_index, approach).intersection(approach).length > .35:
            continue
        frontage = parcel.intersection(approach)
        if frontage.geom_type != 'LineString' or frontage.length < 1.4 or frontage.distance(wall) > .12:
            continue
        exit = nearest_points(frontage, roadside)[0]
        if exit.distance(roadside) > min(14, (road.get('width') or 6) / 2 + 8):
            continue
        vector = np.array(roadside.coords[0]) - origin
        direction = vector / np.linalg.norm(vector)
        options.append((approach.length, road['id'], direction, exit, wall))
    if not options:
        return None, 'no-frontage'
    options.sort(key=lambda value: value[:2])
    distance, _, direction, exit, wall = options[0]
    if any(np.dot(direction, other) < .55 for close, _, other, _, _ in options[1:]
           if close < distance + max(2.5, distance * .22)):
        return None, 'ambiguous-frontage'
    return (origin, direction, *projection_bounds(building, origin, direction), exit, wall), None


def map_parcels(directory, tiles, scene, area, frame, clearance, known_barriers, bag, covered_parcels):
    xform = partial(transform, transformation=frame.scene_to_rd, interleaved=False)
    roads = [(row, xform(LineString(DETAIL['BGT']['pairs'](row['pts'])))) for row in scene['roads']
             if row['kind'] in FRONTAGE_ROADS and row['name'] and not (row['layer'] or row['bridge'] or row['tunnel'])
             and (row['modes'][0] | row['modes'][1]) & 3 and len(row['pts']) >= 4]
    road_index = STRtree([line for _, line in roads])
    building_index = STRtree([footprint for _, _, footprint in bag])
    grounds = sorted((item for collection in ('begroeidterreindeel', 'onbegroeidterreindeel')
                      for item in surveyed_ground(tiled_shapes(directory, tiles, collection, 'lokaal_id'),
                                                  collection, 'residential', area)), key=lambda item: item[:2])
    ground_index = STRtree([geometry for _, _, geometry in grounds])
    paved_index = STRtree([geometry for _, kind, geometry in grounds if kind == 'path'])
    soft_index = STRtree([geometry for _, kind, geometry in grounds if kind != 'path'])
    candidates, access, rows, skipped = {}, [], [], Counter()
    for _, prop, parcel in tiled_shapes(directory, tiles, 'perceel', 'identificatie_lokaal_id'):
        identity = prop['identificatie_lokaal_id']
        if (identity in covered_parcels or prop.get('status_historie_waarde') != 'Geldig'
                or not 38 < parcel.area < 12500 or not area.covers(parcel)):
            continue
        polygons = list(parts(parcel, 'Polygon'))
        if len(polygons) != 1:
            continue
        parcel = polygons[0]
        hits = [(i, parcel.intersection(bag[i][2]).area) for i in building_index.query(parcel, predicate='intersects')]
        hits = sorted((hit for hit in hits if hit[1] >= 22), key=lambda hit: (-hit[1], bag[hit[0]][0]))
        if not hits:
            continue
        i, overlap = hits[0]
        building_id, category, building = bag[i]
        residential = category == 'residential'
        if (not category or overlap < building.area * .76 or
                not 24 < building.area < (245 if residential else 9000) or
                not (parcel.area < 920 if residential else parcel.area >= 180) or
                len(hits) > 1 and hits[1][1] > overlap * .42):
            skipped['mixed-shared-or-unresolved-building'] += 1
            continue
        frontage, reason = match_frontage(parcel, building, roads, road_index, building_index, category)
        if reason:
            skipped[reason] += 1
            continue
        origin, direction, rear, front, exit, wall = frontage
        candidate = (identity, parcel, building_id, building, origin, direction, rear, front, exit, wall)
        candidates[identity] = (category, candidate)
        approach = LineString([wall, exit])
        reserve = approach.buffer(.72 if residential else 4.2, cap_style='square')
        access.append(reserve)
        available = parcel.buffer(-.25).difference(local_union(clearance, parcel, 1).buffer(.19))
        if available.is_empty:
            continue
        occupied = []
        source_ids = [f'BRK:{identity}', f'BAG:{building_id}']
        for g in sorted(ground_index.query(available, predicate='intersects')):
            ground_id, kind, ground = grounds[g]
            keep = ground.intersection(available).difference(union_all(occupied))
            if keep.area < 2.3:
                continue
            occupied.append(keep)
            # The existing mapped land cover already draws larger lawns. A detailed
            # paving classification describes the surface rather than its intended use.
            if (kind != 'lawn' or keep.area < 45) and (residential or keep.area < 350):
                surface_record(rows, f'map:{identity}:bgt:{ground_id}', kind, keep, 'observed',
                               [*source_ids, f'BGT:{ground_id}'], frame, 'map')
        if residential:
            garden_surfaces(rows, 'map', candidate, available, union_all(occupied), reserve, frame)

    access_index = STRtree(access)
    boundaries = 0
    for _, prop, geometry in tiled_shapes(directory, tiles, 'kadastralegrens', 'identificatie_lokaal_id'):
        identity = prop['identificatie_lokaal_id']
        quality = prop.get('classificatie_kwaliteit_waarde')
        if (prop.get('status_historie_waarde') != 'Geldig' or prop.get('type_grens_waarde') != 'Definitief'
                or quality not in {'B', 'C', 'D', 'E'}):
            continue
        neighbours = [candidates[parcel] for side in ('links', 'rechts')
                      if (parcel := prop.get(f'perceel_{side}_identificatie_lokaal_id')) in candidates]
        if not neighbours:
            continue
        boundaries += 1
        clipped = geometry.intersection(area)
        if clipped.is_empty:
            continue
        cuts = []
        for _, candidate in neighbours:
            _, _, _, _, origin, direction, rear, front, _, _ = candidate
            cuts.extend(rectangle(origin, direction, at - .045, at + .045, -140, 140)
                        for at in (rear + .65, front - .12))
        for i, line in enumerate(stable_lines(clipped.difference(union_all(cuts)), 1.5)):
            styles = [choose_edge_style(line, candidate, category) for category, candidate in neighbours]
            style = styles[0]
            if not style or any(other != style for other in styles):
                continue
            if style == 'clippedHedge':
                _, candidate = neighbours[0]
                direction = candidate[5]
                span = np.array(line.coords[-1]) - np.array(line.coords[0])
                # Keep low front hedges across the frontage, leaving the side access open.
                if abs(span @ direction) > np.linalg.norm(span) * .57:
                    continue
                line = candidate[1].buffer(-.36).boundary.intersection(line.buffer(.68, cap_style='flat'))
            elif len(neighbours) == 1 and style == 'metalMesh':
                _, candidate = neighbours[0]
                # Require mapped soft ground on isolated business boundaries. A
                # legal boundary through a forecourt is insufficient evidence.
                if local_union(soft_index, line, .65).buffer(.35).intersection(line).length < line.length * .6:
                    continue
            spec = feature_style(style)
            mask = union_all([local_union(index, line, 1.7)
                              for index in (clearance, known_barriers, access_index, paved_index)])
            keep = line.difference(mask.buffer(spec['width'] / 2 + .36))
            for j, segment in enumerate(stable_lines(keep, 1.5)):
                record = to_scene_record(segment, frame)
                if record:
                    rows.append({'id': f'parcel:map:brk:{identity}:{i}:{j}', 'pilot': 'map',
                                 'sourceIds': [f'BRK:{identity}', *[f'BRK:{n[1][0]}' for n in neighbours]],
                                 'boundaryQuality': quality, 'status': 'inferred', 'level': 0, 'collidable': False,
                                 **spec, **record})
    return rows, {'streetFacingParcels': dict(Counter(row[0] for row in candidates.values())),
                  'consideredBoundaries': boundaries, 'skipped': dict(skipped),
                  'featureCounts': dict(Counter(f"{row.get('surface', row['type'])}/{row['status']}" for row in rows))}


def imagery_features(file, areas, frame, clearance, existing, audit):
    if not file.exists():
        return []
    doc = json.loads(file.read_bytes())
    if doc.get('version') != 1:
        raise ValueError('Unrecognized parcel observation format')
    project = partial(to_rd, crs=source_crs(doc), axis_order='xy')
    rows = []
    for entry in doc['features']:
        pilot = entry['pilot']
        geom = make_valid(transform(shape(entry['geometry']), project, interleaved=False))
        geom = geom.intersection(areas[pilot])
        negative = local_union(clearance, geom, 1).buffer(.25)
        if 'surface' in entry:
            count = len(rows)
            surface_record(rows, f"imagery:{entry['id']}", entry['surface'], geom.difference(negative),
                           'observed', [f"PDOK:{entry['layer']}:{entry['id']}"], frame, pilot)
            if len(rows) == count:
                audit.append({'id': entry['id'], 'reason': 'photo-surface-covered-by-reserved-ground'})
            continue
        style = feature_style(entry['style'])
        negative = negative.union(local_union(existing, geom, 1).buffer(.85))
        line = geom.difference(negative.buffer(style['width'] / 2))
        if line.length < .9:
            audit.append({'id': entry['id'], 'reason': 'photo-trace-matches-existing-geometry-or-clearance'})
        for i, segment in enumerate(stable_lines(line, .9)):
            record = to_scene_record(segment, frame)
            if record:
                rows.append({'id': f"parcel:imagery:{entry['id']}:{i}", 'pilot': pilot, 'status': 'observed',
                             'sourceIds': [f"PDOK:{entry['layer']}:{entry['id']}"], 'level': 0,
                             'collidable': style['type'] == 'fence', **style, **record})
    return rows



def check_placements(rows, xform, clearance):
    maximum = 0
    for row in rows:
        # Replacement geometry uses the original surveyed alignment and previously audited clearances.
        if row['id'].startswith('parcel:bgt:'):
            continue
        geometry = xform(scene_shape(row))
        if row['type'] in ('fence', 'hedge'):
            geometry = geometry.buffer(row['width'] / 2, cap_style='flat')
        overlap = geometry.intersection(local_union(clearance, geometry)).area
        if overlap > .015:
            raise ValueError(f"{row['id']} covers {overlap:.3f} m² of reserved geometry after rounding")
        maximum = max(maximum, overlap)
    return round(maximum, 4)


def check_held_out(observations, rows, xform):
    if not observations.exists():
        return []
    document = json.loads(observations.read_bytes())
    inferred = [(row, xform(scene_shape(row))) for row in rows
                if row['type'] == 'parcelSurface' and row['status'] == 'inferred']
    results = []
    for probe in document.get('holdout', ()):
        geometry = shape(probe['geometry'])
        matching = union_all([area for row, area in inferred if row.get('surface') == probe['surface']
                              and row.get('pilot') == probe['pilot']])
        overlap = matching.intersection(geometry).area
        results.append({'id': probe['id'], 'surface': probe['surface'],
                        'referenceSquareMetres': round(geometry.area, 2),
                        'coveredSquareMetres': round(overlap, 2),
                        'coverage': round(overlap / geometry.area, 3),
                        'notes': probe['notes']})
    return results


def bake(directory, scene, frame, day, observations, pilots, tiles):
    xform = partial(transform, transformation=frame.scene_to_rd, interleaved=False)
    bounds = box(*scene['meta']['bounds'])
    area = xform(bounds.segmentize(125))
    roads, _, boarding, civil, _, _, _, buildings = DETAIL['build_evidence'](scene, bounds)
    route_space = [xform(shape) for _, level, _, shape in roads if level == 0]
    route_space.extend(xform(shape) for _, _, shape in boarding)
    route_space.extend(xform(shape) for level, shape in civil if level == 0)
    route_space.extend(xform(shape) for shape in buildings.geometries)
    route_space.extend(xform(LineString(DETAIL['BGT']['pairs'](rail['pts'])).buffer(2.25))
                       for rail in scene['railways'] if len(rail['pts']) >= 4 and not rail.get('layer'))
    route_space.extend(xform(flat_polygon(row['ring'], row.get('holes', ()))) for row in scene['water'])
    for asset in ('ede-road-surfaces.json.gz', 'ede-corridor-paving.json.gz'):
        for surface in read_packed(asset)['surfaces']:
            if surface['layer'] or surface['function'] in {'berm', 'verkeerseiland'}:
                continue
            route_space.extend(xform(flat_polygon(outer, holes)) for outer, *holes in surface['polygons'])
    for key in ('squares', 'parks'):
        route_space.extend(xform(flat_polygon(land['ring'], land.get('holes', ())))
                           for land in scene[key] if key == 'squares' or land['kind'] in {'playground', 'pitch', 'cemetery'})
    bag = [(prop['identificatie'], parcel_use(prop), footprint)
           for _, prop, geometry in tiled_shapes(directory, tiles, 'pand', 'identificatie') if valid_bag(prop)
           for footprint in parts(geometry, 'Polygon') if area.intersects(footprint)]
    route_space.extend(geometry for _, _, geometry in bag)
    osm = json.loads((directory / 'osm.json').read_bytes())
    access, barriers = access_geometry(osm, area)
    clearance = STRtree([geometry for geometry in route_space + access if not geometry.is_empty])
    bgt_asset = read_packed('ede-bgt-detail.json.gz')
    base = [({**feature, 'source': source}, xform(scene_shape(feature)))
            for source, source_asset in (('bgt', bgt_asset), ('1gis', read_packed('ede-1gis-detail.json.gz')))
            for feature in source_asset['features'] if feature['type'] in ('hedge', 'fence') and not feature.get('level')
            and (feature.get('points') or feature.get('polygon'))]
    existing_tree = STRtree([shape for _, shape in base])
    review = []
    rows, replaces = import_barriers(barriers, base, existing_tree, frame, area, clearance, review)
    present = [xform(scene_shape(row)) for row in rows]
    areas = {name: road.buffer(58, cap_style='square') for name, (_, road) in pilots.items()}
    photo_rows = imagery_features(observations, areas, frame, clearance,
                                  STRtree([*existing_tree.geometries, *present]), review)
    rows.extend(photo_rows)
    present.extend(xform(scene_shape(row)) for row in photo_rows if row['type'] in ('fence', 'hedge'))
    existing_barriers = STRtree([*existing_tree.geometries, *present])
    photo_surfaces = STRtree([xform(scene_shape(row)) for row in photo_rows if row['type'] == 'parcelSurface'])
    prior_hedges, prior_fences = [], []
    pilot_stats, covered_parcels = {}, set()
    for name, (category, road) in pilots.items():
        pilot_stats[name] = {}
        additions = pilot_features(directory, name, category, road, frame, clearance, existing_barriers,
                                   STRtree(prior_hedges), STRtree(prior_fences), photo_surfaces, pilot_stats[name], covered_parcels)
        rows.extend(additions)
        for row in additions:
            if row['type'] == 'hedge':
                prior_hedges.append(xform(scene_shape(row)))
            elif row['type'] == 'fence':
                prior_fences.append(xform(scene_shape(row)))
        pilot_stats[name]['featureCounts'] = dict(Counter(f"{row.get('surface', row['type'])}/{row['status']}"
            for row in [*additions, *(row for row in photo_rows if row['pilot'] == name)]))
    additions, map_stats = map_parcels(directory, tiles, scene, area, frame, clearance,
                                      STRtree([*existing_barriers.geometries, *prior_hedges, *prior_fences]),
                                      bag, covered_parcels)
    rows.extend(additions)
    ids = {row['id'] for row in rows}
    if len(ids) != len(rows) or not all(f'parcel:bgt:{identity}' in ids for identity in replaces):
        raise ValueError('Parcel detail is not uniquely keyed or is missing a BGT replacement')
    if any(row.get('collidable') for row in rows if row['status'] == 'inferred'):
        raise ValueError('Inferred parcel detail must never block routing')
    report = {
        'date': day, 'frame': 'RD New → Oude Kerk', 'sources': SOURCES,
        'osmSnapshotDates': osm['sourceDates'], 'shippedBgtSnapshotDate': bgt_asset.get('date'),
        'activeOsmBarriers': len(barriers), 'activeOsmAccessGeometries': len(access),
        'bgtReplacements': sorted(replaces), 'photoTraceCount': len(photo_rows),
        'largestReservedSurfaceOverlapM2': check_placements(rows, xform, clearance),
        'heldOutAerialChecks': check_held_out(observations, rows, xform),
        'counts': dict(Counter(f"{row.get('surface', row['type'])}/{row['status']}" for row in rows)),
        'pilots': pilot_stats,
        'map': {**map_stats, 'sceneBounds': scene['meta']['bounds'], 'snapshotTiles': len(tiles),
                'outsideOriginalTown': sum(not box(*scene['meta']['baseBounds']).covers(scene_shape(row))
                                           for row in rows)},
        'reviewCounts': dict(Counter(row['reason'] for row in review)), 'review': review,
    }
    return {'version': 1, 'date': day, 'features': rows, 'replaces': sorted(replaces)}, report


def write_parcel_assets(output, tile_directory, asset):
    cells, static = {}, []
    size_metres = 70
    for row in asset['features']:
        if row.get('pilot') != 'map':
            static.append(row)
            continue
        x0, z0, x1, z1 = scene_shape(row).bounds
        cell = (int(((x0 + x1) / 2) // size_metres), int(((z0 + z1) / 2) // size_metres))
        cells.setdefault(cell, []).append((row, (x0, z0, x1, z1)))

    def tile_data(tile, entries):
        rows, extents = zip(*entries)
        west, north, east, south = zip(*extents)
        bounds = [min(west), min(north), max(east), max(south)]
        return {'id': tile, 'bounds': bounds, 'count': len(rows)}, [row for row in rows]

    tile_directory.mkdir(parents=True, exist_ok=True)
    previous = json.loads(gzip.decompress(output.read_bytes())).get('tiles', []) if output.exists() else []
    index, size = [], 0
    for (x, z), entries in sorted(cells.items()):
        tile = f'{x}_{z}'
        item, features = tile_data(tile, entries)
        path = tile_directory / f'{tile}.json.gz'
        write_json(path, {'version': 1, 'features': features})
        index.append(item)
        size += path.stat().st_size
    active = {item['id'] for item in index}
    for item in previous:
        tile = item['id']
        if tile not in active and tile.replace('_', '').replace('-', '').isdigit():
            (tile_directory / f'{tile}.json.gz').unlink(missing_ok=True)
    write_json(output, {**asset, 'features': static, 'tiles': index})
    return size, len(index)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshot', type=Path)
    parser.add_argument('--date', default=date.today().isoformat(),
                        help='Snapshot date; BRK and BAG are live on fetch and then cached')
    parser.add_argument('--fetch', action='store_true')
    parser.add_argument('--osm', type=Path, nargs='+', help='dated Gelderland and Utrecht OSM province extracts')
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/ede-parcel-detail.json.gz')
    parser.add_argument('--tiles', type=Path, help='directory for streamed geometry, defaults to ede-parcel-tiles beside the output')
    parser.add_argument('--report', type=Path, default=ROOT / 'tools/data/ede-parcel-detail.review.json')
    parser.add_argument('--observations', type=Path, default=ROOT / 'tools/data/ede-parcel-observations.json')
    arguments = parser.parse_args()
    scene = load_scene()
    frame = Frame(scene['meta']['lonLatAffine'])
    corridors = read_packed('ede-corridors-v1.json.gz')
    for key in ('buildings', 'roads', 'railways', 'water', 'parks', 'squares', 'trees'):
        scene[key].extend(corridors[key])
    scene['activeGraph']['nodes'].extend(corridors['activeGraph']['nodes'])
    scene['activeGraph']['links'].extend(corridors['activeGraph']['links'])
    scene['meta']['baseBounds'] = scene['meta']['bounds']
    scene['meta']['bounds'] = corridors['bounds']
    tiles = dict(snapshot_tiles(scene, frame))
    roads = {row['id']: row for row in scene['roads']}
    pilots = {place: (category, transform(LineString(DETAIL['BGT']['pairs'](roads[identity]['pts'])),
                                          frame.scene_to_rd, interleaved=False))
              for place, (category, identity) in PILOTS.items()}
    if arguments.fetch or arguments.osm:
        arguments.snapshot.mkdir(parents=True, exist_ok=True)
    if arguments.fetch:
        pilot_tiles = {name: transform(road.buffer(58, cap_style='square'), frame.rd_to_scene,
                                       interleaved=False).bounds for name, (_, road) in pilots.items()}
        fetch_layers(arguments.snapshot, {**pilot_tiles, **tiles}.items(), frame, arguments.date)
        fetch_review_images(arguments.snapshot)
    extract_osm(arguments.snapshot, arguments.osm, frame.geographic_bounds(scene['meta']['bounds']))
    asset, report = bake(arguments.snapshot, scene, frame, arguments.date, arguments.observations, pilots, tiles)
    tile_directory = arguments.tiles or arguments.output.parent / 'ede-parcel-tiles'
    size, count = write_parcel_assets(arguments.output, tile_directory, asset)
    report['assetBytes'] = arguments.output.stat().st_size
    report['streamedTileBytes'] = size
    report['streamedTileCount'] = count
    report['imageryReviewed'] = json.loads(arguments.observations.read_bytes()).get('imagery', []) \
        if arguments.observations.exists() else []
    write_json(arguments.report, report)
    print(f"{len(asset['features'])} placements, {report['assetBytes']} initial bytes and {size} streamed bytes")
    print(json.dumps({key: report[key] for key in ('counts', 'pilots', 'map', 'reviewCounts')}, indent=2))


if __name__ == '__main__':
    main()
