#!/usr/bin/env python3
"""Bake offline PDOK street detail in the game's Oude Kerk frame."""

import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date
import gzip
import json
import math
from pathlib import Path
import runpy
import struct
from statistics import median, quantiles
from email.parser import BytesParser
from email.policy import default as MIME_POLICY
import subprocess
from urllib.parse import urlencode
from xml.etree import ElementTree

from shapely import STRtree, contains_xy, make_valid, union_all
from shapely.affinity import rotate, translate
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import nearest_points

from ede_map import load_scene
from ede_scene import SceneAffine

ROOT = Path(__file__).resolve().parents[1]
BGT = runpy.run_path(str(Path(__file__).with_name('build-ede-bgt.py')))
PILOTS = {
    'oude-kerkplein': (-115, -95, 100, 130),
    'kuiperplein': (-380, 10, -126, 220),
    'ede-wageningen': (-430, 1880, 285, 2460),
    'kolkakkerweg': (-1010, 775, -756, 930),
}
EXTRA = {
    'proosdijpark': (-1640, 575, -1390, 790),
    'marktplein': (-150, 145, 50, 375),
    'rijksweg-abri': (-4070, 10, -4000, 65),
}
COLLECTIONS = (
    'waterdeel', 'ondersteunendwaterdeel', 'vegetatieobject_lijn', 'vegetatieobject_vlak',
    'scheiding_lijn', 'scheiding_vlak', 'straatmeubilair', 'paal', 'begroeidterreindeel',
)
TOWN_COLLECTIONS = ('weginrichtingselement_lijn', 'weginrichtingselement_punt', 'weginrichtingselement_vlak',
                    'bak', 'onbegroeidterreindeel')
STATION_ONLY = 'gebouwinstallatie'


def town_sites(bounds):
    x0, z0, x1, z1 = bounds
    xs = [x0 + (x1 - x0) * i / 4 for i in range(5)]
    zs = [z0 + (z1 - z0) * i / 3 for i in range(4)]
    return {f'town-{j+1}-{i+1}': (left, top, right, bottom)
            for j, (top, bottom) in enumerate(zip(zs, zs[1:]))
            for i, (left, right) in enumerate(zip(xs, xs[1:]))}


def collection_sites(sites, town=False):
    for collection in COLLECTIONS + (TOWN_COLLECTIONS if town else ()):
        for site, bounds in sites.items():
            yield collection, site, bounds
    if town:
        yield STATION_ONLY, 'ede-wageningen', PILOTS['ede-wageningen']
FURNITURE = {'bank': 'bench', 'fietsenrek': 'bikeRack', 'abri': 'shelter',
             'speelvoorziening': 'playground', 'bolder': 'bollard'}
DIMENSIONS = {'bench': (1.5, .58, .82), 'bikeRack': (.72, .58, .78),
              'shelter': (3.2, 1.25, 2.35), 'playground': (1.3, 1.1, 1.65),
              'bollard': (.18, .18, .85), 'hedge': (.0, .75, 1.1),
              'fence': (.0, .1, 1.25), 'waterEdge': (.0, .35, .15),
              'balustrade': (.0, .10, 1.1), 'guardrail': (.0, .20, .8),
              'gutter': (.0, .22, .012), 'drain': (.0, .14, .012),
              'bin': (.46, .46, .91), 'container': (.68, .68, 1.05)}
ROAD_DETAIL = {'molgoot': 'gutter', 'lijnafwatering': 'drain', 'rooster': 'drain',
               'wildrooster': 'drain', 'geleideconstructie': 'guardrail', 'balustrade': 'balustrade'}
BARRIERS = {'hedge', 'fence', 'guardrail', 'balustrade'}
STATION_FRONT = (-25, 2065, 245, 2190)
# The south-entrance illustration shows a tower attachment and slim front columns.
# These fitted pads approximate the supports within the mapped roof overhangs.
STATION_SUPPORT_PADS = {'G0228.4a117f153d1842c2a12559eca57dc532': ((185, 2153), (198, 2158), (222, 2161))}
LAND_CLASSES = {'woodland': 1, 'heath': 2, 'grass': 3, 'plantingBed': 4, 'courtyard': 5}
WALK_PATHS = {'footway', 'cycleway', 'path', 'pedestrian', 'steps', 'bridleway', 'track'}
GATE_TAGS = 'gate|lift_gate|swing_gate|kissing_gate|entrance|cycle_barrier'


def geographic_bounds(bounds, affine):
    return SceneAffine(affine).geographic_bounds(bounds)


def write_json(path, document):
    data = (json.dumps(document, ensure_ascii=False, separators=(',', ':')) + '\n').encode('utf-8')
    path.write_bytes(gzip.compress(data, mtime=0) if path.suffix == '.gz' else data)


def fetch_gates(directory, sites, affine):
    selectors = []
    for bounds in sites.values():
        west, south, east, north = geographic_bounds(bounds, affine)
        selectors.append(f'node[barrier~"^({GATE_TAGS})$"]({south:.8f},{west:.8f},{north:.8f},{east:.8f});')
    query = '[out:json][timeout:24];(' + ''.join(selectors) + ');out;'
    for host in ('overpass-api.de', 'overpass.kumi.systems'):
        url = f'https://{host}/api/interpreter?{urlencode({"data": query})}'
        try:
            raw = subprocess.check_output(['curl', '-fsSL', '--max-time', '12', url])
            document = json.loads(raw)
            if not document.get('remark'):
                write_json(directory / 'gates.json', document)
                return
        except (subprocess.CalledProcessError, ValueError):
            continue

    # A few small bounded extracts suffice if Overpass is unavailable. Store only the gate nodes.
    elements = {}
    try:
        for bounds in sites.values():
            bbox = ','.join(f'{value:.8f}' for value in geographic_bounds(bounds, affine))
            url = f'https://api.openstreetmap.org/api/0.6/map?bbox={bbox}'
            raw = subprocess.check_output(['curl', '-fsSL', '--max-time', '12', '--compressed', '--user-agent',
                                           'Ede in 3D offline street-detail importer (github.com/rolandsmeenk/ede-in-3d)', url])
            for node in ElementTree.fromstring(raw).findall('node'):
                tags = {tag.attrib['k']: tag.attrib['v'] for tag in node.findall('tag')}
                if tags.get('barrier') in GATE_TAGS.split('|'):
                    identity = int(node.attrib['id'])
                    elements[identity] = {'type': 'node', 'id': identity, 'lon': float(node.attrib['lon']),
                                          'lat': float(node.attrib['lat']), 'tags': tags}
    except (subprocess.CalledProcessError, ElementTree.ParseError):
        print('No complete OSM gate extract. Reusing any saved gates.json; route clearance checks still run.', flush=True)
        return
    write_json(directory / 'gates.json', {'elements': list(elements.values()), 'retrieved': date.today().isoformat()})


def extract_gates(directory, osm, bounds):
    import osmium

    elements, dates = {}, {}
    west, south, east, north = bounds

    class Gates(osmium.SimpleHandler):
        def node(self, node):
            lon, lat = node.location.lon, node.location.lat
            if west <= lon <= east and south <= lat <= north:
                tags = dict(node.tags)
                elements[node.id] = {'type': 'node', 'id': node.id, 'lon': lon, 'lat': lat, 'tags': tags}

    for path in osm:
        with osmium.io.Reader(str(path)) as reader:
            dates[path.name] = reader.header().get('osmosis_replication_timestamp')
        Gates().apply_file(str(path), filters=[osmium.filter.EntityFilter(osmium.osm.NODE),
                                           osmium.filter.TagFilter(*[('barrier', tag) for tag in GATE_TAGS.split('|')])])
    write_json(directory / 'gates.json', {'elements': sorted(elements.values(), key=lambda row: row['id']),
                                          'retrieved': max((day for day in dates.values() if day), default=None),
                                          'sourceDates': dates})


def fetch(directory, sites, affine, day, town=False, osm=None):
    directory.mkdir(parents=True, exist_ok=True)
    jobs = [(site, collection, geographic_bounds(bounds, affine))
            for collection, site, bounds in collection_sites(sites, town)]

    def fetch_one(job):
        site, collection, bounds = job
        _, features = BGT['fetch_tile'](collection, bounds, day)
        write_json(directory / f'{site}-{collection}.geojson', {
            'type': 'FeatureCollection', 'features': features,
        })
        print(f'{site} {collection}: {len(features)}', flush=True)

    with ThreadPoolExecutor(max_workers=8) as pool:
        gate_job = pool.submit(extract_gates, directory, osm, geographic_bounds(
            union_all([box(*bounds) for bounds in sites.values()]).bounds, affine)) if osm else None
        if not town and not osm:
            gate_job = pool.submit(fetch_gates, directory, sites, affine)
        list(pool.map(fetch_one, jobs))
        if gate_job:
            gate_job.result()
    write_json(directory / 'snapshot.json', {'date': day, 'sites': sites})


def read_records(directory, sites, day, town=False):
    files = defaultdict(list)
    for collection, site, _ in collection_sites(sites, town):
        files[collection].append(site)
    # Keep the surveyed bank precedence when resolving nearby water edges.
    for collection in sorted(files, key=lambda name: (name != 'ondersteunendwaterdeel', name)):
        latest = {}
        for site in files[collection]:
            document = json.loads((directory / f'{site}-{collection}.geojson').read_bytes())
            for feature in document['features']:
                p = feature['properties']
                end = [p[key][:10] for key in ('eind_registratie', 'termination_date') if p.get(key)]
                if (p.get('status') != 'bestaand' or p.get('plus_status') in {'plan', 'historie'}
                        or not feature.get('geometry') or any(day >= value for value in end)
                        or (p.get('creation_date') or '')[:10] > day):
                    continue
                identity = p['lokaal_id']
                if identity not in latest or p['tijdstip_registratie'] > latest[identity]['properties']['tijdstip_registratie']:
                    latest[identity] = feature
        for identity, feature in sorted(latest.items()):
            yield collection, identity, feature


def classify(collection, prop):
    tag = prop.get('plus_type') or prop.get('type')
    if collection.startswith('vegetatieobject') and tag == 'haag':
        return 'hedge'
    if collection.startswith('scheiding') and tag in {'hek', 'draadraster', 'faunaraster'}:
        return 'fence'
    if collection in TOWN_COLLECTIONS[0:3]:
        return ROAD_DETAIL.get(tag)
    if collection == 'bak':
        return {'afvalbak': 'bin', 'container': 'container', 'afval apart plaats': 'container'}.get(tag)
    if collection == STATION_ONLY:
        return {'luifel': 'canopy', 'bordes': 'landing', 'toegangstrap': 'steps'}.get(tag)
    if collection == 'straatmeubilair':
        return FURNITURE.get(tag)
    if collection == 'paal' and tag in {'afsluitpaal', 'poller'}:
        return 'bollard'
    if collection == 'begroeidterreindeel':
        detail = prop.get('plus_fysiek_voorkomen') or prop.get('fysiek_voorkomen')
        if detail in {'heesters', 'struiken'}:
            return 'shrub'
        if detail in {'planten', 'bodembedekkers', 'gras- en kruidachtigen'}:
            return 'groundCover'
    if collection == 'ondersteunendwaterdeel' or collection == 'waterdeel' and tag != 'greppel, droge sloot':
        return 'waterEdge'
    return None


def parts(geometry, kind):
    if geometry.is_empty:
        return
    if geometry.geom_type == kind:
        yield geometry
    elif hasattr(geometry, 'geoms'):
        for part in geometry.geoms:
            yield from parts(part, kind)


def flat_polygon(outer, holes=()):
    return make_valid(Polygon(BGT['pairs'](outer), [BGT['pairs'](hole) for hole in holes]))


def tree_positions(path):
    data = path.read_bytes()
    version, count = struct.unpack_from('<4sI', data)
    if version not in {b'EDT1', b'EDT2', b'EDT3', b'EDT4'}:
        raise ValueError(f'Unrecognized Ede tree inventory: {path}')
    record = struct.Struct('<iiHBBB' if version == b'EDT4' else '<hhHBBB')
    offset = 8
    for _ in range(count):
        x, z, _, _, _, flags = record.unpack_from(data, offset)
        offset += record.size + bool(flags & 72) + bool(flags & 128)
        yield Point(x / 5, z / 5)
    if offset != len(data):
        raise ValueError(f'Invalid Ede tree inventory length: {path}')


def build_evidence(scene, area, *, tree_path=ROOT / 'assets/ede-trees.bin'):
    route_rows = []
    bus_roads = []

    def add_route(line, width, road):
        if not line.is_empty and line.intersects(area):
            route_rows.append((road['id'], road['layer'], line, line.buffer(width / 2, cap_style='flat')))

    for road in scene['roads']:
        mode = road['modes'][0] | road['modes'][1]
        if not mode:
            continue
        line = LineString(BGT['pairs'](road['pts']))
        if not line.intersects(area):
            continue
        width = road.get('bgt', {}).get('width') or road['width']
        if road['kind'] in WALK_PATHS or not mode & 7:
            width = min(width, 5) if road['kind'] != 'pedestrian' else width
        add_route(line, width, road)
        if mode & 4:
            bus_roads.append((road['layer'], line))
        for cycle in road.get('cycle', []):
            offset = cycle.get('offset', 0)
            if offset:
                add_route(line.offset_curve(offset), cycle.get('width', 1.4), road)

    graph = scene['activeGraph']
    for a, b, _, _, _, _, inner, road_index, offsets in graph['links']:
        if not any(offsets):
            continue
        line = LineString([tuple(graph['nodes'][a*2:a*2+2]), *BGT['pairs'](inner), tuple(graph['nodes'][b*2:b*2+2])])
        for offset in offsets:
            if offset:
                add_route(line.offset_curve(offset), 2, scene['roads'][road_index])

    stops = {}
    for variant in json.loads((ROOT / 'assets/ede-bus-routes.json').read_bytes())['variants']:
        for stop in variant['stops']:
            if not ('x' in stop and 'z' in stop):
                continue
            point = Point(stop['x'], stop['z'])
            if area.covers(point):
                stops.setdefault(stop['id'], point)
    road_tree = STRtree([line for level, line in bus_roads])
    boarding = []
    for stop_id, point in stops.items():
        indices = road_tree.query(point, predicate='dwithin', distance=15)
        if len(indices):
            _, line = min((bus_roads[i] for i in indices), key=lambda item: item[1].distance(point))
            roadside = nearest_points(line, point)[0]
            boarding.append((stop_id, point, LineString([point, roadside]).buffer(1.05)))
    border = area.buffer(2)
    structures = []
    for record in json.loads((ROOT / 'assets/ede-bgt.json').read_bytes())['structures']:
        if record['kind'] not in {'civilWall', 'retainingWall', 'noiseWall', 'pylon', 'shed'}:
            continue
        for outer, *holes in record['polygons']:
            geometry = flat_polygon(outer, holes)
            if geometry.intersects(border):
                structures.append((record['layer'], geometry))
    trees = [Point(t['x'], t['z']) for t in scene['trees']]
    trees.extend(tree_positions(tree_path))
    lamp_data = gzip.decompress((ROOT / 'assets/ede-lamps.bin.gz').read_bytes())
    lamp_format = {b'EDL2': '<hhhHhHBb', b'EDL3': '<iihHhHBb'}.get(lamp_data[:4])
    if lamp_format is None:
        raise ValueError('Unrecognized Ede lamp inventory')
    lamps = [Point(x / 5, z / 5) for x, z, _, _, _, _, _, level in struct.iter_unpack(lamp_format, lamp_data[8:])
             if level == 0]
    building_polygons = []
    for record in scene['buildings']:
        ring = record['ring']
        xs, zs = ring[::2], ring[1::2]
        if len(xs) < 3 or not border.intersects(box(min(xs), min(zs), max(xs), max(zs))):
            continue
        building_polygons.append(flat_polygon(ring, record.get('holes', [])))
    return (route_rows, STRtree([row[3] for row in route_rows]), boarding, structures,
            STRtree([row[1] for row in structures]), STRtree(trees), STRtree(lamps), STRtree(building_polygons))


def load_gates(directory, affine, area):
    path = directory / 'gates.json'
    if not path.exists():
        return [], None
    document = json.loads(path.read_bytes())
    gates = []
    for entry in document['elements']:
        if entry.get('type') != 'node' or entry['tags'].get('barrier') not in GATE_TAGS.split('|'):
            continue
        geometry = {'geometry': {'type': 'Point', 'coordinates': [entry['lon'], entry['lat']]}}
        point = BGT['world_geometry'](geometry, affine, area)
        if point.is_empty:
            continue
        tags = entry['tags']
        try:
            width = float((tags.get('width') or tags.get('maxwidth:physical') or '0').removesuffix(' m').replace(',', '.'))
        except ValueError:
            width = 0
        default = 3.2 if tags['barrier'] in {'lift_gate', 'swing_gate', 'gate'} else 1.5
        try:
            level = int(tags.get('layer', '0'))
        except ValueError:
            level = 0
        gates.append((entry['id'], level, point, width if .5 <= width <= 10 else default))
    timestamp = document.get('osm3s', {}).get('timestamp_osm_base') or document.get('retrieved')
    return sorted(gates, key=lambda row: row[0]), timestamp


def round_xy(point):
    return [round(value, 2) for value in point[:2]]


def line_coordinates(line):
    points = [round_xy(p) for p in line.simplify(.12).coords]
    return [p for i, p in enumerate(points) if i == 0 or p != points[i-1]]


def points_on_planting(geometry, kind, avoidance, trees):
    spacing, maximum = (2.2, 6) if kind == 'shrub' else (3.6, 3)
    for polygon in parts(geometry.difference(avoidance), 'Polygon'):
        if polygon.area < (.6 if kind == 'shrub' else 1.2):
            continue
        usable = polygon.buffer(-(.22 if kind == 'shrub' else .12))
        if usable.is_empty:
            continue
        x0, z0, x1, z1 = usable.bounds
        # Keep the sample cost bounded even in large parks and narrow verge strips.
        pitch = spacing * max(1, math.ceil(math.sqrt((x1 - x0) * (z1 - z0) / 512) / spacing))
        points = [usable.representative_point()]
        for z in range(math.ceil(z0 / pitch), math.floor(z1 / pitch)+1):
            for x in range(math.ceil(x0 / pitch), math.floor(x1 / pitch)+1):
                point = Point(x * pitch, z * pitch)
                if usable.covers(point) and point.distance(points[0]) >= spacing * .8:
                    points.append(point)
        step = max(1, math.ceil(len(points) / maximum))
        for point in points[::step]:
            if not len(trees.query(point, predicate='dwithin', distance=.95)):
                yield {'position': round_xy((point.x, point.y))}


def is_native_fence(geometry, kind, route_clear, gates):
    """Subtract reserved pedestrian/vehicle space and openings before simplifying."""
    width = DIMENSIONS[kind][1]
    opening = union_all([point.buffer(gap / 2 + width / 2) for _, _, point, gap in gates])
    keep = geometry.difference(union_all([route_clear.buffer(width / 2 + .2), opening]))
    for line in parts(keep, 'LineString'):
        points = line_coordinates(line)
        if line.length >= .65 and len(points) >= 2:
            yield {'points': points, 'width': width, 'height': DIMENSIONS[kind][2], 'collidable': kind != 'hedge'}
    for polygon in parts(keep, 'Polygon'):
        if polygon.area < .4:
            continue
        polygon = polygon.simplify(.1, preserve_topology=True)
        yield {'polygon': [round_xy(p) for p in list(polygon.exterior.coords)[:-1]],
               'holes': [[round_xy(p) for p in list(ring.coords)[:-1]] for ring in polygon.interiors],
               'height': DIMENSIONS[kind][2], 'collidable': kind != 'hedge'}


def prop_angle(point, nearby):
    if not nearby:
        return 0.0
    _, _, line, _ = min(nearby, key=lambda row: row[2].distance(point))
    t = line.project(point)
    a = line.interpolate(max(0, t - 1))
    b = line.interpolate(min(line.length, t + 1))
    return math.atan2(b.x - a.x, b.y - a.y)


def footprint(point, angle, length, width):
    hull = rotate(box(-width/2, -length/2, width/2, length/2), -angle, use_radians=True)
    return translate(hull, point.x, point.y)


def feature_geometry(item):
    if 'position' in item:
        shape = Point(item['position'])
    elif 'points' in item:
        shape = LineString(item['points'])
    else:
        shape = Polygon(item['polygon'], item.get('holes', ()))
    return shape


def mount_feature(item, level, decks, profiles):
    shape = feature_geometry(item)
    # Require the whole feature to fit a single surveyed deck or fitted travel surface.
    matches = [identity for identity, deck_level, area in decks if level == deck_level and area.covers(shape)]
    if len(matches) == 1:
        return {'surfaceId': matches[0]}
    matches = [identity for identity, levels, area in profiles if level in levels and area.covers(shape)]
    return {'profileId': matches[0]} if len(matches) == 1 else None


def fitted_profiles(scene):
    levels = {road['id']: road['layer'] for road in scene['roads']}
    document = json.loads((ROOT / 'assets/ede-grade.json').read_bytes())
    results = []
    for site in document['sites']:
        if site['kind'] not in {'bridge', 'underpass'}:
            continue
        for profile in site['profiles']:
            if profile.get('kind') == 'rail' or not set(profile.get('modes', ())) & {'motor', 'foot', 'bike'}:
                continue
            level = {levels[way] for way in profile.get('wayIds', []) if way in levels and levels[way]}
            if len(level) != 1:
                continue
            line = LineString([p[:2] for p in profile['points']])
            area = line.buffer(profile['width'] / 2 + .30, cap_style='flat')
            results.append((profile['id'], level, area))
    return results


def motorway_barriers():
    filename = ROOT / 'assets/ede-1gis-detail.json.gz'
    with gzip.open(filename, 'rt') as source:
        records = [f for f in json.load(source)['features']
                   if f['type'] in {'guardrail', 'fence', 'noiseBarrier'} and 'points' in f]
    lines = [LineString(f['points']) for f in records]
    return records, lines, STRtree(lines)


def crowded_barrier(geometry, kind, level, motorway):
    if not motorway or kind == 'hedge':
        return geometry, []
    rows, lines, tree = motorway
    remove, ids = [], []
    for i in sorted(tree.query(geometry, predicate='dwithin', distance=.7)):
        row = rows[i]
        comparable = row['type'] == 'fence' if kind == 'fence' else row['type'] == 'guardrail'
        if not comparable or row['level'] != level:
            continue
        line = lines[i]
        area = line.buffer(.7, cap_style='flat')
        shared = geometry.intersection(area)
        if shared.length >= min(2.5, line.length * .65) and shared.length >= min(2.5, geometry.length * .65):
            remove.append(area)
            ids.append(row['id'])
    return geometry.difference(union_all(remove)) if remove else geometry, ids


def polygon_record(polygon):
    return {'polygon': [round_xy(p) for p in list(polygon.exterior.coords)[:-1]],
            'holes': [[round_xy(p) for p in list(ring.coords)[:-1]] for ring in polygon.interiors]}


def linear_detail(geometry, kind):
    width = DIMENSIONS[kind][1]
    for line in parts(geometry, 'LineString'):
        points = line_coordinates(line)
        if line.length >= .35 and len(points) >= 2:
            yield {'points': points, 'width': width, 'height': DIMENSIONS[kind][2]}
    for polygon in parts(geometry, 'Polygon'):
        if .025 <= polygon.area <= 64:
            yield {**polygon_record(polygon.simplify(.06, preserve_topology=True)), 'height': DIMENSIONS[kind][2]}


def prop_record(geometry, kind, level, nearby, boarding, stops, trees, lamps, buildings):
    point = geometry.representative_point()
    route_hits = union_all([row[3] for row in nearby])
    length, width, height = DIMENSIONS[kind]
    angle = prop_angle(point, nearby)
    stop_id = None
    if kind == 'shelter':
        candidates = sorted((point.distance(stop), key, stop) for key, stop in stops.items())
        if candidates and candidates[0][0] <= 11 and (len(candidates) == 1 or candidates[1][0] - candidates[0][0] >= 2):
            _, stop_id, stop = candidates[0]
            if (stop.x - point.x) * math.cos(angle) - (stop.y - point.y) * math.sin(angle) < 0:
                angle += math.pi
    hull = footprint(point, angle, length, width)
    if level == 0 and (len(lamps.query(hull, predicate='dwithin', distance=.25))
                       or len(trees.query(hull, predicate='dwithin', distance=.45))
                       or len(buildings.query(hull, predicate='intersects'))):
        return None, 'existing-asset-overlap'
    if level == 0 and any(hull.intersects(corridor) for _, _, corridor in boarding):
        return None, 'boarding-area-overlap'
    if hull.intersection(route_hits).area >= min(.06, hull.area * .2):
        return None, 'route-overlap'
    data = {'position': round_xy((point.x, point.y)), 'angle': round(angle, 4), 'width': width,
            'length': length, 'height': height, 'collidable': kind == 'bollard'}
    if stop_id:
        data['stopId'] = stop_id
    return data, 'unmatched-shelter' if kind == 'shelter' and not stop_id else None


AHN6 = {
    'dsm': ('22f5740b-1276-42e0-9d2d-dd2a9745e928', 'c936131a-2c4f-44ce-b321-a085c6c0ce3b'),
    'dtm': ('231a4c66-9de9-4f41-91af-e4e991df9160', '05df775a-ae39-4bb0-a52e-d3044c993d1e'),
}


def fetch_station_heights(directory, affine):
    from ede_gis import TransformDirection, geographic_pipeline

    frame = SceneAffine(affine)
    mercator = geographic_pipeline()
    x0, z0, x1, z1 = STATION_FRONT
    easts, norths = zip(*(mercator.transform(*frame.scene_to_lon_lat(x, z),
                                            direction=TransformDirection.INVERSE, errcheck=True)
                          for x in (x0 - 10, x1 + 10) for z in (z0, z1 + 10)))
    west, south = math.floor(min(easts)), math.floor(min(norths))
    east, north = math.ceil(max(easts)), math.ceil(max(norths))
    crs = 'urn:ogc:def:crs:EPSG::3857'
    for model, (service, identity) in AHN6.items():
        path = directory / f'station-canopy-ahn6-{model}.tif'
        if path.exists():
            continue
        query = urlencode({'service': 'WCS', 'request': 'GetCoverage', 'version': '1.1.1',
                           'identifier': identity, 'format': 'GeoTIFF',
                           'boundingBox': f'{west},{south},{east},{north},{crs}', 'gridBaseCRS': crs,
                           'gridOrigin': f'{west},{north}', 'gridOffsets': '0.8,-0.8'})
        raw = subprocess.check_output(['curl', '-fsSL', '--max-time', '40',
                                       f'https://api.ellipsis-drive.com/v3/ogc/wcs/{service}?{query}'])
        # Ellipsis Drive can append the closing MIME marker immediately after the TIFF.
        # Insert its separator before parsing so a final TIFF newline stays part of the raster.
        closing = b'--wcs--'
        if not raw.endswith(closing):
            raise ValueError(f'Expected the final AHN6 WCS boundary for station {model}')
        raw = raw.removesuffix(closing) + b'\r\n' + closing
        message = BytesParser(policy=MIME_POLICY).parsebytes(b'Content-Type: multipart/mixed; boundary=wcs\r\n\r\n' + raw)
        payload = next((part.get_payload(decode=True) for part in message.iter_parts()
                        if part.get_content_type() == 'image/tiff'), None)
        if not payload:
            raise ValueError(f'Expected a GeoTIFF in the AHN6 station {model} response')
        path.write_bytes(payload)


def station_heights(directory, affine):
    dtm_path, dsm_path = [directory / f'station-canopy-ahn6-{model}.tif' for model in ('dtm', 'dsm')]
    if not (dtm_path.exists() and dsm_path.exists()):
        return None
    import numpy as np
    import rasterio

    from ede_gis import Frame, TransformDirection, geographic_pipeline, rd_pipeline, source_crs
    from ede_raster import sample_bilinear

    frame = Frame(affine)
    rasters = []
    for path in (dtm_path, dsm_path):
        with rasterio.open(path) as raster:
            code = source_crs({'crs': raster.crs.to_wkt()} if raster.crs else {}).to_epsg()
            nominal = {28992: 0.5, 3857: 0.8}.get(code)
            if nominal is None or any(abs(step - nominal) > .02 for step in raster.res):
                raise ValueError('Expected the AHN6 station survey at nominal half-metre resolution')
            rasters.append((code, raster.transform, raster.read(1, masked=True).astype(float).filled(np.nan)))

    def sample(points):
        easting, northing = frame.scene_to_rd(*np.asarray(points).T)
        for code, transform, pixels in rasters:
            x, y = easting, northing
            if code == 3857:
                lon, lat = rd_pipeline().transform(x, y, errcheck=True)
                x, y = geographic_pipeline().transform(lon, lat, direction=TransformDirection.INVERSE, errcheck=True)
            yield sample_bilinear(pixels, transform, x, y)

    def canopy(polygon):
        usable = polygon.buffer(-.32)
        if usable.is_empty:
            return []
        x0, z0, x1, z1 = usable.bounds
        points = [(x, z) for z in range(math.ceil(z0), math.floor(z1) + 1)
                  for x in range(math.ceil(x0), math.floor(x1) + 1) if contains_xy(usable, x, z)]
        if len(points) < 5:
            return []
        ground, roof = sample(points)
        floor_samples = [value for value in ground if 12 <= value <= 40]
        # Some station ground pixels are voids beneath roofs or the split-level concourse.
        if len(floor_samples) < len(points) * .45:
            return []
        floor = median(floor_samples)
        pairs = [(point, top) for point, top in zip(points, roof) if 2.6 <= top - floor <= 14]
        if len(pairs) < len(points) * .8:
            return []
        heights = [top for _, top in pairs]
        low, _, high = quantiles(heights, n=4)
        if high - low <= .8:
            return [(polygon, round(median(heights), 2), round(median(heights) - floor, 2))]
        # Retain a clearly separated step where a single mapped outline spans two roof faces.
        candidates = []
        for axis in range(2):
            positions = sorted({point[axis] for point, _ in pairs})
            for a, b in zip(positions, positions[1:]):
                edge = (a + b) / 2
                matching = [[], []]
                for point, top in pairs:
                    matching[point[axis] >= edge].append(top)
                if min(map(len, matching)) < len(pairs) * .18:
                    continue
                first, second = map(median, matching)
                if abs(first - second) < .8:
                    continue
                score = sum(abs(h - value) <= .45 for group, h in zip(matching, (first, second)) for value in group)
                candidates.append((score, axis, edge, first, second))
        if not candidates:
            return []
        score, axis, edge, first, second = max(candidates)
        if score < len(points) * .9:
            return []
        x0, z0, x1, z1 = polygon.bounds
        halves = (box(x0, z0, edge, z1), box(edge, z0, x1, z1)) if axis == 0 else (
            box(x0, z0, x1, edge), box(x0, edge, x1, z1))
        return [(face, round(top, 2), round(top - floor, 2))
                for clip, top in zip(halves, (first, second)) for face in parts(polygon.intersection(clip), 'Polygon')]
    return canopy


def station_paving():
    area = box(*STATION_FRONT)
    paths = []
    with gzip.open(ROOT / 'assets/ede-road-surfaces.json.gz', 'rt') as data:
        for surface in json.load(data)['surfaces']:
            if surface['layer'] or surface['function'] not in {'voetpad', 'voetgangersgebied'}:
                continue
            for outer, *holes in surface['polygons']:
                x, z = outer[::2], outer[1::2]
                if box(min(x), min(z), max(x), max(z)).intersects(area):
                    paths.append(flat_polygon(outer, holes))
    return union_all(paths, grid_size=.01)


def station_supports(identity, face, terrain, paving, roads, road_tree, boarding_tree, buildings, trees, lamps):
    supports = []
    for x, z in STATION_SUPPORT_PADS.get(identity, ()):
        # Include a margin beyond the fitted column diameter when checking an approach.
        pad = Point(x, z).buffer(.54)
        if not face.covers(pad) or not paving.covers(pad):
            continue
        if (any(roads[i][1] == 0 for i in road_tree.query(pad, predicate='intersects'))
                or len(boarding_tree.query(pad, predicate='intersects'))
                or any(len(tree.query(pad, predicate='intersects')) for tree in (buildings, trees, lamps))):
            continue
        # Tie to the existing visible plaza surface. The native DTM under this roof is locally incomplete.
        supports.append({'position': [x, z], 'baseY': round(terrain.at((x, z)) - .06, 2),
                         'width': .43, 'depth': .43, 'angle': 0})
    return supports


def land_class(collection, properties):
    details = properties.get('plus_fysiek_voorkomen')
    physical = properties.get('fysiek_voorkomen')
    if collection == 'onbegroeidterreindeel':
        return 'courtyard' if physical == 'erf' else None
    for tag in (details, physical):
        if tag in {'loofbos', 'naaldbos', 'gemengd bos', 'bosplantsoen', 'houtwal', 'griend en hakhout'}:
            return 'woodland'
        if tag == 'heide':
            return 'heath'
        if tag in {'grasland agrarisch', 'grasland overig', 'gras- en kruidachtigen'}:
            return 'grass'
        if tag in {'heesters', 'struiken', 'planten', 'bodembedekkers'}:
            return 'plantingBed'
    return None


def bake_land(directory, sites, scene, day, path):
    import numpy as np

    bounds, affine = scene['meta']['bounds'], scene['meta']['lonLatAffine']
    x0, z0, x1, z1 = bounds
    step = 2
    cols, rows = math.ceil((x1 - x0) / step), math.ceil((z1 - z0) / step)
    cells = np.zeros((rows, cols), dtype=np.uint8)
    xs, zs = x0 + (np.arange(cols) + .5) * step, z0 + (np.arange(rows) + .5) * step
    area = box(*bounds)
    # Prefer surveyed vegetation over overlapping erf interiors. The shared water pass stays clear.
    grouped = defaultdict(list)
    source_counts = Counter()
    for collection, _, feature in read_records(directory, sites, day, True):
        props = feature['properties']
        if props.get('relatieve_hoogteligging'):
            continue
        if collection in {'begroeidterreindeel', 'onbegroeidterreindeel'}:
            land = land_class(collection, props)
            if land:
                geometry = BGT['world_geometry'](feature, affine, area)
                if not geometry.is_empty:
                    grouped[land].append(geometry)
                    source_counts[land] += 1

    grouped['water'].extend(flat_polygon(osm['ring'], osm.get('holes', [])) for osm in scene['water'])

    for land in ('courtyard', 'grass', 'woodland', 'heath', 'plantingBed', 'water'):
        value = LAND_CLASSES.get(land, 0)
        for geometry in grouped[land]:
            if geometry.is_empty:
                continue
            left, top, right, bottom = geometry.bounds
            col = slice(int(np.searchsorted(xs, left)), int(np.searchsorted(xs, right)))
            row = slice(int(np.searchsorted(zs, top)), int(np.searchsorted(zs, bottom)))
            if col.start == col.stop or row.start == row.stop:
                continue
            inside = contains_xy(geometry, xs[None, col], zs[row, None])
            cells[row, col][inside] = value
    counts = np.bincount(cells.ravel(), minlength=len(LAND_CLASSES) + 1)
    content = struct.pack('<IIIfff', 0x314C4742, cols, rows, x0, z0, step) + cells.tobytes()
    path.write_bytes(gzip.compress(content, mtime=0))
    return {'width': cols, 'height': rows, 'step': step, 'bytes': path.stat().st_size,
            'sourceCounts': source_counts,
            'pixels': {kind: int(counts[value]) for kind, value in LAND_CLASSES.items()}}


def bake(directory, sites, scene, day, town=False):
    affine = scene['meta']['lonLatAffine']
    site_areas = {key: box(*bounds) for key, bounds in sites.items()}
    area = union_all(list(site_areas.values())).intersection(box(*scene['meta']['bounds']))
    roads, road_tree, boarding, structures, structure_tree, trees, lamps, buildings = build_evidence(scene, area.buffer(25))
    gates, gate_date = load_gates(directory, affine, area)
    stops = {key: point for key, point, _ in boarding}
    boarding_tree = STRtree([corridor for _, _, corridor in boarding])
    decks = []
    for structure in json.loads((ROOT / 'assets/ede-bgt.json').read_bytes())['structures']:
        if structure['kind'] != 'deck' or not structure.get('axis'):
            continue
        deck = union_all([flat_polygon(outer, holes) for outer, *holes in structure['polygons']])
        if deck.intersects(area):
            decks.append((structure['ids'][0], structure['layer'], deck.buffer(.1)))
    profiles = fitted_profiles(scene)
    motorway = motorway_barriers() if town else None
    records = list(read_records(directory, sites, day, town))
    playable = box(*scene['meta']['bounds'])
    water_tree = STRtree([flat_polygon(row['ring'], row.get('holes', [])) for row in scene['water']])
    water_lines = [part.boundary for collection, _, raw in records
                   if collection == 'waterdeel' and classify(collection, raw['properties']) == 'waterEdge'
                   and not (part := BGT['world_geometry'](raw, affine, playable)).is_empty]
    water_line_tree = STRtree(water_lines)
    mapped_banks, bank_tree = [], None
    canopy = station_heights(directory, affine) if town else None
    paving = station_paving() if canopy else None
    terrain = runpy.run_path(str(Path(__file__).with_name('build-ede-grade.py')))['Terrain']() if canopy else None
    features, reviews = [], []
    inventory, site_counts = Counter(), defaultdict(Counter)
    known = {}
    for collection, identity, raw in records:
        prop = raw['properties']
        kind = classify(collection, prop)
        if not kind and town:
            continue
        geometry = BGT['world_geometry'](raw, affine, area)
        if kind in {'canopy', 'landing', 'steps'} and not box(*STATION_FRONT).covers(geometry.centroid):
            continue
        if geometry.is_empty:
            continue
        covered = [site for site, bounds in site_areas.items() if bounds.intersects(geometry)]
        for site in covered:
            site_counts[site][collection] += 1
        if kind is None:
            continue
        level = int(prop.get('relatieve_hoogteligging') or 0)
        inventory[kind] += 1
        nearby = [roads[index] for index in road_tree.query(geometry, predicate='dwithin', distance=14)
                  if roads[index][1] == level]
        lane_space = [row[3] for row in nearby]
        if level == 0 and kind in BARRIERS | {'groundCover', 'shrub'}:
            lane_space.extend(boarding_tree.geometries[i] for i in boarding_tree.query(
                geometry, predicate='dwithin', distance=.8))
        route_clear = union_all(lane_space, grid_size=.01)
        old_assets = union_all([structures[i][1] for i in structure_tree.query(geometry, predicate='dwithin', distance=.55)
                                if structures[i][0] == level], grid_size=.01)
        matched_gates = [row for row in gates if row[1] == level and geometry.distance(row[2]) <= .65]
        review_point = geometry.representative_point()
        info = {'id': identity, 'type': kind, 'level': level, 'site': covered, 'collection': collection,
                'position': round_xy((review_point.x, review_point.y)),
                'registered': prop['tijdstip_registratie'], 'created': prop.get('creation_date'),
                'published': prop.get('lv_publicatiedatum')}
        if kind in BARRIERS:
            if matched_gates:
                reviews.append({**info, 'reason': 'preserved-gate-opening', 'nodeIds': [row[0] for row in matched_gates]})
            conflicting = sorted({row[0] for row in nearby if row[3].buffer(DIMENSIONS[kind][1] / 2).intersects(geometry)})
            if conflicting:
                reviews.append({**info, 'reason': 'trimmed-route-conflict', 'wayIds': conflicting})
            if geometry.intersects(old_assets.buffer(.4)):
                reviews.append({**info, 'reason': 'trimmed-existing-structure'})
            geometry, duplicates = crowded_barrier(geometry, kind, level, motorway)
            if duplicates:
                reviews.append({**info, 'reason': 'matched-1gis-barrier', 'matchedIds': duplicates})
            placement = list(is_native_fence(geometry.difference(old_assets.buffer(.4)), kind, route_clear, matched_gates))
        elif kind in {'groundCover', 'shrub'}:
            water = BGT['nearby_union'](water_tree, geometry, .15)
            avoidance = union_all([route_clear.buffer(.45), old_assets.buffer(.3), water.buffer(.15)], grid_size=.01)
            placement = list(points_on_planting(geometry, kind, avoidance, trees))
        elif kind in {'gutter', 'drain'}:
            placement = list(linear_detail(geometry, kind))
        elif kind in {'canopy', 'landing', 'steps'}:
            placement = []
            for polygon in parts(geometry, 'Polygon'):
                if polygon.area < 3 or polygon.intersection(BGT['nearby_union'](buildings, polygon)).area > polygon.area * .10:
                    reviews.append({**info, 'reason': 'covered-by-existing-building'})
                    continue
                faces = canopy(polygon) if kind == 'canopy' and canopy else []
                if faces and polygon.intersection(old_assets).area < polygon.area * .10:
                    for face, top, height in faces:
                        supports = station_supports(identity, face, terrain, paving, roads, road_tree,
                                                    boarding_tree, buildings, trees, lamps)
                        if not supports:
                            reviews.append({**info, 'reason': 'unverified-station-support'})
                            continue
                        placement.append({**polygon_record(face.simplify(.08, preserve_topology=True)),
                                          'topY': top, 'height': height, 'heightSource': 'AHN6 DSM/DTM 0.5 m (CC BY 4.0)',
                                          'supports': supports, 'supportSource': 'ProRail entrance illustration and Haskoning project photos; fitted positions',
                                          'supportsEstimated': True})
                else:
                    reviews.append({**info, 'reason': 'unverified-station-height'})
        elif kind == 'waterEdge':
            # Use the original exterior shoreline, never the artificial pilot clip edge.
            original = BGT['world_geometry'](raw, affine, playable)
            shoreline = union_all([polygon.exterior for polygon in parts(original, 'Polygon')])
            shoreline = shoreline.intersection(area).intersection(route_clear.buffer(9)).difference(route_clear.buffer(.5))
            shoreline = shoreline.difference(old_assets.buffer(.75))
            if collection == 'ondersteunendwaterdeel':
                waters = BGT['nearby_union'](water_line_tree, shoreline, .85)
                shoreline = shoreline.intersection(waters.buffer(.85))
                if not shoreline.is_empty:
                    mapped_banks.append(shoreline.buffer(.7))
            elif mapped_banks:
                if bank_tree is None:
                    bank_tree = STRtree(mapped_banks)
                shoreline = shoreline.difference(BGT['nearby_union'](bank_tree, shoreline))
            placement = [{'points': points, 'width': .35, 'height': .15} for line in parts(shoreline, 'LineString')
                         if line.length >= 2 and len(points := line_coordinates(line)) >= 2]
        else:
            record, reason = prop_record(geometry, kind, level, nearby, boarding, stops, trees, lamps, buildings)
            if reason:
                reviews.append({**info, 'reason': reason,
                                'wayIds': sorted({row[0] for row in nearby if row[3].distance(geometry) <= 1.5})})
            placement = [record] if record else []

        for index, item in enumerate(placement):
            piece_id = identity if index == 0 else f'{identity}:{index}'
            if level and not item.get('topY'):
                mounted = mount_feature(item, level, decks, profiles)
                if not mounted:
                    reviews.append({**info, 'reason': 'unverified-elevation', 'pieceId': piece_id,
                                    'position': item.get('position') or (item.get('points') or item['polygon'])[0]})
                    continue
                item.update(mounted)
            if 'position' in item and kind in DIMENSIONS:
                x, z = item['position']
                # Distinct cycle stands only ~0.5 m apart are common. Drop true coincident placements only.
                key = kind, level, round(x / .27), round(z / .27)
                if key in known:
                    reviews.append({**info, 'reason': 'coincident-prop', 'duplicateOf': known[key]})
                    continue
                known[key] = identity
            features.append({'id': piece_id, 'type': kind, 'level': level, 'registered': prop['tijdstip_registratie'][:10], **item})
            for site in covered:
                site_counts[site][f'placed:{kind}'] += 1

    counts = Counter(feature['type'] for feature in features)
    source = {'name': 'PDOK Basisregistratie Grootschalige Topografie', 'url': BGT['API'], 'license': 'CC0'}
    asset = {'version': 1, 'source': source, 'date': day, 'features': features}
    review = {'date': day, 'siteBounds': sites, 'inventory': dict(sorted(inventory.items())),
              'placements': dict(sorted(counts.items())), 'siteCounts': site_counts,
              'gateSource': {'name': 'OpenStreetMap contributors', 'license': 'ODbL-1.0', 'date': gate_date,
                             'mappedNodes': len(gates), 'available': (directory / 'gates.json').exists()},
              'reviews': reviews}
    return asset, review


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshot', type=Path, nargs='?', help='dated PDOK snapshot directory')
    parser.add_argument('--fetch', action='store_true', help='download a dated PDOK snapshot first')
    parser.add_argument('--date', type=date.fromisoformat, default=date.today())
    parser.add_argument('--coverage', choices=('pilot', 'expanded', 'town'), default='town')
    parser.add_argument('--osm', type=Path, nargs='+', help='local OSM PBF extracts for mapped gate openings')
    parser.add_argument('--station-ahn', action='store_true', help='download native DSM and DTM for the station pilot')
    parser.add_argument('--skip-land', action='store_true', help='omit the separate BGT land mask when benchmarking')
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/ede-bgt-detail.json.gz')
    parser.add_argument('--review', type=Path, default=ROOT / 'tools/data/ede-bgt-detail.review.json')
    parser.add_argument('--land-output', type=Path, default=ROOT / 'assets/ede-bgt-land.bin.gz')
    parser.add_argument('--municipal-snapshot', type=Path, help='dated municipal WFS cache directory')
    parser.add_argument('--municipal-output', type=Path, default=ROOT / 'assets/ede-municipal-detail.json.gz')
    parser.add_argument('--municipal-review', type=Path, default=ROOT / 'tools/data/ede-municipal-detail.review.json.gz')
    parser.add_argument('--acv-profile', type=Path, default=ROOT / 'tools/data/ede-mor-acv-profile.json')
    parser.add_argument('--bin-profile', type=Path, default=ROOT / 'tools/data/ede-mor-bin-profile.json')
    parser.add_argument('--playground-survey', type=Path, default=ROOT / 'tools/data/ede-playground-pilots.json')
    args = parser.parse_args()
    if not args.snapshot and not args.municipal_snapshot:
        parser.error('Provide a PDOK or municipal snapshot.')
    scene = load_scene()
    town = args.coverage == 'town'
    sites = town_sites(scene['meta']['bounds']) if town else PILOTS | EXTRA if args.coverage == 'expanded' else PILOTS
    affine = scene['meta']['lonLatAffine']
    if args.snapshot:
        gates = args.snapshot / 'gates.json'
        if town and not args.osm and not gates.exists():
            parser.error('Provide local province extracts with --osm for mapped gate openings.')
        if args.fetch:
            fetch(args.snapshot, sites, affine, args.date.isoformat(), town, args.osm)
        if town and not gates.exists():
            extract_gates(args.snapshot, args.osm, geographic_bounds(scene['meta']['bounds'], affine))
        if town and args.station_ahn:
            fetch_station_heights(args.snapshot, affine)
        day = args.date.isoformat()
        snapshot = json.loads((args.snapshot / 'snapshot.json').read_bytes())
        if snapshot['date'] != day or any(snapshot['sites'].get(site) != list(bounds) for site, bounds in sites.items()):
            parser.error('Snapshot date or site bounds differ. Use the original options or run --fetch.')
        asset, review = bake(args.snapshot, sites, scene, day, town)
        if town and not args.skip_land:
            review['landMask'] = bake_land(args.snapshot, sites, scene, day, args.land_output)
        write_json(args.output, asset)
        write_json(args.review, review)
        print(f"Ede BGT street detail: {len(asset['features'])} placements, {len(review['reviews'])} review records")
        print(review['placements'])

    if args.municipal_snapshot:
        import ede_municipal_detail as municipal
        from ede_map import load_playable_boundary, load_playable_scene

        playable = load_playable_scene()
        boundary = load_playable_boundary()
        if args.fetch:
            municipal.fetch(args.municipal_snapshot, playable['meta']['geographicBounds'])
        base = municipal.read_json(args.output)
        profiles = municipal.read_json(args.acv_profile) if args.acv_profile.is_file() else {}
        survey = municipal.read_json(args.playground_survey) if args.playground_survey.is_file() else {}
        bins = municipal.read_json(args.bin_profile) if args.bin_profile.is_file() else {}
        municipal_asset, audit = municipal.bake(
            args.municipal_snapshot, playable, boundary, base, globals(), profiles, survey, bins)
        write_json(args.municipal_output, municipal_asset)
        write_json(args.municipal_review, audit)
        print(f"Ede municipal detail: {len(municipal_asset['features'])} placements, {len(audit['playSites'])} play sites")
        print(audit['counts'])


if __name__ == '__main__':
    main()
