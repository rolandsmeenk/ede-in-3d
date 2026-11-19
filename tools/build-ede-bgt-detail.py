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
import subprocess
from urllib.parse import urlencode
from xml.etree import ElementTree

from shapely import STRtree, make_valid, union_all
from shapely.affinity import rotate, translate
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import nearest_points

from ede_map import load_scene

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
    'vegetatieobject_lijn', 'vegetatieobject_vlak', 'scheiding_lijn', 'scheiding_vlak',
    'straatmeubilair', 'paal', 'begroeidterreindeel', 'ondersteunendwaterdeel', 'waterdeel',
)
FURNITURE = {'bank': 'bench', 'fietsenrek': 'bikeRack', 'abri': 'shelter',
             'speelvoorziening': 'playground', 'bolder': 'bollard'}
DIMENSIONS = {'bench': (1.5, .58, .82), 'bikeRack': (.72, .58, .78),
              'shelter': (3.2, 1.25, 2.35), 'playground': (1.3, 1.1, 1.65),
              'bollard': (.18, .18, .85), 'hedge': (.0, .75, 1.1),
              'fence': (.0, .1, 1.25), 'waterEdge': (.0, .35, .15)}
WALK_PATHS = {'footway', 'cycleway', 'path', 'pedestrian', 'steps', 'bridleway', 'track'}
GATE_TAGS = 'gate|lift_gate|swing_gate|kissing_gate|entrance|cycle_barrier'


def geographic_bounds(bounds, affine):
    x0, x_lon, x_lat = affine['x']
    z0, z_lon, z_lat = affine['z']
    determinant = x_lon * z_lat - x_lat * z_lon
    min_x, min_z, max_x, max_z = bounds
    corners = []
    for x in (min_x, max_x):
        for z in (min_z, max_z):
            dx, dz = x - x0, z - z0
            corners.append((affine['lon0'] + (dx * z_lat - dz * x_lat) / determinant,
                            affine['lat0'] + (dz * x_lon - dx * z_lon) / determinant))
    lons, lats = zip(*corners)
    return min(lons), min(lats), max(lons), max(lats)


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
                                           'Slop Ede offline street-detail importer (github.com/rolandsmeenk/slop-ede)', url])
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


def fetch(directory, sites, affine, day):
    directory.mkdir(parents=True, exist_ok=True)
    jobs = [(site, collection, geographic_bounds(bounds, affine))
            for site, bounds in sites.items() for collection in COLLECTIONS]

    def fetch_one(job):
        site, collection, bounds = job
        _, features = BGT['fetch_tile'](collection, bounds, day)
        write_json(directory / f'{site}-{collection}.geojson', {
            'type': 'FeatureCollection', 'features': features,
        })
        return site, collection, len(features)

    with ThreadPoolExecutor(max_workers=8) as pool:
        gate_job = pool.submit(fetch_gates, directory, sites, affine)
        for site, collection, count in pool.map(fetch_one, jobs):
            print(f'{site} {collection}: {count}', flush=True)
        gate_job.result()
    write_json(directory / 'snapshot.json', {'date': day, 'sites': sites})


def read_records(directory, sites, day):
    for collection in COLLECTIONS:
        latest = {}
        for site in sites:
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
    if collection.startswith('scheiding') and tag == 'hek':
        return 'fence'
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
    if collection == 'ondersteunendwaterdeel' or collection == 'waterdeel':
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


def build_evidence(scene, area):
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
    trees.extend(Point(x / 5, z / 5) for x, z, *_ in struct.iter_unpack('<hhHBBB', (ROOT / 'assets/ede-trees.bin').read_bytes()[8:]))
    lamp_data = gzip.decompress((ROOT / 'assets/ede-lamps.bin.gz').read_bytes())
    if lamp_data[:4] != b'EDL2':
        raise ValueError('Unrecognized Ede lamp inventory')
    lamps = [Point(x / 5, z / 5) for x, z, _, _, _, _, _, level in struct.iter_unpack('<hhhHhHBb', lamp_data[8:])
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
        points = [usable.representative_point()]
        for z in range(math.ceil(z0 / spacing), math.floor(z1 / spacing)+1):
            for x in range(math.ceil(x0 / spacing), math.floor(x1 / spacing)+1):
                point = Point(x * spacing, z * spacing)
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
            yield {'points': points, 'width': width, 'height': DIMENSIONS[kind][2], 'collidable': kind == 'fence'}
    for polygon in parts(keep, 'Polygon'):
        if polygon.area < .4:
            continue
        polygon = polygon.simplify(.1, preserve_topology=True)
        yield {'polygon': [round_xy(p) for p in list(polygon.exterior.coords)[:-1]],
               'holes': [[round_xy(p) for p in list(ring.coords)[:-1]] for ring in polygon.interiors],
               'height': DIMENSIONS[kind][2]}


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


def matched_deck(item, level, decks):
    if 'position' in item:
        shape = Point(item['position'])
    elif 'points' in item:
        shape = LineString(item['points'])
    else:
        shape = Polygon(item['polygon'], item.get('holes', ()))
    # Require the whole feature to fit a single surveyed deck footprint. A 0.1 m margin allows source rounding.
    matches = [identity for identity, deck_level, area in decks if level == deck_level and area.covers(shape)]
    return matches[0] if len(matches) == 1 else None


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


def bake(directory, sites, scene, day):
    affine = scene['meta']['lonLatAffine']
    site_areas = {key: box(*bounds) for key, bounds in sites.items()}
    area = union_all(list(site_areas.values())).intersection(box(*scene['meta']['bounds']))
    roads, road_tree, boarding, structures, structure_tree, trees, lamps, buildings = build_evidence(scene, area.buffer(25))
    gates, gate_date = load_gates(directory, affine, area)
    stops = {key: point for key, point, _ in boarding}
    decks = []
    for structure in json.loads((ROOT / 'assets/ede-bgt.json').read_bytes())['structures']:
        if structure['kind'] != 'deck' or not structure.get('axis'):
            continue
        deck = union_all([flat_polygon(outer, holes) for outer, *holes in structure['polygons']])
        if deck.intersects(area):
            decks.append((structure['ids'][0], structure['layer'], deck.buffer(.1)))
    records = list(read_records(directory, sites, day))
    playable = box(*scene['meta']['bounds'])
    mapped_water = union_all([BGT['world_geometry'](raw, affine, playable) for collection, _, raw in records
                              if collection == 'waterdeel'])
    mapped_banks = []
    features, reviews = [], []
    inventory, site_counts = Counter(), defaultdict(Counter)
    known = {}
    for collection, identity, raw in records:
        prop = raw['properties']
        kind = classify(collection, prop)
        geometry = BGT['world_geometry'](raw, affine, area)
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
        route_clear = union_all([row[3] for row in nearby])
        old_assets = union_all([structures[i][1] for i in structure_tree.query(geometry, predicate='dwithin', distance=.55)
                                if structures[i][0] == level])
        matched_gates = [row for row in gates if row[1] == level and geometry.distance(row[2]) <= .65]
        review_point = geometry.representative_point()
        info = {'id': identity, 'type': kind, 'level': level, 'site': covered, 'collection': collection,
                'position': round_xy((review_point.x, review_point.y)),
                'registered': prop['tijdstip_registratie'], 'created': prop.get('creation_date'),
                'published': prop.get('lv_publicatiedatum')}
        if kind in {'hedge', 'fence'}:
            if matched_gates:
                reviews.append({**info, 'reason': 'preserved-gate-opening', 'nodeIds': [row[0] for row in matched_gates]})
            conflicting = sorted({row[0] for row in nearby if row[3].buffer(DIMENSIONS[kind][1] / 2).intersects(geometry)})
            if conflicting:
                reviews.append({**info, 'reason': 'trimmed-route-conflict', 'wayIds': conflicting})
            if geometry.intersects(old_assets.buffer(.4)):
                reviews.append({**info, 'reason': 'trimmed-existing-structure'})
            placement = list(is_native_fence(geometry.difference(old_assets.buffer(.4)), kind, route_clear, matched_gates))
        elif kind in {'groundCover', 'shrub'}:
            avoidance = route_clear.buffer(.45).union(old_assets.buffer(.3))
            placement = list(points_on_planting(geometry, kind, avoidance, trees))
        elif kind == 'waterEdge':
            # Use the original exterior shoreline, never the artificial pilot clip edge.
            original = BGT['world_geometry'](raw, affine, playable)
            shoreline = union_all([polygon.exterior for polygon in parts(original, 'Polygon')])
            shoreline = shoreline.intersection(area).intersection(route_clear.buffer(9)).difference(route_clear.buffer(.5))
            shoreline = shoreline.difference(old_assets.buffer(.75))
            if collection == 'ondersteunendwaterdeel':
                shoreline = shoreline.intersection(mapped_water.boundary.buffer(.85))
                if not shoreline.is_empty:
                    mapped_banks.append(shoreline.buffer(.7))
            elif mapped_banks:
                shoreline = shoreline.difference(union_all(mapped_banks))
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
            if level:
                deck_id = matched_deck(item, level, decks)
                if not deck_id:
                    reviews.append({**info, 'reason': 'unverified-elevation', 'pieceId': piece_id,
                                    'position': item.get('position') or (item.get('points') or item['polygon'])[0]})
                    continue
                item['surfaceId'] = deck_id
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
    parser.add_argument('snapshot', type=Path)
    parser.add_argument('--fetch', action='store_true', help='download a dated PDOK snapshot first')
    parser.add_argument('--date', type=date.fromisoformat, default=date.today())
    parser.add_argument('--coverage', choices=('pilot', 'expanded'), default='pilot')
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/ede-bgt-detail.json.gz')
    parser.add_argument('--review', type=Path, default=ROOT / 'tools/data/ede-bgt-detail.review.json')
    args = parser.parse_args()
    scene = load_scene()
    sites = PILOTS | EXTRA if args.coverage == 'expanded' else PILOTS
    if args.fetch:
        fetch(args.snapshot, sites, scene['meta']['lonLatAffine'], args.date.isoformat())
    day = args.date.isoformat()
    snapshot = json.loads((args.snapshot / 'snapshot.json').read_bytes())
    if snapshot['date'] != day or any(snapshot['sites'].get(site) != list(bounds) for site, bounds in sites.items()):
        parser.error('Snapshot date or site bounds differ. Use the original options or run --fetch.')
    asset, review = bake(args.snapshot, sites, scene, day)
    write_json(args.output, asset)
    write_json(args.review, review)
    print(f"Ede BGT street detail: {len(asset['features'])} placements, {len(review['reviews'])} review records")
    print(review['placements'])


if __name__ == '__main__':
    main()
