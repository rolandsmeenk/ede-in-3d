#!/usr/bin/env python3
"""Inventory structures inside the Ede scene bounds using OSM and BGT geometry."""

import argparse
from collections import Counter, defaultdict
import json
import math
from pathlib import Path

from shapely import STRtree, make_valid, union_all
from shapely.affinity import affine_transform
from shapely.geometry import LineString, MultiPoint, Point, Polygon, box, shape

from ede_map import MAP_ASSET, load_scene
from ede_scene import SceneAffine

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'tools/data'
ASSETS = ROOT / 'assets'
OSM_SNAPSHOT = DATA / 'ede-crossing-osm.json'
BGT_TUNNELS = DATA / 'ede-crossing-tunnels.geojson'
ROAD_KINDS_IGNORED = {'proposed', 'construction', 'platform', 'bus_stop', 'elevator', 'raceway'}
WATER_KINDS = {'canal', 'river', 'stream', 'ditch', 'drain'}
RAIL_KINDS = {'rail', 'light_rail', 'tram', 'subway'}

# Keep the original audit order and distinguish parallel carriageways and paths.
# These are crossing cores. The grade asset separately records approach shapes.
KNOWN = [
    ('albertstunnel', 'Albertstunnel', 'underpass',
     '1304920665 431657554 1052080205 227837719 1052080207', '6952984 1063323754 25098905 1063323753'),
    ('westtunnel', 'Westtunnel', 'underpass',
     '431657554 431639755 227837719 1052080207 1385637309', '1549283975 1287248249'),
    ('oosttunnel', 'Oosttunnel', 'underpass',
     '431657554 1052080205 431638734 1052080207 1363871988 1409776591', '1507807928'),
    ('koepeltunnel', 'Koepeltunnel', 'underpass',
     '458879655 458879659 458879660 458879651', '723960811'),
    ('somatunnel', 'Somatunnel', 'underpass',
     '643484750 643484752 643484754 808419219 959787174', '1030482946 643424674'),
    ('a30-rail-bridge', 'A30 railway viaduct', 'bridge',
     '6960078 6960132 70490957 70490959', '431666247 431666248 189224783'),
    ('keesomtunnel', 'Keesomtunnel', 'underpass',
     '6306101 431660809', '25710948 430622525 25710950 430622524 163607273 421594656'),
    ('keesom-road-decks', 'Noorder Parallelweg and Frankeneng over Keesomtunnel', 'bridge',
     '6955251 6955267 23568241 24802275', '25710948 430622525 25710950 430622524 163607273 421594656'),
    ('sysseltsepad-bridge', 'Sysseltsepad', 'bridge', '1115504037', '431658944 1092211189'),
    ('polar-bearsplein-parking', 'Parking access below Polar Bearsplein', 'underpass',
     '1193451506', '1546549244 1546549246'),
    ('bospoorttunnel', 'Bospoorttunnel at Otterloseweg', 'underpass',
     '6954006 6954256 1285013611 25314081 302727682', '24994852'),
    ('parkweidepad-zuid', 'Parkweidepad Zuid', 'underpass',
     '925880061 1117906776 6954693 144881731', '363124901'),
    ('stadspoort', 'Stadspoort and Doctor W. Dreeslaan', 'covered-passage',
     '262752271', '25546150 25546154 25546157 25546158'),
    ('frans-halslaan', 'Frans Halslaan over Doctor W. Dreeslaan', 'bridge',
     '25031366 840619077', '6921140 6921141 25546159 25546151'),
    ('raadhuisstraat-passage', 'Raadhuisstraat building passage', 'covered-passage',
     '', '274278314 274278316'),
    ('hoekelum-cycle-tunnel', 'Hoekelum cycle tunnel', 'underpass', '1193458974 1193458975', '1170998332'),
    ('maanderbroek-a30-a12', 'A30 over A12 at Knooppunt Maanderbroek', 'bridge',
     '6960104', '493246904 750476158'),
    ('maanderbroek-link', 'A12 link over A30 and A12 at Knooppunt Maanderbroek', 'bridge',
     '6960110', '6960114 380485855 493246904'),
    ('frankeneng-west-passage', 'Shared road and cycle passage west of Frankeneng', 'underpass',
     '483714717 483714724', '25120568 1392410752'),
    ('galvanistraat-a30', 'A30 over Galvanistraat', 'bridge',
     '6960068 6960069', '6959961 1074368502 45036432'),
    ('n224-a30', 'A30 over N224', 'bridge', '6960119 6960136', '34918095 45036439 24919346'),
    ('maanderbuurtweg-a12', 'Maanderbuurtweg over A12', 'bridge', '6959876 27006606', '199420019 750476158'),
    ('statenpad-a12', 'Statenpad over A12', 'bridge', '26380388', '366343570 405313254 592685423'),
    ('maanderdijk-passage', 'Maanderdijk passage beneath A12 links', 'underpass',
     '1212023123 1212023126', '848069425 993493475'),
    ('de-poortwachter', 'De Poortwachter over A12', 'bridge',
     '6921137 24831859 25551033', '723962249 723962252 805587009 469675212 848069425'),
    ('bovenbuurtweg-a12', 'Bovenbuurtweg over A12', 'bridge', '115834965', '723962245 723962247 787065956'),
    ('parklaan-a12', 'Parklaan under A12', 'underpass', '420569803 509484016', '469675200'),
    ('edeseweg-a12', 'A12 over Edeseweg', 'bridge', '6920863 6920865', '723962409 1281296947 1281296613'),
    ('baron-van-wassenaertunnel', 'Baron van Wassenaertunnel', 'underpass', '6919291 6919294', '6919176'),
]

KNOWN_BGT = {
    'oosttunnel': ['L0004.61d022ae4d604ea69d68ae896bb71c8b'],
    'koepeltunnel': ['L0004.8021e18cafe842bfa83edfcea3461a7b'],
    'somatunnel': ['L0004.fb9b31a1c6c149b6bf4e960c04edc544'],
    'bospoorttunnel': ['G0228.3a511d78757642e0b304baa3d9cf9423'],
    'frans-halslaan': ['G0228.700fe0c98a254dbd819af20bfca6388f'],
    'maanderbroek-a30-a12': ['L0002.e467d67f4f5a48aa8585c8c5262631e2'],
    'maanderbroek-link': ['L0002.6ec5b0cd61a04e1d84ddc0ea09f67fd2'],
    'frankeneng-west-passage': ['G0228.32fc3227bf3a4c66929a44b29a7786f4'],
    'galvanistraat-a30': ['L0002.518f5bbc876446ffafbcfa30fa81f146'],
    'n224-a30': ['L0002.2573aa9218024f128d65b5e87a70ffaf'],
    'maanderbuurtweg-a12': ['G0228.5b4d62846acf4d8583e58aceea0b9f2f'],
    'statenpad-a12': ['G0228.c6922d2214d545bd940c60dfe183829a'],
    'maanderdijk-passage': ['G0228.dec5411415274a62972f491067649e3f'],
    'de-poortwachter': ['P0025.b0bfa821bc3d48d9ada3988a6111fc49'],
    'bovenbuurtweg-a12': ['G0228.c4590e9df88c4ee0b05ae3ab7ddd7298'],
    'parklaan-a12': ['G0228.7a08be34c7c84b6eaf9bf1d382c4f3af'],
    'edeseweg-a12': ['L0002.d9669594c77a4ef6b37ee58d90557562'],
    'baron-van-wassenaertunnel': ['G0228.5bdf19670017480b8171396ea7fb7bca'],
}


def read_json(path):
    return json.loads(path.read_text())


def pairs(flat):
    return zip(flat[::2], flat[1::2])


def point_coords(point):
    return [round(point.x, 2), round(point.y, 2)]


def sorted_ids(values):
    return sorted(set(values), key=lambda value: (value[0], int(value[1:])))


def intersections(a, b, area):
    intersection = a.intersection(b)
    points = [intersection] if intersection.geom_type == 'Point' else getattr(intersection, 'geoms', ())
    return [p for p in points if p.geom_type == 'Point' and not p.is_empty and area.covers(p)
            and (p.distance(a.boundary) > .25 or p.distance(b.boundary) > .25)]


def middle(line):
    return line.interpolate(.5, normalized=True)


def make_site(key, name, kind, status, center, upper, lower, ways, evidence, **fields):
    upper, lower = sorted_ids(upper), sorted_ids(lower)
    routes = []
    for side, ids in (('upper', upper), ('lower', lower)):
        for way_id in ids:
            way = ways[way_id]
            routes.append({'id': f'{side}-{way_id}', 'side': side, 'wayIds': [way_id],
                           'kind': way['kind'], 'layer': way['layer'],
                           **({'name': way['name']} if way.get('name') else {}),
                           **({'source': 'osm-supplement'} if way.get('supplemental') else {})})
    return {'id': key, 'name': name, 'kind': kind, 'status': status, 'center': point_coords(center),
            'wayIds': sorted_ids(upper + lower), 'upperWayIds': upper, 'lowerWayIds': lower,
            'bgtIds': sorted(evidence.get('bgt', [])), 'evidence': evidence, 'routes': routes, **fields}



def make_projection(affine):
    frame = SceneAffine(affine)
    return frame.lon_lat_to_scene, frame.shapely_coefficients()


def flag(tags, key):
    return bool(tags.get(key) and tags[key] != 'no')


def encode_snapshot(metadata, rows, field):
    header = json.dumps(metadata, ensure_ascii=False, indent=2).removesuffix('\n}')
    encoded = ',\n'.join('    ' + json.dumps(row, ensure_ascii=False, separators=(',', ':')) for row in rows)
    return header + f',\n  "{field}": [\n' + encoded + '\n  ]\n}\n'


def refresh_osm(paths, scene):
    import osmium

    project, _ = make_projection(scene['meta']['lonLatAffine'])
    area = box(*scene['meta']['bounds'])
    south, west, north, east = scene['meta']['geographicBounds']
    rows = {}
    level_nodes = {}
    snapshots = {}
    saved_tags = {'name', 'ref', 'highway', 'railway', 'waterway', 'building', 'layer', 'bridge',
                  'covered', 'tunnel', 'access', 'service', 'indoor', 'level', 'area', 'ford', 'maxheight'}

    class Extract(osmium.SimpleHandler):
        def node(self, node):
            if node.tags.get('railway') not in {'level_crossing', 'crossing'}:
                return
            lon, lat = node.location.lon, node.location.lat
            if area.covers(Point(project(lon, lat))):
                level_nodes[node.id] = {'id': node.id, 'lon': lon, 'lat': lat, 'tags': dict(node.tags)}

        def way(self, way):
            tags = way.tags
            transport = tags.get('highway') or tags.get('railway') in RAIL_KINDS
            structural = any(flag(tags, key) for key in ('bridge', 'tunnel', 'covered'))
            if not (tags.get('waterway') in WATER_KINDS or tags.get('building') == 'roof'
                    or transport and (structural or flag(tags, 'ford'))):
                return
            points = [(n.lon, n.lat) for n in way.nodes if n.location.valid()]
            if len(points) != len(way.nodes) or len(points) < 2:
                return
            lons, lats = zip(*points)
            if max(lons) < west or min(lons) > east or max(lats) < south or min(lats) > north:
                return
            if not LineString([project(*p) for p in points]).intersects(area):
                return
            rows[way.id] = {'id': f'w{way.id}', 'tags': {k: tags[k] for k in sorted(saved_tags) if k in tags},
                            'geometry': points}

    for path in paths:
        with osmium.io.Reader(str(path)) as reader:
            header = reader.header()
            snapshots[path.name] = header.get('osmosis_replication_timestamp') or header.get('timestamp') or 'unavailable'
        Extract().apply_file(str(path), locations=True)
    metadata = {'source': 'https://download.geofabrik.de/europe/netherlands.html', 'license': 'ODbL 1.0',
                'snapshots': snapshots, 'levelNodes': [level_nodes[key] for key in sorted(level_nodes)]}
    OSM_SNAPSHOT.write_text(encode_snapshot(metadata, [rows[key] for key in sorted(rows)], 'ways'))


def polygon(record):
    return make_valid(Polygon(list(pairs(record['ring'])), [list(pairs(hole)) for hole in record['holes']]))


def transport_layers(way):
    try:
        return int(way.get('layer', ''))
    except ValueError:
        return 1 if flag(way, 'bridge') else -1 if flag(way, 'tunnel') else 0


def load_context(scene, area):
    project, matrix = make_projection(scene['meta']['lonLatAffine'])
    supplemental = read_json(OSM_SNAPSHOT)
    raw = {w['id']: w['tags'] for w in supplemental['ways']}
    ways = {w['id']: {**w, 'osmTags': raw.get(w['id'], {})}
            for w in scene['roads'] + scene['railways'] if len(w['pts']) >= 4}
    lines = {key: LineString(list(pairs(w['pts']))) for key, w in ways.items()}
    waterways, roofs = [], []
    for row in supplemental['ways']:
        key, tags = row['id'], row['tags']
        coords = [project(*point) for point in row['geometry']]
        if tags.get('waterway') in WATER_KINDS:
            waterways.append((key, tags, LineString(coords)))
        if tags.get('building') == 'roof' and len(coords) >= 4 and coords[0] == coords[-1]:
            roofs.append((key, tags, make_valid(Polygon(coords))))
        kind = tags.get('highway') or tags.get('railway')
        if (key in ways or not kind or kind in ROAD_KINDS_IGNORED or tags.get('area') == 'yes'
                or not any(flag(tags, field) for field in ('bridge', 'tunnel', 'covered'))):
            continue
        ways[key] = {'id': key, 'name': tags.get('name', ''), 'kind': kind, 'osmTags': tags,
                     'layer': transport_layers(tags), 'bridge': flag(tags, 'bridge'),
                     'tunnel': flag(tags, 'tunnel') or flag(tags, 'covered'),
                     'tunnelType': tags.get('tunnel') or tags.get('covered'), 'supplemental': True}
        lines[key] = LineString(coords)

    bgt = read_json(ASSETS / 'ede-bgt.json')
    structures = []
    for item in bgt['structures']:
        if item['kind'] == 'deck':
            polys = [Polygon(list(pairs(shell)), [list(pairs(hole)) for hole in holes])
                     for shell, *holes in item['polygons']]
            axis = LineString(list(pairs(item['axis']))) if item.get('axis') else None
            structures.append((item['ids'], 'bridge', item['layer'], make_valid(union_all(polys)), axis))
    tunnels = read_json(BGT_TUNNELS)
    for feature in tunnels['features']:
        p = feature['properties']
        if p['status'] == 'bestaand':
            geom = make_valid(affine_transform(shape(feature['geometry']), matrix)).intersection(area)
            if not geom.is_empty:
                structures.append(([p['lokaal_id']], 'underpass', p['relatieve_hoogteligging'], geom, None))
    buildings = [(b['id'], b, polygon(b)) for b in scene['buildings']]
    buildings += roofs
    waters = [(w['id'], w, polygon(w)) for w in scene['water']]
    return ways, lines, structures, buildings, waters, waterways, supplemental, bgt['source']


def known_sites(grade, area, ways, lines):
    existing = {s['id']: s for s in grade['sites']}
    sites = []
    for number, (key, name, kind, upper, lower) in enumerate(KNOWN, 1):
        upper, lower = ([f'w{i}' for i in ids.split()] for ids in (upper, lower))
        crossing = [point for u in upper for l in lower for point in intersections(lines[u], lines[l], area)]
        fallback = [middle(lines[i].intersection(area)) for i in (upper if kind == 'bridge' else lower)]
        center = MultiPoint(crossing or fallback).centroid
        profile = existing.get(key) or existing.get(f'{key}-lower') or existing.get(f'{key}-upper') or {}
        evidence = profile.get('evidence', {}).copy()
        evidence['inventory'] = number
        if key in KNOWN_BGT:
            evidence['bgt'] = sorted(set(evidence.get('bgt', ())) | set(KNOWN_BGT[key]))
        sites.append(make_site(key, name, kind, 'existing-profile' if profile else 'known-unfitted',
                               center, upper, lower, ways, evidence,
                               crossings=[{'upperWayId': u, 'lowerWayId': l, 'center': point_coords(point)}
                                          for u in upper for l in lower
                                          for point in intersections(lines[u], lines[l], area)]))
    for site in existing.values():
        if site['kind'] != 'level':
            continue
        controls = site['controls'] if isinstance(site['controls'], list) else [site['controls']]
        road = [way_id for control in controls for way_id in control.get('roadWayIds', [])]
        road += [way_id for profile in site['profiles'] for way_id in profile['wayIds']]
        rail = [control['railWayId'] for control in controls if 'railWayId' in control]
        rail += [way_id for control in controls for way_id in control.get('railWayIds', [])]
        center = MultiPoint([(c['x'], c['z']) for c in controls]).centroid
        record = make_site(site['id'], site['name'], 'level', 'existing-profile', center, [], [], ways, site['evidence'],
                           roadWayIds=sorted_ids(road), railWayIds=sorted_ids(rail), controls=controls)
        record['wayIds'] = sorted_ids(road + rail)
        record['routes'] = [
            {'id': way_id, 'side': 'level', 'wayIds': [way_id], 'kind': ways[way_id]['kind']}
            for way_id in record['wayIds']
        ]
        sites.append(record)
    assert len(sites) == len(KNOWN) + 14
    return sites


def line_parts(geom):
    if geom.geom_type == 'LineString':
        return [geom] if not geom.is_empty else []
    return [line for line in getattr(geom, 'geoms', []) if line.geom_type == 'LineString' and not line.is_empty]


def spans(line, footprint, length):
    for part in line_parts(line.intersection(footprint)):
        if part.length >= length and part.boundary.distance(line.boundary) > .25:
            yield part


def aligned_with_axis(part, axis):
    a, b = part.coords[0], part.coords[-1]
    c, d = axis.coords
    dot = (b[0] - a[0]) * (d[0] - c[0]) + (b[1] - a[1]) * (d[1] - c[1])
    return abs(dot) >= .9 * math.dist(a, b) * axis.length


def discover(area, ways, lines, structures, buildings, water, waterways):
    line_ids = [key for key, line in lines.items() if line.intersects(area)]
    line_tree = STRtree([lines[key] for key in line_ids])
    building_tree = STRtree([item[2] for item in buildings])
    water_tree = STRtree([item[2] for item in water])
    channel_tree = STRtree([item[2] for item in waterways])
    hits = []

    def hit(kind, point, upper=(), lower=(), **evidence):
        hits.append({'kind': kind, 'point': point, 'upper': set(upper), 'lower': set(lower),
                     **{key: set(values) for key, values in evidence.items()}})

    for key in line_ids:
        way, line = ways[key], lines[key]
        if line.is_ring and not (way['tunnel'] or way['bridge']):
            continue
        tags = way['osmTags']
        passage = way.get('tunnelType') in {'building_passage', 'covered', 'yes'}
        building_hits = []
        for i in sorted(building_tree.query(line, predicate='intersects')):
            building_id, record, footprint = buildings[i]
            clipped = line.intersection(footprint)
            if clipped.length > .5:
                building_hits.append((building_id, record, footprint))
        water_hits = []
        for i in sorted(water_tree.query(line, predicate='intersects')):
            water_id, _, footprint = water[i]
            if line.intersection(footprint).length >= 2:
                water_hits.append((water_id, footprint))
        channel_hits = []
        for i in sorted(channel_tree.query(line, predicate='intersects')):
            channel_id, channel_tags, channel = waterways[i]
            if flag(channel_tags, 'tunnel') or flag(channel_tags, 'covered'):
                continue
            for point in intersections(line, channel, area):
                if point.distance(channel.boundary) > .5:
                    channel_hits.append((channel_id, channel_tags, point))

        if way['tunnel'] or way['bridge']:
            parts = line_parts(line.intersection(area))
            if not parts:
                continue
            point = middle(max(parts, key=lambda part: part.length))
            if way.get('tunnelType') == 'building_passage' or way['tunnel'] and (
                    flag(tags, 'covered') and not way['bridge'] or passage and way.get('tunnelType') == 'covered'):
                kind = 'covered-passage'
            else:
                kind = 'bridge' if way['bridge'] else 'underpass'
            upper = [key] if kind == 'bridge' else []
            lower = [key] if kind != 'bridge' else []
            hit(kind, point, upper, lower, tagged=[key], building=[i for i, _, _ in building_hits],
                water=[i for i, _ in water_hits] + [i for i, _, _ in channel_hits])
        elif not flag(tags, 'ford') and way['kind'] not in RAIL_KINDS:
            # Geometric overlap can also indicate an indoor route, foreshore mapping, or a culvert.
            for building_id, record, footprint in building_hits:
                roof = record.get('building') == 'roof'
                minimum = 3 if roof else 6
                for part in spans(line, footprint, minimum):
                    point = middle(part)
                    if area.covers(point):
                        hit('covered-passage', point, lower=[key], building=[building_id], basis=['footprint-overlap'])
            for water_id, footprint in water_hits:
                for part in spans(line, footprint, 3):
                    point = middle(part)
                    if area.covers(point):
                        hit('bridge', point, upper=[key], water=[water_id], basis=['water-footprint-overlap'])
            for channel_id, channel_tags, point in channel_hits:
                if channel_tags['waterway'] in {'river', 'canal', 'stream'} and point.distance(line.boundary) > .75:
                    hit('bridge', point, upper=[key], water=[channel_id], basis=['open-waterway-intersection'])

        for i in sorted(line_tree.query(line, predicate='intersects')):
            other = line_ids[i]
            if other <= key or ways[other]['layer'] == way['layer']:
                continue
            upper, lower = (key, other) if way['layer'] > ways[other]['layer'] else (other, key)
            above, below = ways[upper], ways[lower]
            # A junction sharing an OSM node can join different mapped layers at a portal/ramp.
            if set(above.get('nodeIds', ())).intersection(below.get('nodeIds', ())):
                continue
            if below.get('tunnelType') in {'building_passage', 'covered'}:
                kind = 'covered-passage'
            else:
                kind = 'underpass' if below['tunnel'] else 'bridge'
            for point in intersections(line, lines[other], area):
                hit(kind, point, [upper], [lower], basis=['different-mapped-layers'])

    for ids, kind, layer, geometry, axis in structures:
        if not area.intersects(geometry):
            continue
        matches = []
        for i in sorted(line_tree.query(geometry, predicate='intersects')):
            key = line_ids[i]
            way = ways[key]
            overlap = geometry.intersection(lines[key])
            matches.extend((part.length, key, part) for part in line_parts(overlap) if part.length >= 1.5)
        expected = [
            (length, key, part) for length, key, part in matches
            if (kind == 'bridge' and ways[key]['bridge'] and not ways[key]['tunnel']
                or kind == 'underpass' and (ways[key]['tunnel'] or ways[key]['layer'] == layer))
        ]
        aligned = expected or [
            (length, key, part) for length, key, part in matches
            if length >= 4 and (ways[key]['layer'] == layer
                                or axis and axis.length > 1 and length >= .6 * axis.length and aligned_with_axis(part, axis))
        ]
        if aligned:
            point = middle(max(aligned, key=lambda row: row[0])[2])
        else:
            point = geometry.representative_point()
        core = [key for length, key, _ in aligned]
        core_nodes = {node for key in core for node in ways[key].get('nodeIds', ())}
        # A way meeting the core at a portal or abutment can overlap the footprint at its edge.
        overlap = [key for length, key, _ in matches
                   if key not in core and not core_nodes.intersection(ways[key].get('nodeIds', ()))
                   and (ways[key]['layer'] < layer if kind == 'bridge' else ways[key]['layer'] > layer)]
        upper, lower = (core, overlap) if kind == 'bridge' else (overlap, core)
        hit(kind, point, upper, lower, bgt=ids, basis=['bgt-footprint-aligned' if aligned else 'bgt-footprint-unmatched'])
    return hits


def tags_for(way):
    tags = way['osmTags']
    tags = {k: tags[k] for k in ('bridge', 'tunnel', 'covered', 'access', 'service', 'ref', 'maxheight') if k in tags}
    if not any(k in tags for k in ('bridge', 'tunnel', 'covered')):
        if way['bridge']:
            tags['bridge'] = 'yes'
        if way['tunnel']:
            tags['tunnel'] = way.get('tunnelType') or 'yes'
    return tags


def hits_evidence(hits, ways):
    evidence = {}
    for key in ('bgt', 'building', 'water', 'basis'):
        values = sorted({value for hit in hits for value in hit.get(key, ())})
        if values:
            evidence[key] = values
    tagged = sorted_ids(value for hit in hits for value in hit.get('tagged', ()))
    if tagged:
        evidence['osmTags'] = {key: tags_for(ways[key]) for key in tagged}
    return evidence


def attach_known(sites, hits, ways):
    known_hits = defaultdict(list)
    unknown = []
    structures = [site for site in sites if site['kind'] != 'level']
    for hit in hits:
        choices = []
        for site in structures:
            distance = hit['point'].distance(Point(site['center']))
            if distance > 76:
                continue
            area_ids = set(site['bgtIds']).intersection(hit.get('bgt', ()))
            same_upper = hit['upper'].intersection(site['upperWayIds'])
            same_lower = hit['lower'].intersection(site['lowerWayIds'])
            core = same_upper if hit['kind'] == 'bridge' else same_lower
            tagged_match = set(site['wayIds']).intersection(hit.get('tagged', ()))
            if area_ids or (core or tagged_match) and distance <= 68 or same_upper and same_lower:
                choices.append((-len(area_ids), -len(core | tagged_match), -len(same_upper | same_lower),
                                distance, site['id']))
        if choices:
            known_hits[min(choices)[-1]].append(hit)
        else:
            unknown.append(hit)
    for site in structures:
        evidence = hits_evidence(known_hits[site['id']], ways)
        if evidence:
            evidence['bgt'] = sorted(set(evidence.get('bgt', ())) | set(site['bgtIds']))
            if not evidence['bgt']:
                del evidence['bgt']
            site['evidence'].update(evidence)
            site['bgtIds'] = evidence.get('bgt', [])
    return unknown


def can_merge(left, right, lines):
    distance = left['point'].distance(right['point'])
    if distance > 45:
        return False
    if left.get('bgt', set()) & right.get('bgt', set()):
        return True
    if left['kind'] != right['kind']:
        return bool(distance < 15 and (left['upper'] & right['upper'] or left['lower'] & right['lower']))
    core_key = 'upper' if left['kind'] == 'bridge' else 'lower'
    if left[core_key] & right[core_key]:
        shared_tag = left[core_key] & right[core_key] & (left.get('tagged', set()) | right.get('tagged', set()))
        return distance <= 16 or bool(distance <= 25 and shared_tag)
    if distance < 10 and left.get('tagged') and right.get('tagged'):
        if any(lines[a].hausdorff_distance(lines[b]) < 10 for a in left['tagged'] for b in right['tagged']):
            return True
    common_roof = left.get('building', set()) & right.get('building', set())
    common_water = left.get('water', set()) & right.get('water', set())
    if common_roof and left.get('tagged') and right.get('tagged'):
        if all(ways_id in left[core_key] | right[core_key] for ways_id in left['tagged'] | right['tagged']):
            # Parallel long aisles beneath one roof belong to the same structure.
            distance_limit = 42 if all(lines[key].length > 40 for key in left['tagged'] | right['tagged']) else 20
            if distance < distance_limit:
                return True
    return bool(common_roof and distance < 12 or common_water and distance < 12)


def merge_hits(hits, lines):
    groups = []
    for hit in hits:
        matches = [group for group in groups if any(can_merge(hit, member, lines) for member in group)]
        if not matches:
            groups.append([hit])
            continue
        for group in matches:
            groups.remove(group)
        groups.append([hit] + [member for group in matches for member in group])
    return groups


def new_sites(hits, ways, lines):
    sites = []
    for group in merge_hits(hits, lines):
        evidence = hits_evidence(group, ways)
        evidence_kinds = evidence.get('basis', [])
        tagged = evidence.get('osmTags', {})
        kind = next((hit['kind'] for hit in group if hit.get('tagged')),
                    next((hit['kind'] for hit in group if hit.get('bgt')), group[0]['kind']))
        upper = set().union(*(hit['upper'] for hit in group))
        lower = set().union(*(hit['lower'] for hit in group))
        tag_centers = [hit['point'] for hit in group if hit.get('tagged')]
        center = MultiPoint(tag_centers or [hit['point'] for hit in group]).centroid
        is_confirmed = bool(tagged or 'bgt-footprint-aligned' in evidence_kinds)
        core = sorted_ids(upper if kind == 'bridge' else lower)
        names = [ways[key].get('name') or ways[key]['osmTags'].get('ref') for key in core
                 if ways[key]['kind'] not in RAIL_KINDS]
        label = next((name for name in names if name), None)
        kind_label = kind.replace('-', ' ')
        if not label:
            label = next((ways[key]['kind'] for key in core), '')
            label = label.replace('_', ' ').capitalize() if label else 'BGT'
        identifier = core[0] if core else evidence.get('bgt', ['unknown'])[0]
        key = f'{kind}-{identifier}-{round(center.x)}-{round(center.y)}'
        sites.append(make_site(key, f'{label} {kind_label}', kind, 'confirmed' if is_confirmed else 'candidate',
                               center, upper, lower, ways, evidence))
    return sorted(sites, key=lambda site: (site['status'] != 'confirmed', site['kind'], site['center']))


def triple_overlaps(surfaces):
    tree = STRtree([geometry for _, _, geometry in surfaces])
    hits = []
    for surface_id, level, geometry in surfaces:
        for j in sorted(tree.query(geometry, predicate='intersects')):
            other_id, other_level, other = surfaces[j]
            if other_level <= level:
                continue
            overlap = geometry.intersection(other)
            if overlap.area <= .01:
                continue
            for k in sorted(tree.query(overlap, predicate='intersects')):
                top_id, top_level, top = surfaces[k]
                if top_level <= other_level:
                    continue
                shared = overlap.intersection(top)
                if shared.area > .01:
                    hits.append({'ids': [surface_id, other_id, top_id], 'layers': [level, other_level, top_level],
                                 'areaM2': round(shared.area, 2), 'center': point_coords(shared.representative_point())})
    return {'surfaceCountsByLayer': dict(sorted(Counter(level for _, level, _ in surfaces).items())),
            'tripleOverlapCount': len(hits), 'tripleOverlaps': hits}


def osm_route_surfaces(area, ways, lines):
    surfaces = []
    for key, way in ways.items():
        if not lines[key].intersects(area) or way['osmTags'].get('access') == 'no':
            continue
        width = way.get('bgt', {}).get('width', way.get('width', 2.9))
        geometry = lines[key].buffer(width / 2, cap_style='flat').intersection(area)
        if geometry.area > 0:
            surfaces.append((key, way['layer'], geometry))
    return surfaces


def bgt_route_surfaces(directory, scene, area):
    _, matrix = make_projection(scene['meta']['lonLatAffine'])
    surfaces = []
    for name in ('wegdeel', 'ondersteunendwegdeel'):
        for f in read_json(directory / f'{name}.geojson')['features']:
            p = f['properties']
            if p['status'] != 'bestaand' or not f['geometry']:
                continue
            function = p.get('plus_functie') or p['functie']
            if name == 'ondersteunendwegdeel' and function not in {'fiets- en voetpad', 'fietspad', 'voetpad', 'ruiterpad'}:
                continue
            geometry = make_valid(affine_transform(shape(f['geometry']), matrix)).intersection(area)
            if geometry.area > .01:
                surfaces.append((p['lokaal_id'], p['relatieve_hoogteligging'], geometry))
    return surfaces


def fitted_overlap_check(grade, area):
    profiles = [(p['id'], p['points'], p['width']) for site in grade['sites'] for p in site['profiles']]
    profiles += [(p['wayId'], p['points'], 2.7) for p in grade['railHeights']]
    lines = [LineString([point[:2] for point in points]) for _, points, _ in profiles]
    footprints = [line.buffer(width / 2, cap_style='flat').intersection(area)
                  for line, (_, _, width) in zip(lines, profiles)]
    tree = STRtree(footprints)

    def elevation(index, point):
        remaining = lines[index].project(point)
        points = profiles[index][1]
        for a, b in zip(points, points[1:]):
            length = math.dist(a[:2], b[:2])
            if 0 < length and remaining <= length:
                return a[2] + (b[2] - a[2]) * remaining / length
            remaining -= length
        return points[-1][2]

    hits = []
    for i, footprint in enumerate(footprints):
        for j in sorted(tree.query(footprint, predicate='intersects')):
            if j <= i:
                continue
            pair = footprint.intersection(footprints[j])
            if pair.area <= .01:
                continue
            for k in sorted(tree.query(pair, predicate='intersects')):
                if k <= j:
                    continue
                overlap = pair.intersection(footprints[k])
                if overlap.area <= .01:
                    continue
                point = overlap.representative_point()
                heights = sorted(elevation(key, point) for key in (i, j, k))
                if min(b - a for a, b in zip(heights, heights[1:])) <= .8:
                    continue
                hits.append(dict(ids=[profiles[key][0] for key in (i, j, k)], center=point_coords(point),
                                 heightsNAP=[round(height + grade['datumNAP'], 2) for height in heights]))
    return {'profiles': len(profiles), 'minimumHeightSeparationM': .8,
            'tripleOverlapCount': len(hits), 'tripleOverlaps': hits}


def build(bgt_road_snapshot=None):
    scene = load_scene()
    area = box(*scene['meta']['bounds'])
    ways, lines, structures, buildings, waters, channels, osm, bgt = load_context(scene, area)
    grade = read_json(ASSETS / 'ede-grade.json')
    sites = known_sites(grade, area, ways, lines)
    hits = discover(area, ways, lines, structures, buildings, waters, channels)
    sites.extend(new_sites(attach_known(sites, hits, ways), ways, lines))

    audited_nodes = {int(node) for site in sites if site['kind'] == 'level' for c in site['controls']
                     for node in (c.get('nodeIds') or [c['nodeId']])}
    unmatched_nodes = [node['id'] for node in osm['levelNodes'] if node['id'] not in audited_nodes]
    assert len({s['id'] for s in sites}) == len(sites)
    assert all(area.covers(Point(s['center'])) for s in sites)
    counts = Counter(s['status'] for s in sites)
    counts['level'] = sum(s['kind'] == 'level' for s in sites)
    counts['knownStructural'] = len(KNOWN)
    sources = {
        'osmScene': {'path': MAP_ASSET, 'ways': len(scene['roads']) + len(scene['railways']),
                     'buildingFootprints': len(scene['buildings']), 'waterPolygons': len(waters)},
        'osmSupplement': {'path': str(OSM_SNAPSHOT.relative_to(ROOT)), 'source': osm['source'], 'date': osm['snapshots'],
                          'ways': len(osm['ways']), 'waterways': len(channels),
                          'osmLevelNodes': len(osm['levelNodes']), 'unmatchedLevelNodes': unmatched_nodes},
        'bgt': {'bridgePath': 'assets/ede-bgt.json', 'tunnelPath': str(BGT_TUNNELS.relative_to(ROOT)),
                'date': bgt['date'], 'bridgeGroups': sum(kind == 'bridge' for _, kind, _, _, _ in structures),
                'tunnelPolygons': sum(kind == 'underpass' for _, kind, _, _, _ in structures)},
        'levelCrossings': {'path': 'assets/ede-grade.json',
                           'source': 'https://maps.prorail.nl/arcgis/rest/services/ProRail_basiskaart/FeatureServer/0'},
    }
    topology = {'minimumSharedAreaM2': .01, 'osm': triple_overlaps(osm_route_surfaces(area, ways, lines)),
                'fitted': fitted_overlap_check(grade, area)}
    if bgt_road_snapshot:
        topology['bgt'] = triple_overlaps(bgt_route_surfaces(bgt_road_snapshot, scene, area))
    return {'version': 1, 'bounds': scene['meta']['bounds'], 'sources': sources, 'counts': dict(counts),
            'topology': topology, 'sites': sites}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=DATA / 'ede-crossing-sites.json')
    parser.add_argument('--bgt-road-snapshot', type=Path, metavar='DIRECTORY',
                        help='also test surveyed BGT road surfaces for three overlapping layers')
    parser.add_argument('--refresh-osm', type=Path, nargs='+', metavar='PBF')
    args = parser.parse_args()
    if args.refresh_osm:
        refresh_osm(args.refresh_osm, load_scene())
    result = build(args.bgt_road_snapshot)
    metadata = {key: value for key, value in result.items() if key != 'sites'}
    args.output.write_text(encode_snapshot(metadata, result['sites'], 'sites'))
    print(json.dumps(result['counts'], sort_keys=True))


if __name__ == '__main__':
    main()
