#!/usr/bin/env python3
"""Bake Ede parking from checked-in BGT surfaces, clipped WKD WFS and OSM PBF.

Requires Shapely 2.1+ and pyosmium. See data/ede-parking-sources.md for inputs.
"""

import argparse
from collections import Counter, defaultdict, deque
from dataclasses import dataclass
import gzip
import json
import math
from pathlib import Path
import re
import runpy
import subprocess
import unicodedata

import osmium
from shapely import STRtree, from_wkb, make_valid, transform, union_all
from shapely.affinity import rotate, translate
from shapely.geometry import LineString, Point, Polygon, box

ROOT = Path(__file__).resolve().parents[1]
GRADE = runpy.run_path(str(ROOT / 'tools/build-ede-grade.py'))
MOTOR = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified',
         'living_street', 'service', 'road', 'track'}
MOTOR |= {kind + '_link' for kind in ('motorway', 'trunk', 'primary', 'secondary', 'tertiary')}
NO_ROADSIDE = {'motorway', 'motorway_link', 'trunk', 'trunk_link', 'busway'}
NONSTANDARD = {'private', 'no', 'customers', 'delivery', 'destination', 'employees', 'disabled'}
GARAGE = {'multi-storey', 'underground', 'garage_boxes', 'rooftop', 'carports'}
ANGLE = {'parallel': 0, 'diagonal': 45, 'perpendicular': 90}
BODY_LENGTH = 4.65
BODY_WIDTH = 1.96
KUIPERPLEIN = 'w491922182'
KUIPERPLEIN_ENTRANCE = 'w1055118985'
KUIPERPLEIN_JUNCTION = 'w1337350654'


def read(path):
    if path.suffix == '.gz':
        with gzip.open(path, 'rt') as handle:
            return json.load(handle)
    return json.loads(path.read_bytes())


def pairs(flat):
    return zip(flat[::2], flat[1::2])


def parts(geometry):
    if geometry.geom_type == 'Polygon' and geometry.area >= 1:
        yield geometry
    elif hasattr(geometry, 'geoms'):
        for part in geometry.geoms:
            yield from parts(part)


def access(tags, default='public'):
    value = tags.get('motorcar') or tags.get('motor_vehicle') or tags.get('access')
    if value in {'permit', 'residents', 'residential'}:
        return 'permit'
    if value in NONSTANDARD or tags.get('parking:restriction') in {'no_parking', 'no_stopping'}:
        return 'private'
    if tags.get('fee') in {'yes', 'charge'}:
        return 'paid'
    return default


def layer(tags):
    try:
        return int(tags.get('layer', '0'))
    except ValueError:
        return 0


def slug(text):
    return re.sub('[^a-z0-9]+', '-', unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode().lower()).strip('-')


def parking_tags(tags, side):
    parking = {}
    for field in ('orientation', 'fee', 'access', 'restriction'):
        for which in (side, 'both'):
            value = tags.get(f'parking:{which}:{field}')
            if value:
                parking['parking:restriction' if field == 'restriction' else field] = value
                break
    for which in (side, 'both'):
        place = tags.get(f'parking:{which}') or tags.get(f'parking:lane:{which}')
        condition = tags.get(f'parking:condition:{which}')
        if place or condition:
            if place in ANGLE:
                parking.setdefault('orientation', place)
            if place in {'no', 'no_parking', 'no_stopping'} or condition in {'no', 'no_parking', 'no_stopping'}:
                parking['parking:restriction'] = 'no_parking'
            if condition in {'ticket', 'paid'}:
                parking.setdefault('fee', 'yes')
            if condition in {'residents', 'permit'}:
                parking.setdefault('access', 'permit')
            break
    return parking


@dataclass(frozen=True)
class Feature:
    id: str
    shape: object
    layer: int = 0
    tags: dict = None


class Spatial:
    def __init__(self, records):
        self.records = records
        self.tree = STRtree([record.shape for record in records])

    def nearby(self, geometry, distance=0, level=None):
        hits = self.tree.query(geometry, predicate='dwithin', distance=distance)
        for index in sorted(hits):
            record = self.records[index]
            if level is None or record.layer == level:
                yield record


def osm_snapshot(paths, area, geo, project):
    western, southern, eastern, northern = geo
    roads, lots, individual, points, releases = {}, {}, {}, {}, {}
    factory = osmium.geom.WKBFactory()

    class Extract(osmium.SimpleHandler):
        def node(self, node):
            tags = node.tags
            if not (tags.get('highway') in {'crossing', 'bus_stop'} or tags.get('public_transport') == 'stop_position'
                    or tags.get('amenity') == 'parking_space'):
                return
            lon, lat = node.location.lon, node.location.lat
            if western <= lon <= eastern and southern <= lat <= northern:
                key = f'n{node.id}'
                points[key] = Feature(key, Point(project(lon, lat)), layer(tags), dict(tags))

        def way(self, way):
            tags = way.tags
            highway = tags.get('highway', '')
            if highway not in MOTOR | {'cycleway', 'footway', 'pedestrian', 'path', 'busway'}:
                return
            nodes = [(node.ref, node.lon, node.lat) for node in way.nodes if node.location.valid()]
            if len(nodes) < 2 or len(nodes) != len(way.nodes):
                return
            ids, lons, lats = zip(*nodes)
            if max(lons) < western or min(lons) > eastern or max(lats) < southern or min(lats) > northern:
                return
            geometry = LineString([project(lon, lat) for lon, lat in zip(lons, lats)])
            if not geometry.intersects(area) or geometry.length < .1:
                return
            key = f'w{way.id}'
            roads[key] = Feature(key, geometry, layer(tags), {**dict(tags), 'nodeIds': ids})

        def area(self, osm_area):
            amenity = osm_area.tags.get('amenity')
            if amenity not in {'parking', 'parking_space'}:
                return
            geometry = from_wkb(bytes.fromhex(factory.create_multipolygon(osm_area)))
            west, south, east, north = geometry.bounds
            if east < western or west > eastern or north < southern or south > northern:
                return
            geometry = make_valid(transform(geometry, project, interleaved=False)).intersection(area)
            if geometry.is_empty:
                return
            key = ('w' if osm_area.from_way() else 'r') + str(osm_area.orig_id())
            destination = lots if amenity == 'parking' else individual
            destination[key] = Feature(key, geometry, layer(osm_area.tags), dict(osm_area.tags))

    for path in paths:
        with osmium.io.Reader(str(path)) as reader:
            releases[path.name] = reader.header().get('osmosis_replication_timestamp') or 'unspecified'
        Extract().apply_file(str(path), locations=True)
    return roads, lots, individual, points, releases


def features_from_bgt(asset):
    authoritative, obstacles = [], []
    for row in sorted(asset['surfaces'], key=lambda row: row['id']):
        kind = row['function']
        polygons = [Polygon(list(pairs(exterior)), [list(pairs(hole)) for hole in holes]) for exterior, *holes in row['polygons']]
        for index, polygon in enumerate(polygons):
            key = row['id'] + (f'-{index + 1}' if index else '')
            feature = Feature(key, make_valid(polygon), row['layer'], {'function': kind})
            if kind == 'parkeervlak':
                authoritative.append(feature)
            elif kind.startswith('rijbaan ') or kind in {
                    'inrit', 'fietspad', 'voetpad', 'voetpad op trap', 'voetgangersgebied', 'ov-baan',
                    'verbindingsweg', 'verkeersdrempel', 'woonerf', 'overweg', 'verkeerseiland'}:
                obstacles.append(feature)
    return authoritative, obstacles


def read_wkd(asset, project):
    if asset['numberReturned'] != len(asset['features']) or asset['numberMatched'] != len(asset['features']):
        raise ValueError('WKD WFS response is paginated or incomplete')
    records = []
    for item in asset['features']:
        data = item['properties']
        if not item.get('geometry') or data['zijde'] not in {'links', 'rechts'} or data['oppervlak'] <= 0:
            continue
        line = LineString([project(*p) for p in item['geometry']['coordinates']])
        if line.length >= 1:
            records.append(Feature(item['id'], line, 0, data))
    if not records:
        raise ValueError('No usable WKD parking extents')
    return Spatial(records)


def tangent(line, station):
    a = line.interpolate(max(0, station - 1))
    b = line.interpolate(min(line.length, station + 1))
    return math.atan2(b.y - a.y, b.x - a.x)


def axis_of(shape):
    ring = list(shape.minimum_rotated_rectangle.exterior.coords)
    return max((math.dist(a, b), math.atan2(b[1] - a[1], b[0] - a[0]))
               for a, b in zip(ring, ring[1:]))[1] % math.pi


def footprint(x, z, angle, length=BODY_LENGTH, width=BODY_WIDTH):
    rectangle = box(x - length / 2, z - width / 2, x + length / 2, z + width / 2)
    return rotate(rectangle, angle, origin=(x, z), use_radians=True)


def find_wkd(wkd, road, point, side, road_angle):
    if road.layer:
        return None
    candidates = []
    for extent in wkd.nearby(point, 4.6, road.layer):
        along = extent.shape.project(point)
        cross = extent.shape.interpolate(along)
        if cross.distance(point) > 4 or not .10 <= along <= extent.shape.length - .10:
            continue
        alignment = math.cos(tangent(extent.shape, along) - road_angle)
        if abs(alignment) < .90:
            continue
        expected = 'rechts' if ((side == 'right') == (alignment > 0)) else 'links'
        if extent.tags['zijde'] == expected:
            candidates.append((cross.distance(point), extent.id))
    return min(candidates)[1] if candidates else None


def nearby_road(roads, wkd, point, row_axis, level, lot=None):
    matches = []
    for road in roads.nearby(point, 11, level):
        tags = road.tags
        if tags.get('highway') in NO_ROADSIDE or tags.get('service') == 'driveway':
            continue
        if lot and lot.tags.get('parking') != 'street_side' and not lot.shape.buffer(1.5).intersects(road.shape):
            continue
        along = road.shape.project(point)
        if not .20 <= along <= road.shape.length - .20:
            continue
        curb = road.shape.interpolate(along)
        angle = tangent(road.shape, along)
        if row_axis is not None and abs(math.cos(angle - row_axis)) < .62:
            continue
        cross = math.cos(angle) * (point.y - curb.y) - math.sin(angle) * (point.x - curb.x)
        side = 'right' if cross > 0 else 'left'
        coverage = find_wkd(wkd, road, curb, side, angle)
        score = point.distance(curb) - (1.2 if coverage else 0) - (.7 if tags.get('service') == 'parking_aisle' else 0)
        matches.append((score, road.id, road, curb, angle, side, coverage))
    if not matches:
        return None
    result = min(matches)
    if len(matches) > 1 and any(other[0] - result[0] < .6 and abs(math.cos(other[4] - result[4])) < .72
                                for other in matches if other is not result):
        return None
    return result[2:]


def fit_rows(poly, row_axis, orientation, specific=False):
    """Try a centred packing of body rectangles along the mapped row."""
    local = rotate(poly, -row_axis, origin=(0, 0), use_radians=True)
    west, south, east, north = local.bounds
    frontage, depth = east - west, north - south
    angles = [orientation] if orientation is not None else (
        [90, 0] if depth >= 4.4 else [0])
    best = []
    buffered = local.buffer(.035)
    for angle in angles:
        rad = math.radians(angle)
        dx = abs(math.cos(rad)) * BODY_LENGTH + abs(math.sin(rad)) * BODY_WIDTH
        dz = abs(math.sin(rad)) * BODY_LENGTH + abs(math.cos(rad)) * BODY_WIDTH
        step = 5.35 if angle == 0 else 2.44 / abs(math.sin(rad))
        count = min(1 if specific else 180, max(1, math.floor((frontage - dx + .14) / step) + 1))
        if frontage + .07 < dx or depth + .07 < dz:
            continue
        # Physical parking rows have a single curb frontage. Wide plazas need aisle geometry.
        centre_x, centre_z = (west + east) / 2, (south + north) / 2
        for offset_x in (0, -step / 4, step / 4):
            for offset_z in (0, max(0, (depth - dz) / 2 - .025), min(0, (dz - depth) / 2 + .025)):
                fitted = []
                for index in range(count):
                    x = centre_x + (index - (count - 1) / 2) * step + offset_x
                    z = centre_z + offset_z
                    body = footprint(x, z, rad)
                    if buffered.covers(body):
                        point = rotate(Point(x, z), row_axis, origin=(0, 0), use_radians=True)
                        fitted.append((point, row_axis + rad, angle))
                if len(fitted) > len(best):
                    best = fitted
    return best


def area_kind(lot, road, point):
    name = (lot.tags.get('name') or '').lower() if lot else ''
    if lot and lot.id == KUIPERPLEIN:
        return 'shopping'
    if lot and (lot.tags.get('park_ride') not in {None, 'no'} or 'p+r' in name or 'p&r' in name):
        return 'station'
    if lot and (lot.tags.get('access') == 'customers' or lot.tags.get('fee') == 'yes'
                and point.distance(Point(0, 0)) < 700):
        return 'shopping'
    if road and road.tags.get('highway') in {'residential', 'living_street'}:
        return 'residential'
    return 'other'


def garage(lot):
    return lot.tags.get('parking') in GARAGE or lot.tags.get('building') == 'parking' or lot.tags.get('indoor') == 'yes'


def lot_id(lot):
    return 'kuiperplein' if lot.id == KUIPERPLEIN else 'osm-' + lot.id


def legal_service(road):
    tags = road.tags
    return (tags.get('highway') in {'service', 'residential', 'unclassified', 'living_street'}
            and tags.get('service') not in {'driveway', 'drive-through', 'emergency_access'}
            and access(tags) == 'public' and not tags.get('access:conditional')
            and not tags.get('motor_vehicle:conditional') and not tags.get('motorcar:conditional'))


def connected_aisles(lots, roads, ambient):
    result = {}
    public = [road for road in roads if legal_service(road) or road.id in ambient
              or road.id in {KUIPERPLEIN_ENTRANCE, KUIPERPLEIN_JUNCTION}]
    index = Spatial(public)
    by_node = defaultdict(list)
    for road in public:
        for node in set(road.tags['nodeIds']):
            by_node[node].append(road)

    for lot in lots:
        if not (access(lot.tags) in {'public', 'paid'} and lot.tags.get('parking') != 'street_side'):
            continue
        expanded = lot.shape.buffer(2)
        seeds = [road for road in index.nearby(expanded, level=lot.layer)
                 if road.tags.get('service') == 'parking_aisle' and road.shape.intersection(expanded).length >= 3]
        for seed in seeds:
            queue = deque([(seed, ())])
            seen = {seed.id}
            route = None
            target = None
            while queue:
                road, path = queue.popleft()
                if road.id in ambient:
                    route = path
                    target = road
                    break
                if len(path) >= 5 or road.shape.distance(lot.shape) > 32:
                    continue
                for node in road.tags['nodeIds']:
                    for neighbor in by_node[node]:
                        if neighbor.id not in seen and neighbor.layer == lot.layer:
                            seen.add(neighbor.id)
                            queue.append((neighbor, (*path, road)))
            if route is None:
                continue
            for road in route:
                oneway = road.tags.get('oneway') in {'yes', '1', 'true', '-1'}
                entry = {'id': road.id, 'areaId': lot_id(lot), 'layer': road.layer, 'oneway': oneway,
                         'pts': [round(value, 1) for point in road.shape.coords for value in point]}
                if road.id == KUIPERPLEIN_ENTRANCE:
                    entry['yield'] = True
                if road.tags.get('oneway') == '-1':
                    entry['reverse'] = True
                if road == route[-1]:
                    target_nodes = set(target.tags['nodeIds'])
                    shared = [Point(point) for node, point in zip(road.tags['nodeIds'], road.shape.coords)
                              if node in target_nodes]
                    junction = min(shared, key=lambda point: lot.shape.distance(point))
                    entry['approachWayId'] = target.id
                    entry['junction'] = [round(junction.x, 1), round(junction.y, 1)]
                key = entry['areaId'], entry['id']
                result[key] = result.get(key, {}) | entry
    return list(result.values())


def grade_profiles():
    records = []
    for site in read(ROOT / 'assets/ede-grade.json')['sites']:
        for entry in site.get('profiles', []):
            coords = entry['points']
            for a, b in zip(coords, coords[1:]):
                if a[:2] != b[:2]:
                    road = LineString((a[:2], b[:2]))
                    records.append(Feature(entry['id'], road, entry.get('layer', site.get('layer', 0)),
                                           {'a': a[2], 'b': b[2], 'ways': entry['wayIds'], 'width': entry['width']}))
    return Spatial(records)


def grade_at(profiles, terrain, point, level, way_id):
    for profile in sorted(profiles.nearby(point, 12, level), key=lambda p: p.shape.distance(point)):
        if way_id in profile.tags['ways'] and profile.shape.distance(point) <= profile.tags['width'] / 2 + 3:
            blend = profile.shape.project(point, normalized=True)
            return profile.tags['a'] + (profile.tags['b'] - profile.tags['a']) * blend
    if level == 0:
        return terrain.at((point.x, point.y)) - terrain.nap
    return None


def build(osm, wkd_path):
    scene = GRADE['load_scene']()
    scene_meta = scene['meta']
    south, west, north, east = scene_meta['geographicBounds']
    area = box(*scene_meta['bounds'])

    def project(lon, lat):
        frame = scene_meta['lonLatAffine']
        return (lon - frame['lon0']) * frame['x'][1], (lat - frame['lat0']) * frame['z'][2]

    graph = json.loads(subprocess.check_output(['node', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
                                              str(ROOT / 'tools/export-ede-traffic-graph.mjs'), '--street-features']))
    ambient = {edge['way'] for edge in graph['edges'] if edge['modes'] & 1}
    raw_roads, osm_lots, individual, points, releases = osm_snapshot(osm, area, (west, south, east, north), project)
    bgt_asset = read(ROOT / 'assets/ede-road-surfaces.json.gz')
    bgt, paving = features_from_bgt(bgt_asset)
    wkd = read_wkd(read(wkd_path), project)
    terrain = GRADE['Terrain']()
    grade = grade_profiles()
    street = read(ROOT / 'assets/ede-street-features.json.gz')
    drive_roads = [road for road in raw_roads.values() if road.tags.get('highway') in MOTOR]
    roads = Spatial(drive_roads)
    aisles = connected_aisles(sorted((lot for lot in osm_lots.values() if not garage(lot)), key=lambda lot: lot.id),
                             drive_roads, ambient)
    lot_aisles = {(aisle['areaId'], aisle['id']) for aisle in aisles}
    lots = Spatial(sorted(osm_lots.values(), key=lambda lot: (lot.shape.area, lot.id)))
    buildings = [Feature(row['id'], make_valid(Polygon(list(pairs(row['ring'])),
                                                        [list(pairs(hole)) for hole in row['holes']])))
                 for row in scene['buildings'] if not row.get('minH')]
    # Bus stops need clear usable curb length; use stop/platform points as well as NDW/OSM crossings.
    stops = {(round(stop['x'], 1), round(stop['z'], 1)) for route in read(ROOT / 'assets/ede-bus-routes.json')['variants']
             for stop in route['stops'] if stop.get('matched')}
    protected = [Feature('bus-stop', Point(*xy).buffer(12)) for xy in sorted(stops)]
    for feature in points.values():
        tags = feature.tags
        if tags.get('highway') == 'crossing':
            protected.append(Feature(feature.id, feature.shape.buffer(5), feature.layer))
        elif tags.get('highway') == 'bus_stop' or tags.get('public_transport') == 'stop_position' and tags.get('bus') == 'yes':
            protected.append(Feature(feature.id, feature.shape.buffer(12), feature.layer))
    for item in street['crossings']:
        geometry = LineString(item['ends']) if len(item.get('ends', ())) == 2 else Point(item['x'], item['z'])
        protected.append(Feature(item['id'], geometry.buffer(5), item.get('layer', 0)))
    for path in graph['paths']:
        if path['way'] in raw_roads and path.get('modes') == 8 and path.get('kind') in {'lane', 'track', 'cycleway'}:
            line = LineString((path['a'], path['b']))
            protected.append(Feature(path['way'], line.buffer(path['width'] / 2, cap_style='flat'), path['layer'],
                                     {'function': 'fietspad'}))
    for edge in graph['edges']:
        if not edge['modes'] & 7:
            continue
        line = LineString((edge['a'], edge['b']))
        if line.length < .2:
            continue
        angle = tangent(line, line.length / 2)
        for offset in edge['lanes']:
            lane = translate(line, -math.sin(angle) * offset, math.cos(angle) * offset)
            protected.append(Feature(edge['key'], lane.buffer(1.02, cap_style='flat'), edge['layer'],
                                     {'function': 'travel lane'}))
    for road in raw_roads.values():
        if road.tags.get('service') == 'driveway':
            protected.append(Feature(road.id, road.shape.buffer(1.25, cap_style='flat'), road.layer, {'function': 'inrit'}))
        elif road.tags.get('highway') in {'cycleway', 'footway'}:
            kind = 'fietspad' if road.tags['highway'] == 'cycleway' else 'voetpad'
            width = 1.00 if kind == 'fietspad' else .55
            protected.append(Feature(road.id, road.shape.buffer(width, cap_style='flat'), road.layer, {'function': kind}))
    for lot in osm_lots.values():
        if garage(lot):
            protected.append(Feature(lot.id, lot.shape, lot.layer))
    barrier = Spatial(paving + protected + buildings)
    spaces, areas = [], {}
    cells = defaultdict(list)
    stats = Counter()
    hit_wkd = set()
    bgt_index = Spatial(bgt)
    explicit = Spatial(sorted(individual.values(), key=lambda feature: feature.id))
    signs = Spatial([Feature(sign['id'], Point(sign['x'], sign['z']), sign.get('layer', 0), sign)
                     for sign in street['signs'] if not sign.get('zoneCode') and (
                         sign.get('rvvCode') in {'E6', 'E7', 'E9'} or any(
                             'opladen elektrische' in row.get('text', '').casefold()
                             for row in sign.get('supplementarySigns', [])))])

    def covered(geometry, level, exclude_paving=False):
        return [feature for feature in barrier.nearby(geometry, level=level)
                if not exclude_paving or not feature.tags or feature.tags.get('function') in {
                    'inrit', 'fietspad', 'voetpad', 'voetpad op trap', 'voetgangersgebied', 'overweg'}]

    def rules(tags):
        return {key: tags[key] for key in ('maxstay', 'opening_hours', 'fee:conditional', 'access:conditional')
                if key in tags}

    def add(feature, origin, point, angle, orientation, lot):
        geometry = footprint(point.x, point.y, angle)
        if not area.covers(geometry):
            return
        if any(item.shape.intersection(geometry).area > .06 for item in covered(geometry, feature.layer)):
            stats['obstacleRejected'] += 1
            return
        a, b = math.floor(point.x / 5), math.floor(point.y / 5)
        for i in range(a - 1, a + 2):
            for j in range(b - 1, b + 2):
                if any(item.intersection(geometry).area > .08 for item in cells[feature.layer, i, j]):
                    stats['duplicateRejected'] += 1
                    return
        match = nearby_road(roads, wkd, point, None, feature.layer, lot)
        road, curb, road_angle, side, evidence = match if match else (None, None, 0, None, None)
        tags = {**(lot.tags if lot else {}), **(feature.tags if origin != 'bgt' else {})}
        if road:
            tags = {**parking_tags(road.tags, side), **tags}
        if tags.get('parking:restriction') == 'no_parking' or tags.get('parking') in {'no', 'no_parking', 'loading'}:
            stats['restrictedRejected'] += 1
            return
        if origin == 'osm' and any(existing.shape.covers(point) for existing in bgt_index.nearby(point, level=feature.layer)):
            return
        if origin == 'bgt' and any(existing.shape.covers(point) for existing in explicit.nearby(point, level=feature.layer)):
            return
        y = grade_at(grade, terrain, point, feature.layer, road.id if road else None)
        if y is None:
            stats['unverifiedLevels'] += 1
            return

        road_access = access(road.tags) if road else 'public'
        permission = access(tags, road_access)
        for sign in signs.nearby(point, 4.8, feature.layer):
            matched_sign = road and road.id == sign.tags.get('renderWay') and geometry.buffer(.8).covers(sign.shape)
            kuiper_sign = lot and lot.id == KUIPERPLEIN and geometry.buffer(1.8).covers(sign.shape)
            if matched_sign or kuiper_sign:
                permission = 'permit' if sign.tags['rvvCode'] == 'E9' else 'private'
        if lot and (lot.tags.get('name', '').startswith('K&R') or lot.tags.get('parking') == 'kiss_and_ride'):
            permission = 'private'
        # A mapped street-side polygon can be a whole yard. A clear direct curb opening is required for routing.
        clear = False
        if road and road_access in {'public', 'paid'} and permission in {'public', 'paid'}:
            ramp = LineString((point.coords[0], curb.coords[0])).buffer(.85, cap_style='flat')
            same_lot = lot and (lot_id(lot), road.id) in lot_aisles
            connected = same_lot or road.id in ambient and (not lot or lot.tags.get('parking') == 'street_side')
            clear = bool(connected) and not any(item.shape.intersection(ramp).area > .15
                                                 for item in covered(ramp, feature.layer, exclude_paving=True))
        if road:
            relative = math.acos(abs(math.cos(angle - road_angle)))
            orientation = min((0, 45, 90), key=lambda candidate: abs(math.radians(candidate) - relative))
        if road and orientation == 0:
            road_direction = -1 if road.tags.get('oneway') == '-1' or (
                side == 'left' and road.tags.get('oneway') not in {'yes', '1', 'true'}) else 1
            if math.cos(angle - road_angle) * road_direction < 0:
                angle += math.pi
        elif curb and math.cos(angle) * (point.x - curb.x) + math.sin(angle) * (point.y - curb.y) < 0:
            angle += math.pi

        name = lot.tags.get('name') if lot else None
        street_name = road.tags.get('name') if road else None
        if lot:
            ident = lot_id(lot)
        elif street_name:
            ident = 'street-' + slug(street_name)
        else:
            ident = 'road-' + (road.id if road else feature.id)
        rec = areas.setdefault(ident, {'id': ident, 'name': name or street_name or 'Parking',
                                       'kind': area_kind(lot, road, point), 'capacity': 0,
                                       'estimatedCapacity': True, 'x': 0., 'z': 0.})
        rec['capacity'] += 1
        rec['x'] += point.x
        rec['z'] += point.y
        if lot and str(lot.tags.get('capacity', '')).isdigit():
            rec['reportedCapacity'] = int(lot.tags['capacity'])
        if evidence:
            hit_wkd.add(evidence)
        from_source = 'bgt+wkd' if origin == 'bgt' and evidence else origin
        stats[from_source] += 1
        stats[{0: 'parallel', 45: 'diagonal', -45: 'diagonal', 90: 'perpendicular'}[orientation]] += 1
        if clear:
            stats['maneuverable'] += 1
        record = {'id': f'{origin}-{feature.id}-{round(point.x * 2)}-{round(point.y * 2)}',
                  'x': round(point.x, 2), 'y': round(y, 3), 'z': round(point.y, 2),
                  'heading': round((math.pi / 2 - angle + math.pi) % math.tau - math.pi, 5),
                  'layer': feature.layer, 'wayId': road.id if road and (clear or evidence) else None,
                  'areaId': ident, 'access': permission, 'confidence': .93 if origin == 'osm-space' else
                  .88 if evidence else .77 if origin == 'bgt' else .61,
                  'source': from_source, 'maneuver': clear, 'orientation': {0: 'parallel', 90: 'perpendicular', 45: 'diagonal', -45: 'diagonal'}[orientation]}
        if street_name:
            record['street'] = street_name
        if evidence:
            record['wkdId'] = evidence
        if value := rules(tags):
            record['rules'] = value
        cells[feature.layer, a, b].append(geometry)
        spaces.append(record)

    def fit(feature, origin, known_lot=None):
        for polygon in parts(feature.shape):
            point = polygon.representative_point()
            lot = known_lot or next((lot for lot in lots.nearby(point, level=feature.layer) if lot.shape.covers(point)), None)
            if lot and garage(lot):
                continue
            if feature.tags.get('parking_space') in {'disabled', 'charging', 'motorcycle', 'loading', 'taxi'}:
                continue
            row = axis_of(polygon)
            match = nearby_road(roads, wkd, point, row, feature.layer, lot)
            tags = (lot.tags if lot else {}) | feature.tags
            hint = tags.get('orientation')
            if origin != 'osm-space' and not match and (hint in ANGLE or polygon.area <= 25):
                match = nearby_road(roads, wkd, point, None, feature.layer, lot)
                if match:
                    row = match[2] % math.pi
            if hint not in ANGLE and match:
                hint = parking_tags(match[0].tags, match[3]).get('orientation')
            orientation = ANGLE.get(hint)
            if origin == 'osm-space':
                orientation = 0
            elif match:
                _, _, road_angle, _, _ = match
                if abs(math.cos(row - road_angle)) > .93:
                    row = road_angle % math.pi
                if orientation is None:
                    # Slanted stall ends supply the two possible oblique directions.
                    for a, b in zip(polygon.exterior.coords, list(polygon.exterior.coords)[1:]):
                        if 4.2 <= math.dist(a, b) <= 6.1:
                            bend = (math.atan2(b[1] - a[1], b[0] - a[0]) - row + math.pi / 2) % math.pi - math.pi / 2
                            if .60 <= abs(bend) <= .94:
                                orientation = 45 if bend > 0 else -45
                                break

            fitted = fit_rows(polygon, row, orientation, origin == 'osm-space')
            if not fitted and orientation is None:
                fitted = fit_rows(polygon, axis_of(polygon), 0, origin == 'osm-space')
            for point, angle, relative in fitted:
                add(feature, origin, point, angle, relative, lot)

    for feature in explicit.records:
        fit(feature, 'osm-space')
    for feature in bgt:
        fit(feature, 'bgt')
    for lot in lots.records:
        if garage(lot):
            continue
        if lot.tags.get('parking') == 'street_side' or lot.tags.get('orientation') in ANGLE:
            fit(lot, 'osm', lot)
        elif len([row for row in bgt_index.nearby(lot.shape, level=lot.layer)
                  if lot.shape.covers(row.shape.representative_point())]) <= 1:
            # A mapped aisle anchors an estimate at an otherwise unmarked surface lot. Leave open centres blank.
            for aisle in roads.nearby(lot.shape, level=lot.layer):
                if aisle.tags.get('service') != 'parking_aisle':
                    continue
                margin = 3.3
                usable = lot.shape.intersection(aisle.shape.buffer(margin + 5.25, cap_style='flat'))
                usable = usable.difference(aisle.shape.buffer(margin, cap_style='flat'))
                obstructions = covered(usable, lot.layer)
                if obstructions:
                    usable = usable.difference(union_all([obstacle.shape for obstacle in obstructions]))
                fit(Feature(lot.id + '-' + aisle.id, usable, lot.layer, lot.tags), 'osm', lot)

    for rec in areas.values():
        estimated = rec['capacity']
        rec['x'], rec['z'] = round(rec['x'] / estimated, 2), round(rec['z'] / estimated, 2)
        if 'reportedCapacity' in rec:
            rec['capacity'] = rec.pop('reportedCapacity')
            rec['estimatedCapacity'] = False
        if rec['id'] == 'kuiperplein':
            rec['capacity'] = 218
            rec['estimatedCapacity'] = True
        rec['fittedSpaces'] = estimated
    spaces.sort(key=lambda item: item['id'])
    assert len(spaces) > 1000 and len(spaces) == len({space['id'] for space in spaces})
    assert 'kuiperplein' in areas and hit_wkd and any(item['maneuver'] for item in spaces)
    assert any((road['areaId'], road['id'], road.get('approachWayId')) ==
               ('kuiperplein', KUIPERPLEIN_ENTRANCE, KUIPERPLEIN_JUNCTION) for road in aisles), (
                   'Kuiperplein entrance is disconnected')
    return {'version': 1, 'spaces': spaces, 'areas': sorted(areas.values(), key=lambda item: item['id']),
            'aisles': sorted(aisles, key=lambda item: (item['areaId'], item['id'])),
            'sources': {'bgt': bgt_asset['date'], 'osm': releases,
                        'wkd': dict(sorted(Counter(row.tags['nwb_versie'][:10] for row in wkd.records).items()))},
            'counts': {'bgtFeatures': len(bgt), 'wkdRecords': len(wkd.records),
                       'wkdMatched': len(hit_wkd), 'osmLots': len(osm_lots),
                       'osmSpaceAreas': len(individual), **dict(sorted(stats.items()))}}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--osm', required=True, nargs='+', type=Path, help='Geofabrik extracts covering the Ede bounds')
    parser.add_argument('--wkd', required=True, type=Path, help='Complete clipped WKD parkeervlakken WFS GeoJSON')
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/ede-parking-spaces.json.gz')
    args = parser.parse_args()
    payload = build(args.osm, args.wkd)
    args.output.write_bytes(gzip.compress(json.dumps(payload, separators=(',', ':'), ensure_ascii=False).encode(), mtime=0))
    print(f'{len(payload["spaces"])} parking spaces, {len(payload["areas"])} areas, {len(payload["aisles"])} aisle ways')
    print(json.dumps(payload['counts'], sort_keys=True))
