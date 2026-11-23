#!/usr/bin/env python3
"""Match surveyed Dutch signal hardware to the existing OSM controls."""

import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from functools import cache
import json
import math
from pathlib import Path
from statistics import median
from urllib.parse import parse_qsl, urlencode, urljoin
from urllib.request import urlopen

from shapely import prepare
from shapely.geometry import LineString, Point

from ede_height_field import expansion_collision_path, read_height_field
from ede_gis import Frame, SCENE_NAP_ORIGIN, source_crs
from ede_map import ROOT, load_playable_boundary, load_playable_scene
from ede_motorway_infrastructure import points, project, read_json, segments, snap, write_json
from ede_traffic_geometry import Segment, SegmentIndex

BGT = 'https://api.pdok.nl/lv/bgt/ogc/v1/collections/paal/items'
RWS = 'https://geo.rijkswaterstaat.nl/arcgis/rest/services/GDR/geografische_areaalregistratie/MapServer'
BGT_TYPES = {'poles': 'verkeersregelinstallatiepaal', 'portals': 'portaal'}
SURVEY_TYPES = {'heads': (13, "type='Verkeerslantaarn'"), 'supports': (31, "type LIKE '%ortaal%'")}
MOTOR = 7
# Both heads on the west exit cantilever show a left arrow in the reviewed photo.
LEFT_ARROW_HEADS = {'1gis:13:237719', '1gis:13:496247'}
CENTERED_HEADS_BY_SUPPORT = {
    # The west A30 exit photo shows both shields centered on this cantilever.
    '1gis:31:2102709001': {
        'date': '2022-10-08',
        'url': 'https://112pressroom.nl/wp-content/uploads/2022/10/20221008143848.jpg',
    },
}
REVIEWED_OVERHEAD = ROOT / 'tools/data/ede-reviewed-overhead-signals.json'
# Ede VRI 2 at the hospital. Feet and head spacing traced from paired 2025/2026 PDOK orthophotos.
# Each row is a directed OSM control, its approach way, the two feet and the head positions along the span.
HOSPITAL_GANTRIES = (
    ('northbound', (-1607.6, 2496.1), 'w1055535553', ((-1622.5, 2484.2), (-1597.5, 2480.5)),
     (.26, .41, .54, .66, .80)),
    ('southbound', (-1648.1, 2415.6), 'w1055535551', ((-1657.3, 2429.8), (-1632.3, 2426.2)),
     (.25, .35, .48, .61, .73)),
    ('westbound', (-1588.2, 2433.2), 'w1055715727', ((-1601.3, 2425.4), (-1597.6, 2450.3)),
     (.16, .29, .42, .57, .70)),
    ('eastbound', (-1669.1, 2475.1), 'w1055535552', ((-1655.8, 2463.8), (-1653, 2485.0)),
     (.22, .39, .55, .69)),
)


def fetch(directory, bounds, frame):
    south, west, north, east = bounds
    geographic = ','.join(map(str, (west, south, east, north)))
    es, ns = zip(*(frame.to_rd(lon, lat, 'OGC:CRS84') for lon in (west, east) for lat in (south, north)))
    rd = ','.join(map(str, (math.floor(min(es)) - 5, math.floor(min(ns)) - 5,
                            math.ceil(max(es)) + 5, math.ceil(max(ns)) + 5)))

    def download(job):
        key, url = job
        records, metadata = [], {}
        while url:
            with urlopen(url, timeout=60) as response:
                data = json.load(response)
            if 'features' not in data:
                raise ValueError(f'Incomplete {key} survey: {data.get("error")}')
            if not metadata:
                metadata = {k: data[k] for k in ('type', 'crs', 'spatialReference', 'timeStamp', 'hasZ') if k in data}
            records.extend(data['features'])
            if data.get('exceededTransferLimit'):
                if not data['features']:
                    raise ValueError(f'Empty page in {key} survey')
                endpoint, _, query = url.partition('?')
                query = [(name, value) for name, value in parse_qsl(query) if name != 'resultOffset']
                url = f"{endpoint}?{urlencode([*query, ('resultOffset', len(records))])}"
            else:
                url = next((urljoin(url, link['href']) for link in data.get('links', ()) if link.get('rel') == 'next'), None)
        write_json(directory / f'{key}.json', {**metadata, 'features': records})

    jobs = []
    for key, kind in BGT_TYPES.items():
        params = {'bbox': geographic, 'plus_type': kind, 'limit': 1000, 'f': 'json'}
        jobs.append((key, f'{BGT}?{urlencode(params)}'))
    for key, (layer, where) in SURVEY_TYPES.items():
        params = {'geometry': rd, 'geometryType': 'esriGeometryEnvelope', 'inSR': 28992, 'outSR': 28992,
                  'where': where, 'returnZ': 'true', 'outFields': '*', 'orderByFields': 'objectid',
                  'resultRecordCount': 1000, 'f': 'json'}
        jobs.append((key, f'{RWS}/{layer}/query?{urlencode(params)}'))
    directory.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=len(jobs)) as pool:
        list(pool.map(download, jobs))


class TerrainGrid:
    def __init__(self, path):
        self.cols, self.rows, self.x, self.z, self.step, datum, self.heights = read_height_field(path)
        if round(datum, 2) != SCENE_NAP_ORIGIN:
            raise ValueError(f'Invalid AHN grid or NAP datum: {path}')

    def at(self, x, z):
        cx, cz = (x - self.x) / self.step, (z - self.z) / self.step
        lo_x, lo_z = math.floor(cx), math.floor(cz)
        if not (0 <= lo_x < self.cols - 1 and 0 <= lo_z < self.rows - 1):
            return None
        u, v = cx - lo_x, cz - lo_z
        i = lo_z * self.cols + lo_x
        a, b = self.heights[i:i + 2]
        c, d = self.heights[i + self.cols:i + self.cols + 2]
        if u + v <= 1:
            return (a + (b - a) * u + (c - a) * v) / 100
        return (d + (c - d) * (1 - u) + (b - d) * (1 - v)) / 100


def active_poles(document, day, frame, in_bounds):
    crs = source_crs(document)
    active = {}
    for feature in document['features']:
        props = feature['properties']
        if props.get('status') != 'bestaand' or props.get('plus_status') in ('plan', 'historie'):
            continue
        if any((props.get(k) or '9999')[:10] <= day for k in ('termination_date', 'eind_registratie')):
            continue
        coordinates = feature['geometry']['coordinates']
        point = frame.to_scene(*coordinates[:2], crs, axis_order='xy')
        if not in_bounds(point):
            continue
        identity = props['lokaal_id']
        registered = props['tijdstip_registratie']
        value = (registered, point, props['relatieve_hoogteligging'])
        if identity not in active or registered > active[identity][0]:
            active[identity] = value
    return sorted((point, identity, level) for identity, (_, point, level) in active.items())


def observed_z(z):
    return isinstance(z, (int, float)) and -10 < z < 90


class SignalRoads:
    def __init__(self, scene):
        self.terrain = TerrainGrid(ROOT / 'assets/ede-ahn.bin')
        self.expansion = TerrainGrid(expansion_collision_path())
        self.profiles = defaultdict(list)
        for site in read_json(ROOT / 'assets/ede-grade.json')['sites']:
            if site['kind'] not in ('bridge', 'underpass'):
                continue
            for profile in site['profiles']:
                for way in profile.get('wayIds', ()):
                    self.profiles[way].extend(segments(profile['points'], profile['width']))
        routes = []
        for road in scene['roads']:
            coords = points(road['pts'])
            modes = road.get('modes')
            if modes and not any(mask & MOTOR for mask in modes):
                continue
            if not modes and road['kind'] not in {
                'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link',
                'secondary', 'secondary_link', 'tertiary', 'residential', 'unclassified', 'service'
            }:
                continue
            routes.extend(Segment(a, b, road) for a, b in zip(coords, coords[1:]) if a != b)
        self.index = SegmentIndex(routes, margin=32)
        signals = {(signal['x'], signal['z']) for signal in scene['signals']}
        self.approaches = []
        for anchor in sorted(signals):
            for segment in self.index.near(*anchor):
                along, distance, _ = project(segment, *anchor)
                if distance > 1.6:
                    continue
                foot = segment.a[0] + along * segment.ux, segment.a[1] + along * segment.uz
                road = segment.data
                direction = -1 if road.get('reverse') else 1
                options = (direction,) if road.get('oneway') else (1, -1)
                for sign in options:
                    if road.get('modes') and not road['modes'][int(sign < 0)] & MOTOR:
                        continue
                    travel = sign * segment.ux, sign * segment.uz
                    # Prefer a link ending at the control over a nearby outgoing tangent.
                    on_outgoing = math.dist(anchor, segment.a if sign > 0 else segment.b) < .1
                    self.approaches.append((anchor, foot, segment, travel, distance + 0.18 * on_outgoing))

    @cache
    def ground(self, x, z):
        height = self.terrain.at(x, z)
        return height if height is not None else self.expansion.at(x, z)

    def nap(self, segment, point):
        road = segment.data
        nearby = []
        for profile in self.profiles.get(road['id'], ()):
            along, distance, _ = project(profile, *point)
            if distance < profile.data / 2 + 2:
                nearby.append((distance, SCENE_NAP_ORIGIN + profile.a[2]
                               + along / profile.length * (profile.b[2] - profile.a[2])))
        if nearby:
            return min(nearby)[1]
        if road.get('layer') or road.get('tunnel') or road.get('bridge'):
            return None
        return self.ground(*point)

    @staticmethod
    def width(road):
        return road.get('bgt', {}).get('width') or road['width']

    def match(self, point, *, nap=None, arm=None, pole=None, level=None):
        matches = []
        for anchor, foot, segment, travel, distance in self.approaches:
            if math.dist(anchor, point) > 29:
                continue
            road = segment.data
            if level is not None and road.get('layer', 0) != level:
                continue
            ux, uz = travel
            dx, dz = point[0] - foot[0], point[1] - foot[1]
            along, across = dx * ux + dz * uz, abs(dx * uz - dz * ux)
            half = self.width(road) / 2
            if not -0.25 <= along <= 27:
                continue
            if arm:
                if across > half + 1.5 or abs(arm[0] * ux + arm[1] * uz) > .62:
                    continue
            elif not half - .6 <= across <= half + (4.4 if nap is not None else 2.9):
                continue
            # Sample the associated carriageway at the head's station, separately from its surveyed XY.
            road_point = (foot[0] + ux * along, foot[1] + uz * along)
            nearby = [project(part, *road_point)[1] for part in self.index.near(*road_point)
                      if part.data['id'] == road['id']]
            if not nearby or min(nearby) > 7:
                continue
            base = self.nap(segment, road_point)
            if base is None:
                continue
            clearance = nap - base if nap is not None else 2.77
            low_clearance = math.dist(pole, point) <= 1.5 if pole else False
            if arm and not 4.72 <= clearance <= 8.2:
                continue
            if not arm and not ((1.45 if low_clearance else 1.85) <= clearance <= 4.15):
                continue
            score = math.dist(anchor, point) * .42 + distance * 2 + abs(along - 7) * .12
            score += across * .48 if arm else abs(across - half - .5)
            matches.append((score, anchor, travel, road, base, clearance))
        if not matches:
            return None
        best = min(matches, key=lambda match: match[:3])
        # At a bidirectional control the side of the street alone cannot identify the served approach.
        ambiguous = any(other[0] < best[0] + .8 and other[2][0] * best[2][0] + other[2][1] * best[2][1] < .48
                        for other in matches)
        return None if ambiguous else best

    def clear_for_upright(self, position, level):
        for part in self.index.near(*position):
            if part.data.get('layer', 0) != level:
                continue
            along, distance, _ = project(part, *position)
            if .05 < along < part.length - .05 and distance < self.width(part.data) / 2 - .28:
                return False
        return True


def road_level(row):
    return {'Maaiveld': 0, 'MaaiveldPlus1': 1, 'MaaiveldPlus2': 2,
            'MaaiveldMin1': -1, 'MaaiveldMin2': -2}.get(row.get('niveau'))


def desired_head(point, match, source, nap, pole=None):
    _, anchor, (ux, uz), road, base, clearance = match
    figure = {'anchor': list(anchor), 'point': snap(point), 'heading': round(math.atan2(-ux, -uz), 5),
              'height': round(clearance, 3), 'wayId': road['id'], 'level': road.get('layer', 0), 'source': source}
    if nap is not None:
        figure['y'] = round(nap - SCENE_NAP_ORIGIN, 3)
    if pole:
        figure['pole'] = snap(pole)
    return figure


def reviewed_approach(roads, anchor, way):
    matches = [row for row in roads.approaches if row[0] == tuple(anchor) and row[2].data['id'] == way]
    if not matches:
        raise ValueError(f'Missing reviewed signal approach {way} at {anchor}')
    return min(matches, key=lambda row: row[-1])


def add_aerial_signals(layouts, heads, supports, roads):
    for layout in layouts:
        source = layout['source']
        feet = layout['points']
        level = layout.get('level', 0)
        span = LineString(feet)
        targets = [row for row in layout['approaches'] if not any(
            h['mount'] == 'overhead' and tuple(h['anchor']) == tuple(row['anchor'])
            and span.distance(Point(h['point'])) < 2.5 for h in heads)]
        if not targets:
            continue
        support = len(supports)
        supports.append({'points': feet, 'height': layout.get('height', 6.0), 'kind': layout['kind'],
                         'heightSource': 'estimated-clearance', 'level': level, 'source': source})
        a, b = feet
        index = 0
        for row in targets:
            way = row['wayId']
            anchor, _, segment, (dx, dz), _ = reviewed_approach(roads, row['anchor'], way)
            if segment.data.get('layer', 0) != level:
                raise ValueError(f'Different levels for {source} and {way}')
            for offset in row['offsets']:
                index += 1
                point = [start + (end - start) * offset for start, end in zip(a, b)]
                heads.append({'anchor': anchor, 'point': snap(point), 'heading': round(math.atan2(-dx, -dz), 5),
                              'height': layout.get('headHeight', 5.75), 'wayId': way, 'level': level,
                              'source': f'{source}:{index}', 'mount': 'overhead', 'support': support})


def bake(documents, scene, boundary, frame, day):
    prepare(boundary)

    def in_bounds(point):
        return boundary.covers(Point(point))

    poles = active_poles(documents['poles'], day, frame, in_bounds)
    portals = active_poles(documents['portals'], day, frame, in_bounds)
    searches = SignalRoads(scene)
    reviewed = read_json(REVIEWED_OVERHEAD)
    reviewed_supports = {row['id']: row for row in reviewed['surveyed']}
    reviewed_heads = {head: (row['id'], approach) for row in reviewed['surveyed']
                      for approach in row['approaches'] for head in approach['heads']}
    inventory = read_json(ROOT / 'assets/ede-1gis-detail.json.gz')['features']
    existing = {item['objectId']: item for item in inventory if item['type'] == 'gantry'}

    for key in ('heads', 'supports'):
        if source_crs(documents[key]).to_epsg() != 28992 or not documents[key].get('hasZ'):
            raise ValueError(f'Expected an RD New {key} survey with NAP elevations')
    arms, outside_supports = [], set()
    for record in documents['supports']['features']:
        props = record['attributes']
        for path in record['geometry']['paths']:
            if 'portaal' not in props['type'].casefold() or len(path) < 2:
                continue
            xy = [frame.rd_to_scene(*p[:2]) for p in path]
            a, b = xy[0], xy[-1]
            line = LineString([a, b])
            if not boundary.covers(line):
                outside_supports.add(props['objectid'])
                continue
            length = line.length
            if not 3.5 <= length <= 52 or length < LineString(xy).length * .86:
                continue
            axis = ((b[0] - a[0]) / length, (b[1] - a[1]) / length)
            z = [p[2] for p in path if len(p) > 2 and observed_z(p[2])]
            arms.append((props, line, axis, z, []))
    surveyed_arms = {row[0]['objectid']: row for row in arms}

    heads, rejected, seen = [], Counter(), []
    for row in sorted(documents['heads']['features'], key=lambda a: a['attributes']['objectid']):
        obj = row['attributes']
        loc = row['geometry']
        nap = loc.get('z')
        point = frame.rd_to_scene(loc['x'], loc['y'])
        if not in_bounds(point):
            rejected['outsideBounds'] += 1
            continue
        if not observed_z(nap):
            rejected['invalidElevation'] += 1
            continue
        if any(math.dist(point, old) <= .38 and abs(nap - old_z) <= .32 for old, old_z in seen):
            rejected['duplicateHead'] += 1
            continue
        seen.append((point, nap))
        level = road_level(obj)
        source = '1gis:13:' + str(obj['objectid'])
        directory_match = reviewed_heads.get(obj['objectid'])
        if directory_match:
            identity, approach = directory_match
            if identity not in surveyed_arms and identity in outside_supports:
                rejected['supportOutsideBounds'] += 1
                continue
            anchor, _, segment, travel, score = reviewed_approach(searches, approach['anchor'], approach['wayId'])
            base = searches.nap(segment, point)
            if base is None or not 4.6 <= nap - base <= 8.5:
                raise ValueError(f'Unusable reviewed height for {source}')
            match = (score, anchor, travel, segment.data, base, nap - base)
            head = desired_head(point, match, source, nap)
            surveyed_arms[identity][4].append(({**head, 'mount': 'overhead'}, base, nap))
            continue
        mount_candidates = []
        for i, (props, line, axis, _, _) in enumerate(arms):
            dist = line.distance(Point(point))
            if dist > 1.05 or (road_level(props) is not None and level is not None and road_level(props) != level):
                continue
            fit = searches.match(point, nap=nap, arm=axis, level=level)
            if fit:
                mount_candidates.append((dist + fit[0] * .08, i, fit))
        if mount_candidates:
            _, index, fit = min(mount_candidates, key=lambda r: r[:2])
            head = desired_head(point, fit, source, nap)
            head['mount'] = 'overhead'
            arms[index][4].append((head, fit[4], nap))
            continue
        near_pole = min(((math.dist(point, pole), pole, identity) for pole, identity, lv in poles
                         if level is None or lv == level), default=(100, None, None))
        fit = searches.match(point, nap=nap, pole=near_pole[1], level=level)
        if not fit:
            rejected['headWithoutReliableApproachOrMount'] += 1
            continue
        _, _, _, road, _, _ = fit
        if not searches.clear_for_upright(point, road.get('layer', 0)):
            rejected['roadsideHeadInCarriageway'] += 1
            continue
        pole = near_pole[1] if near_pole[0] <= 1.25 and searches.clear_for_upright(near_pole[1], road.get('layer', 0)) else None
        head = desired_head(point, fit, source, nap, pole)
        head['mount'] = 'roadside'
        if pole:
            head['poleSource'] = 'bgt:' + near_pole[2]
        # Coincident observations of the same face sometimes use different
        # reference heights. Keep one full housing if the envelopes overlap.
        conflict = next((index for index, previous in enumerate(heads)
                         if math.dist(point, previous['point']) < .95 and abs(head['y'] - previous['y']) < .8
                         and math.cos(head['heading'] - previous['heading']) > .9), None)
        if conflict is None:
            heads.append(head)
        else:
            head_rank = ('pole' in head, head['height'])
            old_rank = ('pole' in heads[conflict], heads[conflict]['height'])
            if head_rank > old_rank:
                heads[conflict] = head
            rejected['overlappingRoadsideHead'] += 1

    supports = []
    for props, line, _, elevations, candidates in arms:
        if not candidates:
            continue
        level = candidates[0][0]['level']
        if any(head['level'] != level for head, _, _ in candidates):
            rejected['headsWithAmbiguousSupportLevel'] += len(candidates)
            continue
        identity = props['objectid']
        old = existing.get(identity)
        a, b = line.coords[0], line.coords[-1]
        med_road = median(base for _, base, _ in candidates)
        observed = median(elevations) if elevations else None
        head_nap = median(nap for _, _, nap in candidates)
        corroborated_span = observed is not None and max(elevations) - min(elevations) < 1 and abs(observed - head_nap) < .85
        beam = observed if corroborated_span else head_nap + .56
        height_source = 'surveyed-span' if corroborated_span else 'estimated-from-surveyed-heads'
        confirmed = reviewed_supports.get(identity, {})
        if old:
            a, b = map(tuple, old['points'])
            kind = 'cantilever' if old.get('half') else 'gantry'
            beam = old['beamY']
            height_source = old['beamSource']
        elif 'points' in confirmed:
            a, b = confirmed['points']
            kind = confirmed['kind']
            if 'beamNap' in confirmed:
                beam, height_source = confirmed['beamNap'], 'reviewed-surveyed-span'
        else:
            a_ok, b_ok = (searches.clear_for_upright(p, level) for p in (a, b))
            if props['type'] == 'Portaal (half)' or props.get('type_2') != 'A-1' and a_ok != b_ok:
                if a_ok == b_ok:
                    rejected['headsWithUnclearUpright'] += len(candidates)
                    continue
                if b_ok:
                    a, b = b, a
                kind = 'cantilever'
            elif a_ok and b_ok and line.length >= 7:
                kind = 'gantry'
            else:
                rejected['headsWithUnclearUpright'] += len(candidates)
                continue
        selected = [head for head, base, nap in candidates if 4.55 <= beam - base <= 8.5 and abs(beam - nap) <= 1.8]
        if not selected:
            rejected['headsWithContradictingSupportHeight'] += len(candidates)
            continue
        index = len(supports)
        support = {'points': [snap(a), snap(b)], 'beamY': round(beam - SCENE_NAP_ORIGIN, 3),
                   'height': round(beam - med_road, 3), 'kind': kind, 'heightSource': height_source,
                   'level': level, 'source': '1gis:31:' + str(identity)}
        if old:
            support['existingId'] = old['id']
            photo = CENTERED_HEADS_BY_SUPPORT.get(old['id'])
            if photo:
                support.update(headAlignment='beamCenter', alignmentEvidence=photo)
        portal_evidence = [f'bgt:{pid}' for point, pid, lv in portals if lv == level and
                           min(math.dist(point, a), math.dist(point, b)) <= 1.5]
        if portal_evidence:
            support['poleSources'] = portal_evidence
        supports.append(support)
        for head in selected:
            head['support'] = index
            if head['source'] in LEFT_ARROW_HEADS:
                head['arrow'] = 'left'
            heads.append(head)
        if len(selected) < len(candidates):
            rejected['headDoesNotMeetBeam'] += len(candidates) - len(selected)

    reserved = {tuple(head['anchor']) for head in heads}
    used = [tuple(head.get('pole', head['point'])) for head in heads if head['mount'] == 'roadside']
    lower_options = []
    for pole, identity, level in poles:
        fit = searches.match(pole, level=level)
        if fit and math.dist(pole, fit[1]) <= 9 and searches.clear_for_upright(pole, level):
            lower_options.append((fit[0], identity, pole, fit))
    for _, identity, pole, fit in sorted(lower_options):
        anchor = fit[1]
        if anchor in reserved or any(math.dist(pole, point) <= 1.5 for point in used):
            continue
        head = desired_head(pole, fit, 'bgt:' + identity, None)
        heads.append({**head, 'mount': 'roadside'})
        reserved.add(anchor)
        used.append(pole)
    hospital = [{'source': f'pdok:aerial:ede-vri-2:{direction}', 'kind': 'gantry', 'points': feet,
                 'approaches': [{'anchor': anchor, 'wayId': way, 'offsets': offsets}]}
                for direction, anchor, way, feet, offsets in HOSPITAL_GANTRIES]
    aerial = [item for item in [*hospital, *reviewed['aerial']]
              if boundary.covers(LineString(item['points']))
              and all(in_bounds(approach['anchor']) for approach in item['approaches'])]
    add_aerial_signals(aerial, heads, supports, searches)
    counts = {'bgtPoles': len(poles), 'bgtPortals': len(portals), 'heads1gis': len(documents['heads']['features']),
              'roadside': sum(h['mount'] == 'roadside' for h in heads),
              'overhead': sum(h['mount'] == 'overhead' for h in heads),
              'anchors': len({tuple(h['anchor']) for h in heads}),
              'gantries': sum(s['kind'] == 'gantry' for s in supports),
              'cantilevers': sum(s['kind'] == 'cantilever' for s in supports),
              'existingSupports': sum('existingId' in s for s in supports),
              'bgtInferredHeads': sum(h['source'].startswith('bgt:') for h in heads),
              'aerialHeads': sum(h['source'].startswith('pdok:aerial:') for h in heads),
              'rejected': dict(rejected)}
    admitted_1gis = sum(h['source'].startswith('1gis:') for h in heads)
    if admitted_1gis + sum(rejected.values()) != counts['heads1gis']:
        raise AssertionError('Every 1GIS head must be placed or accounted for')
    sources = {
        'bgt': {'url': BGT, 'licence': 'CC0-1.0'},
        '1gis': {'url': RWS, 'licence': 'CC0-1.0'},
        'osm': {'url': 'https://www.openstreetmap.org/copyright', 'licence': 'ODbL-1.0'},
        'aerial': {'url': 'https://www.pdok.nl/ogc-webservices/-/article/pdok-luchtfoto-rgb-open-',
                   'years': [2025, 2026], 'licence': 'CC BY',
                   'attribution': 'Beeldmateriaal.nl via PDOK'},
    }
    return {'version': 1, 'date': day, 'sources': sources, 'heads': heads, 'supports': supports, 'counts': counts}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshot', type=Path, help='directory holding the four original service responses')
    parser.add_argument('--date', type=date.fromisoformat, required=True)
    parser.add_argument('--fetch', action='store_true')
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/ede-signal-hardware.json')
    args = parser.parse_args()
    scene = load_playable_scene(include_shorelines=False)
    frame = Frame(scene['meta']['lonLatAffine'])
    if args.fetch:
        fetch(args.snapshot, scene['meta']['geographicBounds'], frame)
    documents = {key: read_json(args.snapshot / f'{key}.json') for key in BGT_TYPES | SURVEY_TYPES}
    data = bake(documents, scene, load_playable_boundary(), frame, args.date.isoformat())
    write_json(args.output, data)
    print(json.dumps(data['counts'], indent=2))


if __name__ == '__main__':
    main()
