"""Shared directed-carriageway and fitted-elevation matching for motorway inventories."""

from collections import defaultdict
from itertools import chain, groupby
import gzip
import json
import math
from pathlib import Path
import runpy

from shapely import STRtree, union_all
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import substring

from ede_traffic_geometry import RoadGraph, Segment, SegmentIndex

ROOT = Path(__file__).resolve().parents[1]

LIMITS = {'guardrail': 23, 'noiseBarrier': 50, 'fence': 50, 'hectometre': 22,
          'marking': 24, 'gantry': 26, 'gantryBase': 26}


def read_json(path):
    data = path.read_bytes()
    return json.loads(gzip.decompress(data) if path.suffix == '.gz' else data)


def write_json(path, data):
    encoded = (json.dumps(data, separators=(',', ':'), ensure_ascii=False) + '\n').encode()
    path.write_bytes(gzip.compress(encoded, mtime=0) if path.suffix == '.gz' else encoded)


def points(flat):
    return list(zip(flat[::2], flat[1::2]))


def segments(coords, payload):
    return (Segment(a, b, payload) for a, b in zip(coords, coords[1:]) if a[:2] != b[:2])


def line_parts(geometry):
    if geometry.geom_type == 'LineString' and not geometry.is_empty:
        yield geometry
    else:
        for item in getattr(geometry, 'geoms', ()):
            yield from line_parts(item)


def project(segment, x, z):
    along, _ = segment.project(x, z)
    clamped = min(segment.length, max(0, along))
    dx, dz = x - segment.a[0], z - segment.a[1]
    cross = -segment.uz * dx + segment.ux * dz
    return clamped, math.hypot(cross, along - clamped), cross


def snap(point):
    return [round(point[0], 2), round(point[1], 2)]


class Motorway:
    def __init__(self, scene, gantry_ways=()):
        self.meta = scene['meta']
        self.frame = RoadGraph({**self.meta, 'edges': []})
        self.area = box(*self.meta['bounds'])
        self.terrain = runpy.run_path(str(ROOT / 'tools/build-ede-grade.py'))['Terrain']()
        grade = read_json(ROOT / 'assets/ede-grade.json')
        self.datum = grade['datumNAP']
        self.profiles = defaultdict(list)
        for site in grade['sites']:
            if site['kind'] not in ('bridge', 'underpass'):
                continue
            for profile in site['profiles']:
                for way in profile.get('wayIds', ()):
                    self.profiles[way].extend(segments(profile['points'], (profile, site['kind'])))

        lanes = read_json(ROOT / 'assets/ede-motorway-lanes.json')
        snapshot = read_json(ROOT / 'tools/data/ede-motorway-lanes.snapshot.json')
        self.records = lanes['records']
        self.options = lanes['ways']
        self.tags = snapshot['osmTags']
        self.nwb = {}
        nwb_segments = []
        for feature in snapshot['nwb']:
            p = feature['properties']
            if p['wegnr_hmp'] not in ('A12', 'A30'):
                continue
            self.nwb[p['wvk_id']] = p
            for line in feature['geometry']['coordinates']:
                nwb_segments.extend(segments([self.frame.project(*point) for point in line], p))
        self.nwb_index = SegmentIndex(nwb_segments, margin=15)

        edges = []
        centerlines = []
        approach_edges = []
        approaches = []
        access = defaultdict(list)
        for road in scene['roads']:
            coords = points(road['pts'])
            if road['kind'] not in ('motorway', 'motorway_link'):
                if coords:
                    # Include driving as well as walking and cycling access for collision review.
                    access[road['layer']].append(LineString(coords).buffer(0.55, cap_style='flat'))
                if road['id'] in gantry_ways:
                    if road['reverse']:
                        coords.reverse()
                    approach = LineString(coords)
                    approaches.append(approach)
                    for part in segments(coords, road):
                        part.span = approach
                        approach_edges.append(part)
                continue
            if not road['oneway'] or road['id'][1:] not in self.tags:
                continue
            if road['reverse']:
                coords.reverse()
            span = LineString(coords)
            centerlines.append(span)
            for part in segments(coords, road):
                part.span = span
                edges.append(part)
        self.centerlines = SegmentIndex(edges, margin=53)
        self.corridor = self.area.intersection(union_all(centerlines).buffer(50))
        self.gantry_approaches = SegmentIndex(approach_edges, margin=27)
        self.gantry_corridor = self.corridor.union(self.area.intersection(union_all(approaches).buffer(24)))
        self.access = {layer: STRtree(items) for layer, items in access.items()}

        walls = defaultdict(list)
        decks = []
        for item in read_json(ROOT / 'assets/ede-bgt.json')['structures']:
            if item['kind'] not in ('noiseWall', 'civilWall', 'retainingWall', 'deck'):
                continue
            for exterior, *holes in item['polygons']:
                footprint = Polygon(points(exterior), [points(ring) for ring in holes])
                if item['kind'] == 'deck':
                    decks.append(footprint.buffer(0.45))
                else:
                    walls[item['layer']].append(footprint.buffer(1.0))
        self.walls = {layer: STRtree(items) for layer, items in walls.items()}
        self.decks = STRtree(decks)

    def xyz(self, coordinate):
        return (*self.frame.project(*coordinate[:2]), *coordinate[2:3])

    def ground(self, x, z):
        west, south, east, north = self.meta['bounds']
        return self.terrain.at((min(east, max(west, x)), min(north, max(south, z))))

    def profile(self, road, x, z, surveyed_y, kind, source_level=None):
        ground = self.ground(x, z)
        best = (math.inf if source_level else self.height_error(ground, surveyed_y, kind), ground, None, 0)
        for edge in self.profiles[road['id']]:
            along, distance, _ = project(edge, x, z)
            profile, structure = edge.data
            if distance > profile['width'] / 2 + 3:
                continue
            height = self.datum + edge.a[2] + along / edge.length * (edge.b[2] - edge.a[2])
            level = (road['layer'] or (1 if structure == 'bridge' else -1))
            if source_level and source_level != level:
                continue
            if self.height_error(height, surveyed_y, kind) + 0.45 < best[0]:
                best = (self.height_error(height, surveyed_y, kind), height, profile['id'], level)
        return best

    @staticmethod
    def height_error(height, observed, kind):
        if kind == 'gantry':
            clearance = observed - height
            return abs(clearance - min(8, max(4.4, clearance)))
        # Surveyed line and sign heights may be at the foot or top of the object.
        expected = {'guardrail': (0, 1.35), 'fence': (-0.15, 2.5), 'noiseBarrier': (-0.2, 5.0),
                    'hectometre': (-0.1, 1.4), 'marking': (-0.35, 0.35), 'gantryBase': (-0.65, 1.2)}[kind]
        offset = observed - height
        return abs(offset - min(expected[1], max(expected[0], offset)))

    def match(self, point, kind, axis=None, source_level=None):
        x, z, surveyed_y = point
        candidates = {}
        is_gantry = kind in ('gantry', 'gantryBase')
        nearby = self.centerlines.near(x, z)
        if is_gantry:
            nearby = chain(nearby, self.gantry_approaches.near(x, z))
        for edge in nearby:
            road = edge.data
            dot = abs(edge.ux * axis[0] + edge.uz * axis[1]) if axis else 1
            if is_gantry and dot > 0.65:
                continue
            along, distance, side = project(edge, x, z)
            if distance > LIMITS[kind] or kind == 'marking' and (dot < .65 or distance > road['width'] / 2 + 2.8):
                continue
            rx, rz = edge.a[0] + along * edge.ux, edge.a[1] + along * edge.uz
            error, base, profile, level = self.profile(
                road, rx if is_gantry else x, rz if is_gantry else z, surveyed_y, kind, source_level)
            max_error = {'gantry': .25, 'gantryBase': 2.1, 'marking': 1.25}.get(kind, 2.4)
            if error > max_error:
                continue
            if not profile and road['layer'] and (
                    is_gantry or kind in ('guardrail', 'hectometre') and distance < road['width'] / 2 + 3):
                # A raised centreline without a corroborated profile is not a safe anchor.
                continue
            score = distance + error * 5 + (0 if is_gantry else 5 * (1 - dot))
            if road['kind'] == 'motorway_link' and kind == 'hectometre':
                score += 1
            match = (score, road['id'], edge, along, side, base, profile, level)
            if road['id'] not in candidates or match[0] < candidates[road['id']][0]:
                candidates[road['id']] = match
        ordered = sorted(candidates.values(), key=lambda match: match[:2])
        if not ordered:
            return None
        best = ordered[0]
        ambiguous = len(ordered) > 1 and ordered[1][0] - best[0] < 1.65
        if ambiguous and ordered[1][7] != best[7]:
            return None
        return (*best, ambiguous)

    def references(self, match, label=None):
        _, way, edge, along, side, _, _, _, ambiguous = match
        road_ref = self.tags.get(way[1:], {}).get('ref')
        t = edge.span.project(Point(edge.a[0] + along * edge.ux, edge.a[1] + along * edge.uz)) / edge.span.length
        explicit = {self.records[identity]['nwbId'] for item in self.options.get(way[1:], ())
                    if item['source'] == 'weggeg' and item['start'] - 0.005 <= t <= item['end'] + 0.005
                    for identity in item['records']}
        if len(explicit) == 1:
            nwb_id = next(iter(explicit))
        else:
            x, z = edge.span.interpolate(t, normalized=True).coords[0]
            candidates = {}
            for section in self.nwb_index.near(x, z):
                p = section.data
                if explicit and p['wvk_id'] not in explicit or road_ref and road_ref != p['wegnr_hmp']:
                    continue
                heading = section.ux * edge.ux + section.uz * edge.uz
                if (heading if p['rijrichtng'] == 'H' else -heading) < 0.80:
                    continue
                if label and label[-1:].isalpha() and label[-1:] != p['hecto_lttr']:
                    continue
                _, distance, _ = project(section, x, z)
                if distance <= 5:
                    candidates[p['wvk_id']] = min(distance, candidates.get(p['wvk_id'], math.inf))
            ranked = sorted(candidates, key=candidates.get)
            nwb_id = ranked[0] if ranked and (len(ranked) == 1 or
                     candidates[ranked[1]] - candidates[ranked[0]] >= 0.75) else None
        result = {'wayId': way, 'side': 'right' if side >= 0 else 'left',
                  'matchConfidence': 'review' if ambiguous else 'matched'}
        if nwb_id is not None:
            result.update(nwbId=nwb_id, route=self.nwb[nwb_id]['wegnr_hmp'])
        elif road_ref:
            result['route'] = road_ref
        return result

    def remove_wall_overlap(self, line, level):
        tree = self.walls.get(level)
        if tree is None:
            return line
        touched = tree.query(line, predicate='intersects')
        if not len(touched):
            return line
        # A perpendicular crossing does not make a second barrier a duplicate.
        overlaps = [wall for i in touched if
                    (wall := tree.geometries[i]).intersection(line).length >= 4]
        return line.difference(union_all(overlaps)) if overlaps else line

    def blocks_access(self, line, level):
        tree = self.access.get(level)
        return tree is not None and len(tree.query(line, predicate='intersects')) > 0

    def unsupported_shoulder(self, x, z, match):
        _, _, edge, _, side, base, _, level, _ = match
        return (level > 0 and abs(side) > edge.data['width'] / 2 + 1.15
                and base - self.ground(x, z) > 1.1
                and not len(self.decks.query(Point(x, z), predicate='intersects')))


def assignments(part, original, motorway, kind, source_level=None, split_by_way=False):
    count = max(1, math.ceil(part.length / 9))
    gaps = [part.length * i / count for i in range(count + 1)]
    matches = []
    for start, finish in zip(gaps, gaps[1:]):
        xy = part.interpolate((start + finish) / 2)
        sample = original.interpolate(original.project(xy)).coords[0]
        a, b = part.interpolate(start), part.interpolate(finish)
        length = a.distance(b)
        direction = ((b.x - a.x) / length, (b.y - a.y) / length) if length else None
        matches.append((start, finish, motorway.match(sample, kind, direction, source_level)))
    refined = []
    for start, finish, match in matches:
        if not match or match[7] <= 0:
            refined.append((start, finish, match))
            continue
        # Preserve accurate deck ends where AHN drops away from an elevated
        # shoulder faster than the fitted road profile tapers back to terrain.
        count = math.ceil((finish - start) / 1.5)
        for i in range(count):
            a = start + (finish - start) * i / count
            b = start + (finish - start) * (i + 1) / count
            midpoint = part.interpolate((a + b) / 2)
            refined.append((a, b, 'unsupported' if motorway.unsupported_shoulder(midpoint.x, midpoint.y, match)
                           else match))
    def group_key(row):
        match = row[2]
        if not isinstance(match, tuple):
            return match
        return (match[1], *match[6:9]) if split_by_way else match[6:8]

    for key, group in groupby(refined, key=group_key):
        rows = list(group)
        start, _, _ = rows[0]
        _, finish, _ = rows[-1]
        yield substring(part, start, finish), [row[2] for row in rows] if isinstance(key, tuple) else key


def import_line(original, kind, motorway, stats, source_level=None):
    for part in line_parts(original.intersection(motorway.corridor)):
        for section, matches in assignments(part, original, motorway, kind, source_level):
            if matches == 'unsupported':
                stats['unsupportedShoulderSegments'] += 1
                continue
            if section.length < 1.15:
                stats['shortSegments'] += 1
                continue
            if not matches:
                stats['elevationOrCarriagewayUnmatched'] += 1
                continue
            profile, layer = matches[0][6:8]
            match = min(matches, key=lambda item: item[0])
            source_elevation = [original.interpolate(original.project(Point(p))).z for p in section.coords]
            trimmed = motorway.remove_wall_overlap(section, layer)
            if trimmed.length < section.length - 0.25:
                stats['bgtWallOverlap'] += 1
            for remaining in line_parts(trimmed):
                if remaining.length < 1.15:
                    continue
                blocked = motorway.blocks_access(remaining, layer)
                stats['accessIntersection'] += int(blocked)
                review = blocked or match[8]
                feature = {
                    **motorway.references(match), 'level': layer,
                    'points': [snap(point) for point in remaining.simplify(0.19).coords],
                    'observedNap': [round(min(source_elevation), 2), round(max(source_elevation), 2)],
                    'collidable': not review and all(abs(item[4]) >= item[2].data['width'] / 2 - 0.8
                                                     for item in matches),
                }
                if profile:
                    feature['profileId'] = profile
                if blocked:
                    feature['review'] = 'alignment intersects a mapped road or path'
                yield feature


