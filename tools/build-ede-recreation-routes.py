#!/usr/bin/env python3
"""Bake the Doesburgermolenpad and Ede cycle junctions from public map data."""

import argparse
import gzip
import json
from math import hypot
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

from ede_gis import Frame

ROOT = Path(__file__).resolve().parents[1]
WALK_URL = 'https://api.openstreetmap.org/api/0.6/relation/3926312/full.json'
JUNCTION_QUERY = '[out:json][timeout:35];node["rcn_ref"](51.98,5.48,52.19,5.86);out;'
JUNCTION_URL = 'https://overpass-api.de/api/interpreter?' + urlencode({'data': JUNCTION_QUERY})
CYCLE_QUERY = '[out:json][timeout:45];rel["route"="bicycle"]["network"="rcn"](52.011,5.58,52.125,5.79);out geom;'
CYCLE_URL = 'https://overpass-api.de/api/interpreter?' + urlencode({'data': CYCLE_QUERY})
TRAILHEAD = 1252173859
GATES = {'gate', 'swing_gate', 'stile', 'kissing_gate', 'lift_gate'}


def project_osm(frame, node):
    return frame.lon_lat_to_scene(node['lon'], node['lat'])


def bake_walk(document, frame):
    nodes = {e['id']: e for e in document['elements'] if e['type'] == 'node'}
    ways = {e['id']: e['nodes'] for e in document['elements'] if e['type'] == 'way'}
    route = next(e for e in document['elements'] if e['type'] == 'relation' and e['id'] == 3926312)
    members = [ways[m['ref']] for m in route['members'] if m['type'] == 'way' and not m['role']]
    if len(members) < 2 or route['tags'].get('route') != 'hiking':
        raise ValueError('Doesburgermolenpad is missing a main walking loop')
    first = members[0]
    if first[-1] not in (members[1][0], members[1][-1]):
        first = first[::-1]
    path = list(first)
    for way in members[1:]:
        if path[-1] == way[-1]:
            way = way[::-1]
        if path[-1] != way[0]:
            raise ValueError('Doesburgermolenpad main ways are out of order')
        path.extend(way[1:])
    if path[0] != path[-1]:
        raise ValueError('Doesburgermolenpad main loop is open')
    path.pop()
    start = path.index(TRAILHEAD)
    path = path[start:] + path[:start]
    points = [project_osm(frame, nodes[node]) for node in [*path, path[0]]]
    length = LineString(points).length
    if not 8000 < length < 10500:
        raise ValueError(f'Unexpected length for the main walking loop: {length:.1f} m')
    gates = [[i, nodes[ref]['tags']['barrier']] for i, ref in enumerate(path)
             if nodes[ref].get('tags', {}).get('barrier') in GATES]
    return flatten(points), gates, round(length)


def flatten(points):
    return [round(coordinate, 1) for point in points for coordinate in point]


def bake_cycle(links, nodes, frame, boundary):
    if 'remark' in links or 'remark' in nodes:
        raise ValueError('Overpass returned an incomplete cycling snapshot')
    ways = {}
    for route in links['elements']:
        if route['tags'].get('network:type') != 'node_network':
            continue
        for member in route['members']:
            if member['type'] == 'way' and len(member.get('geometry', [])) >= 2:
                ways[member['ref']] = member['geometry']
    paths = []
    for _, coordinates in sorted(ways.items()):
        line = LineString([project_osm(frame, point) for point in coordinates])
        if not line.intersects(boundary):
            continue
        clipped = line.intersection(boundary)
        for part in (clipped.geoms if hasattr(clipped, 'geoms') else [clipped]):
            if part.geom_type == 'LineString' and part.length > 2:
                paths.append(part.simplify(0.6))
    network = unary_union(paths)
    candidates = []
    for node in nodes['elements']:
        number = node.get('tags', {}).get('rcn_ref', '')
        if not (number.isascii() and number.isdecimal() and len(number) <= 2):
            continue
        x, z = project_osm(frame, node)
        point = Point(x, z)
        distance = network.distance(point)
        if boundary.covers(point) and distance < 22:
            candidates.append((distance, node['id'], number, x, z))
    junctions = []
    for _, _, number, x, z in sorted(candidates):
        if any(label == number and (x - jx) ** 2 + (z - jz) ** 2 < 75 ** 2 for label, jx, jz, *_ in junctions):
            continue
        point = Point(x, z)
        line = min(paths, key=lambda path: path.distance(point))
        along = line.project(point)
        before = line.interpolate(max(0, along - 6))
        after = line.interpolate(min(line.length, along + 6))
        dx, dz = after.x - before.x, after.y - before.y
        length = hypot(dx, dz)
        if length > 0:
            junctions.append([number, round(x, 1), round(z, 1), round(dx / length, 5), round(dz / length, 5)])
    return [flatten(path.coords) for path in paths], sorted(junctions)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path, help='Directory for the three public source snapshots')
    parser.add_argument('--fetch', action='store_true', help='Refresh the source snapshots')
    args = parser.parse_args()
    docs = []
    for name, url in [('walk-full', WALK_URL), ('bike-links', CYCLE_URL), ('de-bike', JUNCTION_URL)]:
        path = args.cache / f'ede-route-{name}.json'
        if args.fetch:
            args.cache.mkdir(parents=True, exist_ok=True)
            with urlopen(Request(url, headers={'User-Agent': 'Ede in 3D route data importer/1.0'}), timeout=75) as response:
                data = response.read()
            json.loads(data)
            path.write_bytes(data)
        docs.append(json.loads(path.read_bytes()))
    with gzip.open(ROOT / 'assets/ede-map-v1.json.gz') as source:
        frame = Frame(json.load(source)['meta']['lonLatAffine'])
    with gzip.open(ROOT / 'assets/ede-municipality-v1.json.gz') as source:
        rings = json.load(source)['boundary']
    polygons = [Polygon(list(zip(outer[::2], outer[1::2])),
                        [list(zip(hole[::2], hole[1::2])) for hole in holes]) for outer, *holes in rings]
    boundary = unary_union(polygons).buffer(450)
    walk, gates, length = bake_walk(docs[0], frame)
    cycling, junctions = bake_cycle(docs[1], docs[2], frame, boundary)
    if not cycling or not junctions:
        raise ValueError('No cycling network within Ede’s travel bounds')
    lines = [
        '// Generated by tools/build-ede-recreation-routes.py.',
        '// Walking and cycling data © OpenStreetMap contributors, ODbL.',
        f'export const DOESBURGERMOLENPAD_LENGTH = {length};',
        'export const DOESBURGERMOLENPAD = [',
        *['  ' + ','.join(map(str, walk[i:i + 16])) + ',' for i in range(0, len(walk), 16)],
        '];',
        'export const DOESBURGERMOLENPAD_GATES = ' + json.dumps(gates, separators=(',', ':')) + ';',
        'export const EDE_CYCLE_LINKS = [',
        *['  ' + json.dumps(path, separators=(',', ':')) + ',' for path in cycling],
        '];',
        'export const EDE_CYCLE_JUNCTIONS = [',
        *['  ' + json.dumps(node, separators=(',', ':')) + ',' for node in junctions],
        '];',
    ]
    (ROOT / 'js/ede-recreation-route-data.js').write_text('\n'.join(lines) + '\n')
    print(f'Walking loop: {length} m, {len(gates)} gates. Cycling: {len(cycling)} links, {len(junctions)} junctions.')


if __name__ == '__main__':
    main()
