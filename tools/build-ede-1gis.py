#!/usr/bin/env python3
"""Bake Rijkswaterstaat 1GIS motorway infrastructure into the Oude Kerk frame."""

import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
import math
from pathlib import Path
import re
from statistics import median
import json
from urllib.parse import urlencode
from urllib.request import urlopen
from zoneinfo import ZoneInfo

from shapely import STRtree, make_valid, union_all
from shapely.geometry import LineString, Point, Polygon

from ede_gis import Frame, source_crs, to_rd
from ede_map import load_playable_boundary, load_playable_scene
from ede_motorway_infrastructure import (
    Motorway, ROOT, assignments, import_line, line_parts, points, project, read_json, snap, write_json,
)

SOURCE = 'https://geo.rijkswaterstaat.nl/arcgis/rest/services/GDR/geografische_areaalregistratie/MapServer'
SNAPSHOT = ROOT / 'tools/data/ede-1gis.snapshot.json.gz'
LAYERS = (6, 9, 13, 23, 30, 31, 44, 45)
ATTRIBUTES = ('objectid', 'gisobjid', 'globalid', 'type', 'type_2', 'infox1', 'niveau', 'naam', 'rwsnummer',
              'wegzijde', 'rijkswegnr', 'hectowaarde', 'armatuurtype', 'lamptype', 'lampaantal', 'lengte',
              'lichtpunthoogte', 'lichtmastid', 'rotatie', 'breedte', 'hoogte', 'datumaanleg', 'datum_inwinning',
              'datum_controle', 'datum_mutatie', 'datumoplevering', 'disk_beh_obj_code', 'tekening')
LEVEL = {'Maaiveld': 0, 'MaaiveldPlus1': 1, 'MaaiveldPlus2': 2, 'MaaiveldMin1': -1, 'MaaiveldMin2': -2}
MISSING = (None, '', '-777', '-999', 'Geen informatie', 'Niet van toepassing', 'Niet bekend')


def coordinates(geometry):
    if 'x' in geometry:
        return [[[geometry['x'], geometry['y'], geometry.get('z')]]]
    return geometry.get('paths', geometry.get('rings', []))


def scene_geometry(raw, to_scene):
    geometry = raw['geometry']
    paths = [[to_scene(*coordinate[:2]) for coordinate in path] for path in coordinates(geometry)]
    if 'x' in geometry:
        return Point(paths[0][0])
    if 'paths' in geometry:
        return union_all([LineString(path) for path in paths if len(path) > 1])
    # ArcGIS polygon rings may also include islands and holes.
    result = Polygon()
    for path in paths:
        if len(path) >= 4:
            result = result.symmetric_difference(make_valid(Polygon(path)))
    return result


def source_date(properties, snapshot):
    for name in ('datum_inwinning', 'datum_mutatie', 'datum_controle', 'datumoplevering', 'datumaanleg'):
        value = properties.get(name)
        if isinstance(value, (int, float)) and 0 < value < 4_102_444_800_000:
            day = datetime.fromtimestamp(value / 1000, ZoneInfo('Europe/Amsterdam')).date().isoformat()
            if day <= snapshot:
                return day
    return None


def source_fields(layer, row, day):
    properties = row['attributes']
    geometry = row['geometry']
    field = {'sourceId': properties['gisobjid'], 'objectId': properties['objectid'], 'collection': layer,
             'sourceType': properties['type'], 'sourceLevel': properties.get('niveau')}
    if properties.get('type_2') not in (None, 'Geen informatie', 'Niet van toepassing'):
        field['sourceSubtype'] = properties['type_2']
    observed = [point[2] for path in coordinates(geometry) for point in path if valid_z(point)]
    if observed:
        field['observedNap'] = round(observed[0], 3) if 'x' in geometry else [
            round(min(observed), 3), round(max(observed), 3)]
    if recorded := source_date(properties, day):
        field['date'] = recorded
    return field


def valid_z(point):
    return len(point) >= 3 and isinstance(point[2], (int, float)) and -15 < point[2] < 100


def fetch(directory, geographic_bounds):
    south, west, north, east = geographic_bounds
    xs, ys = zip(*(to_rd(lon, lat, 'OGC:CRS84') for lon in (west, east) for lat in (south, north)))
    bounds = (math.floor(min(xs)) - 5, math.floor(min(ys)) - 5, math.ceil(max(xs)) + 5, math.ceil(max(ys)) + 5)
    query = urlencode({'f': 'json', 'where': '1=1', 'geometry': ','.join(map(str, bounds)),
                       'geometryType': 'esriGeometryEnvelope', 'inSR': 28992, 'outSR': 28992,
                       'returnZ': 'true', 'outFields': '*', 'orderByFields': 'objectid'})
    directory.mkdir(parents=True, exist_ok=True)

    def download(layer):
        features, seen = [], set()
        while True:
            with urlopen(f'{SOURCE}/{layer}/query?{query}&resultRecordCount=1000&resultOffset={len(features)}', timeout=75) as response:
                data = json.load(response)
            page = data.get('features', [])
            ids = {row['attributes']['objectid'] for row in page}
            if seen & ids or not page and data.get('exceededTransferLimit'):
                raise ValueError(f'Incomplete or repeated page for 1GIS layer {layer}')
            seen.update(ids)
            features.extend(page)
            if not data.get('exceededTransferLimit'):
                break
        if 'features' in data:
            data['features'] = features
        validate(layer, data)
        write_json(directory / f'{layer}.json', data)

    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(download, LAYERS))


def validate(layer, data):
    if ('error' in data or data.get('exceededTransferLimit') or 'features' not in data or
            not data.get('hasZ') or source_crs(data).to_epsg() != 28992):
        raise ValueError(f'Layer {layer} must be a complete RD New ArcGIS feature set with Z: {data.get("error")}')


def snapshot_from_directory(directory, motorway, to_scene, day):
    layers, counts = {}, {}
    for layer in LAYERS:
        data = read_json(directory / f'{layer}.json')
        validate(layer, data)
        counts[str(layer)] = len(data['features'])
        layers[str(layer)] = selected = []
        corridor = motorway.gantry_corridor if layer in (13, 31) else motorway.corridor
        for row in data['features']:
            if row.get('geometry') and scene_geometry(row, to_scene).intersects(corridor):
                attributes = {key: row['attributes'][key] for key in ATTRIBUTES if row['attributes'].get(key) is not None}
                if attributes.get('gisobjid') in MISSING:
                    attributes['gisobjid'] = attributes.get('globalid', str(attributes['objectid']))
                geometry = row['geometry']
                # Preserve measured RD New and NAP vertices, omit floating-point storage artefacts only.
                cleaned = [[[round(number, 4) if isinstance(number, (int, float)) else number
                             for number in point] for point in path] for path in coordinates(geometry)]
                if 'x' in geometry:
                    geometry = dict(zip(('x', 'y', 'z'), cleaned[0][0]))
                else:
                    geometry = {'paths' if 'paths' in geometry else 'rings': cleaned}
                selected.append({'attributes': attributes, 'geometry': geometry})
    return {'version': 1, 'source': SOURCE, 'license': 'CC0-1.0', 'date': day,
            'horizontalCrs': 28992, 'verticalDatum': 'NAP', 'rawRecords': counts, 'layers': layers}


def local_lines(row, to_scene):
    for path in row['geometry']['paths']:
        group = []
        for point in path:
            if not valid_z(point):
                if len(group) > 1:
                    yield LineString(group)
                group = []
            else:
                projected = (*to_scene(*point[:2]), point[2])
                if not group or group[-1][:2] != projected[:2]:
                    group.append(projected)
        if len(group) > 1:
            yield LineString(group)


def mark_style(properties, length):
    label = properties['type']
    width_match = re.search(r'(\d+)\s*cm', label)
    width = float(width_match[1]) / 100 if width_match else .15
    match = re.fullmatch(r'([\d,]+)\s*-\s*([\d,]+)\s*\d+\s*cm\.', label)
    if match:
        painted, vacant = (float(v.replace(',', '.')) for v in match.groups())
        return {'width': width, **({'period': painted + vacant, 'duty': round(painted / (painted + vacant), 4)}
                                   if length > painted + .35 else {})}
    match = re.fullmatch(r'Blok(?:streep|markering) ([\d,]+)/([\d,]+) [Mm]\.?', label)
    if match:
        width, painted = (float(v.replace(',', '.')) for v in match.groups())
        return {'width': width, 'period': painted * 2, 'duty': .5}
    if label == '5050 streep 0.10':
        return {'width': .10, 'period': 1, 'duty': .5}
    if label.startswith(('Onond.', 'Doorgetrokkenstreep')):
        return {'width': width}
    return None


def markings(line, properties, motorway, source_level, stats):
    style = mark_style(properties, line.length)
    if not style:
        return
    for part in line_parts(line.intersection(motorway.corridor)):
        for section, matches in assignments(part, line, motorway, 'marking', source_level, split_by_way=True):
            if not matches or matches == 'unsupported' or section.length < .3:
                stats['unmatchedMarkingSpans'] += 1
                continue
            match = min(matches, key=lambda item: item[0])
            profile, level = match[6:8]
            fields = motorway.references(match)
            geometry = section.simplify(.08)
            if 'period' in style:
                fields['phase'] = round(line.project(Point(geometry.coords[0][:2])) % style['period'], 3)
            if profile:
                fields['profileId'] = profile
            yield {**fields, 'level': level, 'points': [snap(point) for point in geometry.coords], **style}


def gantry(line, properties, motorway, source_level, sign_index):
    a, b = line.coords[0], line.coords[-1]
    span = math.dist(a[:2], b[:2])
    if not 3.5 <= span <= 58 or span < line.length * .92 or not motorway.area.covers(line):
        return None
    axis = ((b[0] - a[0]) / span, (b[1] - a[1]) / span)
    samples = [line.interpolate(t, normalized=True).coords[0] for t in (.12, .33, .5, .67, .88)]
    hits = [match for point in samples for mode in ('gantryBase', 'gantry')
            if (match := motorway.match(point, mode, axis, source_level)) and
            abs(match[4]) <= match[2].data['width'] / 2 + 1.5]
    if not hits:
        return None
    fit = min(hits, key=lambda item: item[0])
    base = fit[5]
    if any(hit[7] != fit[7] and abs(hit[5] - base) > 2 for hit in hits):
        return None
    natively_elevated = max(a[2], b[2]) - min(a[2], b[2]) < 1.0 and 4.3 <= median((a[2], b[2])) - base <= 8.1
    signs = [point.z for i in sign_index.query(line, predicate='dwithin', distance=1.8)
             if (point := sign_index.geometries[i]).distance(line) <= 1.8 and 4.5 <= point.z - base <= 8]
    beam = median((a[2], b[2])) if natively_elevated else median(signs) if signs else base + 5.85
    beam_source = 'surveyed-span' if natively_elevated else 'nearby-wegwijzer' if signs else 'estimated-clearance'
    sa, sb = [abs(project(fit[2], *p[:2])[2]) for p in (a, b)]
    subtype = properties.get('type_2')
    half = span <= 11.5 and subtype in (None, 'Niet van toepassing', 'Geen informatie')
    if half and abs(sa - sb) < .75:
        return None
    if half and sb > sa:
        a, b = b, a
    feature = {**motorway.references(fit), 'level': fit[7], 'points': [snap(a), snap(b)],
               'beamY': round(beam, 3), 'beamSource': beam_source, 'collidable': False}
    if half:
        feature['half'] = True
    if fit[6]:
        feature['profileId'] = fit[6]
    feature.pop('side', None)
    return feature


def marker(row, to_scene, motorway, source_level):
    properties, shape = row['attributes'], row['geometry']
    label = properties.get('hectowaarde', '').replace(',', '.')
    if properties['type'] != 'BB08' or not re.fullmatch(r'\d+\.\d[a-z]?', label):
        return None
    coordinate = (shape['x'], shape['y'], shape.get('z'))
    if not valid_z(coordinate):
        return None
    position = (*to_scene(*coordinate[:2]), coordinate[2])
    match = motorway.match(position, 'hectometre', source_level=source_level)
    if not match:
        return None
    edge = match[2]
    if abs(match[4]) < max(1.5, edge.data['width'] / 2 - 1.4):
        return None
    feature = {**motorway.references(match, label), 'level': match[7], 'position': snap(position),
               'label': label, 'angle': round(math.atan2(-edge.ux, -edge.uz), 4)}
    route = properties.get('rijkswegnr')
    if route in ('12', '30') and feature.get('route') not in (None, f'A{route}'):
        return None
    if match[6]:
        feature['profileId'] = match[6]
    return feature


def deduplicate(features, stats):
    # A position can be represented by two layers or by simplified and detailed records in one layer.
    groups = defaultdict(list)
    accepted = []
    for row in sorted(features, key=lambda f: (f['type'], ' ' not in f['sourceType'], f['id'])):
        geometry = LineString(row['points']) if 'points' in row else Point(row['position'])
        key = row['type'], row['level'], row.get('wayId') if row['type'] == 'marking' else None
        radius = .16 if row['type'] == 'marking' else .65
        boxes = groups[key]
        if any(geometry.dwithin(previous, radius) and
               (geometry.geom_type == 'Point' or geometry.intersection(corridor).length >= geometry.length * .90)
               for previous, corridor in boxes):
            stats['duplicate1gisPlacements'] += 1
            continue
        boxes.append((geometry, geometry.buffer(radius) if 'points' in row else None))
        accepted.append(row)
    return sorted(accepted, key=lambda f: (f['type'], f['id']))


def structure_matches(row, to_scene, bgt_shapes):
    area = scene_geometry(row, to_scene)
    if area.is_empty or area.area < .15:
        return None
    matches = [bgt_shapes.geometries[i] for i in bgt_shapes.query(area, predicate='intersects')]
    overlap = area.intersection(union_all(matches)).area / area.area if matches else 0
    point = area.representative_point()
    centre = snap((point.x, point.y))
    return {'position': centre, 'bgtOverlap': round(overlap, 3)}


def line_tangent(line, point):
    station = line.project(point)
    a, b = line.interpolate(max(0, station - 1)), line.interpolate(station + 1)
    span = a.distance(b)
    return ((b.x - a.x) / span, (b.y - a.y) / span) if span else (0, 0)


def alignment(a, b, point):
    ax, az = line_tangent(a, point)
    bx, bz = line_tangent(b, point)
    return abs(ax * bx + az * bz)


def supported_deck_shoulder(line, footprint, profile, axis):
    # The 2 cm allowance absorbs the runtime coordinate rounding at the polygon edge.
    support = footprint.buffer(.02)
    pairs, runs = [], []
    for piece in line_parts(line.intersection(footprint)):
        count = math.ceil(piece.length / .25)
        if not count:
            continue
        for step in range(count + 1):
            outer = piece.interpolate(step / count, normalized=True)
            center = axis.interpolate(axis.project(outer))
            ux, uz = line_tangent(axis, center)
            cross = (outer.x - center.x) * -uz + (outer.y - center.y) * ux
            offset = math.copysign(profile['width'] / 2 - .2, cross)
            inner = snap((center.x - uz * offset, center.y + ux * offset))
            outer = snap((outer.x, outer.y))
            if abs(cross) <= abs(offset) or not support.covers(LineString([outer, inner])):
                if pairs:
                    runs.append(pairs)
                    pairs = []
                continue
            pairs.append((outer, inner))
        if pairs:
            runs.append(pairs)
            pairs = []
    if not runs:
        return None
    measured = max(runs, key=len)
    if len(measured) < 5:
        return None
    # Keep enough sections to follow the fitted normal, including both clipped ends.
    samples = [*measured[:-1:8], measured[-1]]
    for (outer_a, inner_a), (outer_b, inner_b) in zip(samples, samples[1:]):
        section = make_valid(Polygon([outer_a, outer_b, inner_b, inner_a]))
        if not support.covers(section):
            return None
    outside, inside = zip(*samples)
    return {'points': list(outside), 'deckShoulder': list(inside)}


class CrossingBarrierAudit:
    def __init__(self, motorway, snapshot, to_scene, structures):
        self.motorway = motorway
        grade = read_json(ROOT / 'assets/ede-grade.json')
        self.profiles = {}
        self.bridges, self.roads, self.decks = [], [], []
        for site in grade['sites']:
            if site['kind'] not in ('bridge', 'underpass'):
                continue
            for profile in site['profiles']:
                line = LineString(profile['points'])
                entry = (profile, line)
                self.profiles[profile['id']] = entry
                if site['kind'] == 'bridge':
                    self.bridges.append(entry)
                if profile['modes']:
                    core = line.buffer(max(1, profile['width'] / 2 - 1.5), cap_style='flat')
                    self.roads.append((profile, line, core))
        self.road_index = STRtree([core for _, _, core in self.roads])
        for feature in structures:
            if feature['kind'] != 'deck' or feature['layer'] <= 0:
                continue
            for outer, *holes in feature['polygons']:
                poly = make_valid(Polygon(points(outer), [points(hole) for hole in holes]))
                self.decks.append((feature['ids'][0], poly, None))
        # The underpass footprint also defines the upper parapet positions where BGT has no deck.
        for row in snapshot['layers']['44']:
            if row['attributes']['type'] == 'Onderdoorgang':
                self.decks.append((None, scene_geometry(row, to_scene), row['attributes']['gisobjid']))
        self.deck_index = STRtree([poly.buffer(.75) for _, poly, _ in self.decks])

    def bridge_mount(self, barrier, line):
        # An upper railing needs a footprint edge and an elevation tie. Middling Z can
        # follow the underlying road instead of the deck even when both endpoints agree.
        if barrier['type'] != 'fence' or barrier['level'] < 0:
            return None
        observed = barrier.get('observedNap')
        if not observed:
            return None
        midpoint = line.interpolate(.5, normalized=True)
        anchors = []
        for index in self.deck_index.query(line, predicate='intersects'):
            surface_id, poly, structure_id = self.decks[index]
            footprint = self.deck_index.geometries[index]
            if (line.intersection(footprint).length < .9 * line.length or
                    line.intersection(poly.boundary.buffer(2)).length < .8 * line.length):
                continue
            for profile, axis in self.bridges:
                if axis.distance(line) > profile['width'] / 2 + 6 or alignment(line, axis, midpoint) < .75:
                    continue
                heights = []
                for i in range(9):
                    sample = line.interpolate(i / 8, normalized=True)
                    road = axis.interpolate(axis.project(sample))
                    if road.distance(sample) <= profile['width'] / 2 + 6:
                        heights.append(self.motorway.datum + road.z)
                if len(heights) < 6 or not any(-.85 <= observed[1] - y <= 1.6 for y in heights):
                    continue
                anchors.append((axis.distance(midpoint), surface_id, profile, axis, poly, structure_id))
        if not anchors:
            return None
        _, surface_id, profile, axis, poly, structure_id = min(
            anchors, key=lambda row: (row[0], row[1] is None, row[2]['id']))
        result = {**barrier, 'level': 1, 'profileId': profile['id']}
        if surface_id:
            result['surfaceId'] = surface_id
        if structure_id == '2102726474':
            shoulder = supported_deck_shoulder(line, poly, profile, axis)
            if shoulder:
                result.update(shoulder)
        if barrier['wayId'] not in profile['wayIds']:
            # A lower route reference cannot describe the repaired upper parapet.
            result['wayId'] = profile['wayIds'][0]
            for key in ('nwbId', 'route', 'side'):
                result.pop(key, None)
        return result

    def conflict(self, barrier, line):
        anchor = self.profiles.get(barrier.get('profileId'))
        for index in self.road_index.query(line, predicate='intersects'):
            profile, axis, core = self.roads[index]
            for conflict in line_parts(line.intersection(core)):
                if conflict.length < 1.2:
                    continue
                at = conflict.interpolate(.5, normalized=True)
                if alignment(line, axis, at) >= .78:
                    continue
                y = self.motorway.datum + axis.interpolate(axis.project(at)).z
                base = (self.motorway.datum + anchor[1].interpolate(anchor[1].project(at)).z
                        if anchor else self.motorway.ground(at.x, at.y))
                if abs(y - base) < 2:
                    return profile['id'], snap((at.x, at.y))
        return None

    def filter(self, features, stats):
        accepted, review = [], []
        for barrier in features:
            if barrier['type'] not in ('fence', 'guardrail', 'noiseBarrier'):
                accepted.append(barrier)
                continue
            stats['barrierPartsAudited'] += 1
            line = LineString(barrier['points'])
            mounted = self.bridge_mount(barrier, line)
            feature = mounted or barrier
            if feature.get('profileId', '').startswith('maanderdijk-passage-upper-'):
                if 'deckShoulder' in feature:
                    stats['barrierDeckShouldersAdded'] += 1
                    line = LineString(feature['points'])
                elif barrier['type'] == 'fence':
                    stats['barrierCrossingPartsWithheld'] += 1
                    review.append({'id': barrier['id'], 'reason': 'unverified-deck-shoulder',
                                   'profileId': feature['profileId'],
                                   'position': snap(line.interpolate(.5, normalized=True).coords[0])})
                    continue
            if conflict := self.conflict(feature, line):
                stats['barrierCrossingPartsWithheld'] += 1
                review.append({'id': barrier['id'], 'reason': 'fitted-carriageway-conflict', 'profileId': conflict[0],
                               'position': conflict[1]})
                continue
            if mounted and barrier['level'] == 0:
                stats['barrierDeckMountsCorrected'] += 1
                review.append({'id': barrier['id'], 'reason': 'deck-mount-corrected', 'profileId': mounted['profileId'],
                               'surfaceId': mounted.get('surfaceId'), 'position': snap(line.interpolate(.5, normalized=True).coords[0])})
            accepted.append(feature)
        return accepted, review


def bake(snapshot, motorway, to_scene):
    features, evidence = [], []
    review, stats, counts = defaultdict(list), Counter(), Counter()
    layers = snapshot['layers']
    boundary = load_playable_boundary()
    sign_positions = []
    for row in layers['13']:
        coordinate = coordinates(row['geometry'])[0][0]
        if row['attributes']['type'] == 'Wegwijzer' and valid_z(coordinate):
            sign_positions.append(Point(*to_scene(*coordinate[:2]), coordinate[2]))
    sign_index = STRtree(sign_positions)
    structures = read_json(ROOT / 'assets/ede-bgt.json')['structures']
    bgt_shapes = STRtree([make_valid(Polygon(points(rings[0]), [points(hole) for hole in rings[1:]]))
                          for row in structures for rings in row['polygons']])
    for layer in LAYERS:
        identities = Counter(row['attributes']['gisobjid'] for row in layers[str(layer)])
        for row in layers[str(layer)]:
            horizontal = scene_geometry(row, to_scene)
            if not horizontal.intersects(boundary):
                continue
            properties = row['attributes']
            native = source_fields(layer, row, snapshot['date'])
            type_ = properties['type']
            identity = f'1gis:{layer}:{native["sourceId"]}'
            if identities[native['sourceId']] > 1:
                identity += f'@{native["objectId"]}'
            source_level = LEVEL.get(native['sourceLevel'])
            counts[f'{layer}:{type_}'] += 1
            if layer in (6, 13):
                # Layer 6 is consumed together with BGT lamps, and layer 13 by NBd and NDW sign joins.
                continue
            if layer in (44, 45):
                placement = structure_matches(row, to_scene, bgt_shapes)
                if placement is not None:
                    evidence.append({'id': identity, **native, **placement})
                    stats['bgtStructureOverlap'] += int(placement['bgtOverlap'] >= .4)
                if type_ != 'Geluidsbeperkende constructie':
                    continue
                kind = 'noiseBarrier'
                paths = [LineString(path) for path in coordinates(row['geometry']) if len(path) > 2]
                added = []
                for path in paths:
                    if not all(map(valid_z, path.coords)):
                        continue
                    footprint = Polygon([to_scene(*p[:2]) for p in path.coords]).minimum_rotated_rectangle
                    if footprint.geom_type != 'Polygon' or footprint.area < .1:
                        continue
                    corners = list(footprint.exterior.coords)
                    sides = [(math.dist(a, b), ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)) for a, b in zip(corners, corners[1:])]
                    by_length = sorted(sides)
                    width = max(.1, by_length[0][0])
                    if width > 3.0 or by_length[-1][0] < width * 3:
                        continue
                    height = median(point[2] for point in path.coords)
                    line = LineString([(*v[1], height) for v in by_length[:2]])
                    added.extend({**part, 'width': round(width, 2)} for part in
                                 import_line(line, kind, motorway, stats, source_level))
            elif layer == 9:
                kind = 'hectometre'
                result = marker(row, to_scene, motorway, source_level)
                added = [result] if result else []
            elif layer == 23:
                kind = 'guardrail'
                added = [part for line in local_lines(row, to_scene)
                         for run in line_parts(line.intersection(boundary))
                         for part in import_line(run, kind, motorway, stats, source_level)]
                if type_ == 'Geleidebarrier' and 'stalen' not in properties.get('type_2', '').lower():
                    for part in added:
                        part['solid'] = True
            elif layer == 30:
                kind = 'marking'
                added = [part for line in local_lines(row, to_scene)
                         for run in line_parts(line.intersection(boundary))
                         for part in markings(run, properties, motorway, source_level, stats)]
            else:
                kind = 'gantry' if type_ == 'Verkeersportaal' else 'fence'
                if kind == 'gantry':
                    added = [result for line in local_lines(row, to_scene)
                             if (result := gantry(line, properties, motorway, source_level, sign_index))]
                elif type_ == 'Leuning':
                    added = [part for line in local_lines(row, to_scene)
                             for part in import_line(line, kind, motorway, stats, source_level)]
                else:
                    continue
            if not added:
                review[f'{layer}:{type_}'].append(identity)
            for index, part in enumerate(added):
                features.append({**part, **native, 'type': kind, 'id': identity if index == 0 else f'{identity}:{index}'})
    features = deduplicate(features, stats)
    features, crossing_review = CrossingBarrierAudit(motorway, snapshot, to_scene, structures).filter(features, stats)
    if len({row['id'] for row in features}) != len(features):
        raise ValueError('Baked 1GIS identities must be unique')
    for field, test in {
        'reviewCarriageway': lambda f: f['matchConfidence'] == 'review',
        'withNwb': lambda f: 'nwbId' in f,
        'withProfile': lambda f: 'profileId' in f,
    }.items():
        stats[field] = sum(map(test, features))
    return {'version': 1, 'source': SOURCE, 'license': 'CC0-1.0', 'date': snapshot['date'], 'features': features}, {
        'rawRecords': snapshot['rawRecords'], 'corridorRecords': {key: len(rows) for key, rows in layers.items()},
        'corridorTypes': dict(sorted(counts.items())), 'emitted': dict(sorted(Counter(f['type'] for f in features).items())),
        'stats': dict(sorted(stats.items())), 'omittedIds': dict(sorted(review.items())), 'structures': evidence,
        'crossingBarriers': crossing_review,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshot', type=Path, nargs='?', default=SNAPSHOT,
                        help='Bundled RD New/NAP snapshot or directory of ArcGIS layer JSON files')
    parser.add_argument('--fetch', action='store_true', help='Refresh the source JSON files in the supplied directory')
    parser.add_argument('--date', type=date.fromisoformat, default=date.today())
    parser.add_argument('--save-snapshot', type=Path)
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/ede-1gis-detail.json.gz')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    scene = load_playable_scene()
    # These two N781 carriageways feed Ede exit 24 immediately south of the ramps.
    motorway = Motorway(scene, gantry_ways=('w25999022', 'w25999048'))
    to_scene = Frame(scene['meta']['lonLatAffine']).rd_to_scene

    if args.fetch:
        if args.snapshot.suffix == '.gz' or args.snapshot.is_file():
            parser.error('--fetch requires a directory for the downloaded ArcGIS layer files')
        fetch(args.snapshot, scene['meta']['geographicBounds'])
    if args.snapshot.is_dir():
        snapshot = snapshot_from_directory(args.snapshot, motorway, to_scene, args.date.isoformat())
    else:
        snapshot = read_json(args.snapshot)
    if snapshot.get('version') != 1 or source_crs(snapshot).to_epsg() != 28992 or snapshot.get('verticalDatum') != 'NAP':
        raise ValueError('Expected a 1GIS RD New and NAP snapshot')
    if args.save_snapshot:
        write_json(args.save_snapshot, snapshot)
    asset, report = bake(snapshot, motorway, to_scene)
    write_json(args.output, asset)
    if args.report:
        write_json(args.report, report)
    print(json.dumps({key: value for key, value in report.items()
                      if key not in {'omittedIds', 'structures', 'corridorTypes', 'crossingBarriers'}}, indent=2))


if __name__ == '__main__':
    main()
