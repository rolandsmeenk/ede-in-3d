#!/usr/bin/env python3
"""Bake mapped barriers and the Bemmelsewaard and Kelvinstraat parcel pilots."""

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


def fetch_layers(directory, pilots, frame, day):
    jobs = []
    for pilot, (_, road) in pilots.items():
        area = road.buffer(58, cap_style='square')
        bounds = transform(area, frame.rd_to_scene, interleaved=False).bounds
        bbox = ','.join(f'{n:.8f}' for n in frame.geographic_bounds(bounds))
        for service, names in (
            (BRK, ('perceel', 'kadastralegrens')),
            (BAG, ('pand',)),
            (BGT, ('begroeidterreindeel', 'onbegroeidterreindeel')),
        ):
            for name in names:
                params = {'bbox': bbox, 'crs': RD_URI, 'f': 'json', 'limit': 1000}
                if service == BGT:
                    params['datetime'] = f'{day}T00:00:00Z'
                path = directory / f'{pilot}-{name}.geojson'
                jobs.append((path, f'{service}/{name}/items?{urlencode(params)}'))

    def fetch_one(job):
        path, initial_url = job
        if path.exists():
            return
        url, seen, features = initial_url, set(), []
        while url:
            if url in seen:
                raise ValueError(f'Repeated page for {path.name}')
            seen.add(url)
            page = json.loads(request(url))
            features.extend(page['features'])
            url = next((row['href'] for row in page.get('links', ()) if row['rel'] == 'next'), None)
        write_json(path, {'type': 'FeatureCollection', 'horizontalCrs': RD_URI, 'features': features})
        print(f'{path.name}: {len(features)}', flush=True)

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(fetch_one, jobs))


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
    if path.exists() and not paths:
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
    write_json(path, {'sourceDates': dates, 'elements': dict(sorted(elements.items()))})
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
                        replacement['width'] = measured_dimension(tags.get('width'), known['width'], .05, 4)
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


def local_observed_surfaces(path, file, category, area):
    shapes = []
    for identity, prop, geometry in read_shapes(path / file):
        if (prop.get('status') != 'bestaand' or prop.get('eind_registratie') or
                prop.get('plus_status') in {'plan', 'historie'} or prop.get('relatieve_hoogteligging') not in (None, 0)):
            continue
        land_class = DETAIL['land_class'](file.split('-')[-1].split('.')[0], prop)
        if land_class == 'grass':
            surface = 'lawn'
        elif land_class == 'plantingBed':
            surface = 'plantingBed'
        elif prop.get('plus_fysiek_voorkomen') in ('tegels', 'gebakken klinkers', 'betonstraatstenen', 'grasklinkers'):
            # Pavers establish a ground material, not whether a patio is private parking.
            surface = 'path' if category == 'residential' else 'parking'
        else:
            continue
        if geometry.intersects(area):
            shapes.append((prop.get('lokaal_id') or identity, surface, geometry))
    return shapes


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


def pilot_features(directory, name, category, road, frame, clearance, base_tree, prior_hedges, prior_fences,
                   photo_surfaces, audit):
    raw_grounds = [row for name_suffix in ('begroeidterreindeel', 'onbegroeidterreindeel')
                  for row in local_observed_surfaces(directory, f'{name}-{name_suffix}.geojson', category, road.buffer(65))]
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
            # Keep the whole inferred path clear through the projected front edge, including a gate gap.
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


def bake(directory, scene, frame, day, observations, pilots):
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
    for surface in read_packed('ede-road-surfaces.json.gz')['surfaces']:
        if surface['layer'] or surface['function'] in {'berm', 'verkeerseiland'}:
            continue
        route_space.extend(xform(flat_polygon(outer, holes)) for outer, *holes in surface['polygons'])

    # Use BAG as additional obstacle evidence where it contains newer or unmapped walk-in buildings.
    for pilot in pilots:
        route_space.extend(geometry for _, prop, geometry in read_shapes(directory / f'{pilot}-pand.geojson')
                           if valid_bag(prop))
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
    pilot_stats = {}
    for name, (category, road) in pilots.items():
        pilot_stats[name] = {}
        additions = pilot_features(directory, name, category, road, frame, clearance, existing_barriers,
                                   STRtree(prior_hedges), STRtree(prior_fences), photo_surfaces, pilot_stats[name])
        rows.extend(additions)
        for row in additions:
            if row['type'] == 'hedge':
                prior_hedges.append(xform(scene_shape(row)))
            elif row['type'] == 'fence':
                prior_fences.append(xform(scene_shape(row)))
        pilot_stats[name]['featureCounts'] = dict(Counter(f"{row.get('surface', row['type'])}/{row['status']}"
            for row in [*additions, *(row for row in photo_rows if row['pilot'] == name)]))
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
        'reviewCounts': dict(Counter(row['reason'] for row in review)), 'review': review,
    }
    return {'version': 1, 'date': day, 'features': rows, 'replaces': sorted(replaces)}, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshot', type=Path)
    parser.add_argument('--date', default=date.today().isoformat(),
                        help='Snapshot date; BRK and BAG are live on fetch and then cached')
    parser.add_argument('--fetch', action='store_true')
    parser.add_argument('--osm', type=Path, nargs='+', help='dated Gelderland and Utrecht OSM province extracts')
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/ede-parcel-detail.json.gz')
    parser.add_argument('--report', type=Path, default=ROOT / 'tools/data/ede-parcel-detail.review.json')
    parser.add_argument('--observations', type=Path, default=ROOT / 'tools/data/ede-parcel-observations.json')
    arguments = parser.parse_args()
    scene = load_scene()
    frame = Frame(scene['meta']['lonLatAffine'])
    roads = {row['id']: row for row in scene['roads']}
    pilots = {place: (category, transform(LineString(DETAIL['BGT']['pairs'](roads[identity]['pts'])),
                                          frame.scene_to_rd, interleaved=False))
              for place, (category, identity) in PILOTS.items()}
    if arguments.fetch or arguments.osm:
        arguments.snapshot.mkdir(parents=True, exist_ok=True)
    if arguments.fetch:
        fetch_layers(arguments.snapshot, pilots, frame, arguments.date)
        fetch_review_images(arguments.snapshot)
    extract_osm(arguments.snapshot, arguments.osm, frame.geographic_bounds(scene['meta']['bounds']))
    asset, report = bake(arguments.snapshot, scene, frame, arguments.date, arguments.observations, pilots)
    write_json(arguments.output, asset)
    report['assetBytes'] = arguments.output.stat().st_size
    report['imageryReviewed'] = json.loads(arguments.observations.read_bytes()).get('imagery', []) \
        if arguments.observations.exists() else []
    write_json(arguments.report, report)
    print(f"{len(asset['features'])} placements, {report['assetBytes']} compressed bytes")
    print(json.dumps({key: report[key] for key in ('counts', 'pilots', 'reviewCounts')}, indent=2))


if __name__ == '__main__':
    main()
