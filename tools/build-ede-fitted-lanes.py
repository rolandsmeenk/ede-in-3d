#!/usr/bin/env python3
"""Fit geometry to the unchanged directed Ede motor graph in RD New."""

import argparse
from collections import Counter, defaultdict
from functools import lru_cache
from itertools import pairwise
import json
import math
from pathlib import Path
import re
from statistics import median
import subprocess

from shapely import STRtree, make_valid, remove_repeated_points, transform, union_all
from shapely import prepare as prepare_geometry
from shapely.geometry import LineString, MultiPoint, Point, Polygon, box
from shapely.ops import nearest_points

from ede_gis import Frame, VERSION as GIS_VERSION, source_crs
from ede_motorway_infrastructure import ROOT, read_json, write_json

OUT = ROOT / 'assets/ede-fitted-lanes.json.gz'
REVIEW = ROOT / 'tools/data/ede-fitted-lanes.review.json.gz'
BGT = ROOT / 'assets/ede-road-surfaces.json.gz'
RWS = ROOT / 'tools/data/ede-1gis.snapshot.json.gz'
NWB = ROOT / 'tools/data/ede-motorway-lanes.snapshot.json'
AERIAL = ROOT / 'tools/data/ede-lane-aerial-traces.json'
COUNTS = ROOT / 'assets/ede-motorway-lanes.json'

MOTOR_BGT = {'rijbaan lokale weg', 'rijbaan regionale weg', 'rijbaan autosnelweg',
             'verbindingsweg', 'ov-baan', 'woonerf', 'verkeersdrempel', 'overweg'}
PROTECTED_BGT = {'fietspad', 'parkeervlak', 'verkeerseiland'}
LEVELS = {'Maaiveld': 0, 'MaaiveldPlus1': 1, 'MaaiveldPlus2': 2,
          'MaaiveldMin1': -1, 'MaaiveldMin2': -2}
MIN_EDGE = 4.0


def import_graph():
    command = ['node', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
               str(ROOT / 'tools/export-ede-traffic-graph.mjs'), '--lane-fitting']
    return json.loads(subprocess.run(command, capture_output=True, check=True, timeout=30).stdout)


def parts(geometry, type_):
    if geometry.geom_type == type_ and not geometry.is_empty:
        yield geometry
    elif hasattr(geometry, 'geoms'):
        for item in geometry.geoms:
            yield from parts(item, type_)


def shape_points(coords):
    return list(zip(coords[::2], coords[1::2]))


def rd_geometry(geometry, frame):
    return transform(geometry, frame.scene_to_rd, interleaved=False)


def file_geometry(row, crs, frame):
    geom = row['geometry']
    points = geom['coordinates']
    if geom['type'] == 'LineString':
        points = [points]
    return union_all([LineString([frame.to_rd(*point[:2], crs, axis_order='xy')
                                  for point in line]) for line in points if len(line) >= 2])


def vec(a, b):
    return b[0] - a[0], b[1] - a[1]


def unit(a, b):
    x, y = vec(a, b)
    length = math.hypot(x, y)
    return (x / length, y / length) if length else (1.0, 0.0)


def norm(a):
    return a[1], -a[0]


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1]


def move(point, direction, length):
    return point[0] + direction[0] * length, point[1] + direction[1] * length


def blend(a, b, t):
    return a + (b - a) * t


def smooth(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


class Surfaces:
    def __init__(self, rows, frame, aerial_exclusions):
        self.rows = defaultdict(list)
        for row in rows:
            protected = row['function'] in PROTECTED_BGT
            if not protected and row['function'] not in MOTOR_BGT:
                continue
            for outer, *holes in row['polygons']:
                polygon = Polygon(shape_points(outer), [shape_points(hole) for hole in holes])
                shape = make_valid(rd_geometry(polygon, frame))
                self.rows[row['layer']].extend((p, protected, row['id']) for p in parts(shape, 'Polygon'))
        for layer, shape, identity in aerial_exclusions:
            self.rows[layer].append((shape, True, identity))
        self.trees = {layer: STRtree([p for p, _, _ in rows]) for layer, rows in self.rows.items()}

    @lru_cache(maxsize=1024)
    def combine(self, layer, indices):
        rows = [self.rows[layer][i] for i in indices]
        drive = union_all([p for p, blocked, _ in rows if not blocked])
        exclusions = union_all([p for p, blocked, _ in rows if blocked])
        # Small cracks between independently surveyed surfaces are below the placement precision.
        legal = drive.buffer(.06).difference(exclusions)
        prepare_geometry(legal)
        return legal, exclusions, [identity for _, blocked, identity in rows if not blocked]

    def local(self, layer, a, b, reach=14):
        tree = self.trees.get(layer)
        if tree is None:
            return Polygon(), Polygon(), []
        x0, y0 = a
        x1, y1 = b
        area = box(min(x0, x1) - reach, min(y0, y1) - reach,
                   max(x0, x1) + reach, max(y0, y1) + reach)
        return self.combine(layer, tuple(sorted(tree.query(area))))


def stripe_role(attributes):
    label = attributes['type'].casefold()
    info = attributes.get('infox1', '').casefold()
    if label.startswith('blok'):
        return 'block'
    if label.startswith(('stop', 'calibratie', 'driehoek')):
        return None
    if info == 'kantstreep':
        return 'edge'
    if info == 'deelstreep' or re.match(r'\d[\d,]*\s*-', label) or label == 'onderbrokenstreep':
        return 'divider'
    if label.startswith(('onond', 'doorgetrokken')):
        return 'solid'
    return None


class Markings:
    def __init__(self, raw, aerial, frame):
        self.rows = []
        crs = source_crs(raw)
        for row in raw['layers']['30']:
            attributes = row['attributes']
            role = stripe_role(attributes)
            level = LEVELS.get(attributes.get('niveau'))
            if role is None or level is None:
                continue
            for path in row['geometry'].get('paths', []):
                if len(path) < 2:
                    continue
                line = remove_repeated_points(LineString([frame.to_rd(*p[:2], crs, axis_order='xy')
                                                            for p in path]))
                if line.length >= .6:
                    self.rows.append((line, role, level, None, attributes['gisobjid'], '1gis'))
        self.exclusions = []
        if aerial:
            crs = source_crs(aerial)
            for row in aerial['markings']:
                if row.get('use', True) is False:
                    continue
                path = [frame.to_rd(*p[:2], source_crs(row, default=crs), axis_order='xy') for p in row['points']]
                level = row.get('layer', 0)
                if row['kind'] == 'exclusion':
                    self.exclusions.extend((level, p, row['id']) for p in parts(make_valid(Polygon(path)), 'Polygon'))
                elif len(path) >= 2:
                    self.rows.append((LineString(path), row['kind'], level, set(row['wayIds']), row['id'], 'aerial'))
            for row in aerial.get('exclusions', []):
                coords = row.get('points') or row.get('ring')
                if coords:
                    shape = Polygon([frame.to_rd(*p[:2], source_crs(row, default=crs), axis_order='xy') for p in coords])
                    self.exclusions.extend((row.get('layer', 0), p, row['id'])
                                           for p in parts(make_valid(shape), 'Polygon'))
        self.tree = STRtree([row[0] for row in self.rows])

    def station_hits(self, edge, center, axis, motorway):
        right = norm(axis)
        radius = min(32, max(edge['width'] * .85, 10))
        section = LineString([move(center, right, -radius), move(center, right, radius)])
        hits = []
        for index in self.tree.query(section, predicate='dwithin', distance=.38):
            line, role, layer, ways, identity, source = self.rows[index]
            if layer != edge['layer'] or ways is not None and edge['way'] not in ways or not motorway and source != 'aerial':
                continue
            p = nearest_points(section, line)[1]
            along = line.project(p)
            # Reject cross-street paint, stop bars, or the ends of diagonal hatch stripes.
            tangent = unit(line.interpolate(max(0, along - .5)).coords[0],
                           line.interpolate(min(line.length, along + .5)).coords[0])
            if abs(dot(tangent, axis)) < .86:
                continue
            hits.append((dot(vec(center, p.coords[0]), right), role, identity, source))
        return sorted(hits)


class MotorwayEvidence:
    def __init__(self, bundle, counts, frame):
        self.rows = {row['id']: row for row in bundle['weggeg']}
        self.nwb = {row['properties']['wvk_id']: row for row in bundle['nwb']}
        self.official = counts['records']
        self.frame = frame
        self.crs = source_crs(bundle, default='OGC:CRS84')

    @lru_cache(maxsize=None)
    def geometry(self, record_id):
        row = self.rows.get(record_id)
        official = self.official.get(record_id)
        if not row or not official:
            return None
        route = official['route']
        road = self.nwb.get(row['properties']['wvk_id'])
        if route not in ('A12', 'A30') or not road or not row.get('geometry') or not road.get('geometry'):
            return None
        return (route, official['beginLanes'], official['endLanes'],
                file_geometry(row, source_crs(row, default=self.crs), self.frame),
                file_geometry(road, source_crs(road, default=self.crs), self.frame))

    def matches(self, edge, point):
        count = len(edge['laneDefinition']['lanes'])
        matches = []
        for key in edge['laneDefinition'].get('evidence', {}).get('records', []):
            info = self.geometry(key)
            if not info:
                continue
            route, begin, end, weggeg, nwb = info
            if count in (begin, end) and nwb.distance(point) < 18 and weggeg.distance(point) < 24:
                matches.append((key, route))
        return matches


def nominal(edge):
    definition = edge['laneDefinition']
    lanes = definition['lanes']
    return [(lane['offset'], lane['width']) for lane in lanes]


def legal_sections(domain, center, right, reach):
    cut = LineString([move(center, right, -reach), move(center, right, reach)])
    intervals = []
    for part in parts(domain.intersection(cut), 'LineString'):
        points = part.coords
        a, b = sorted(dot(vec(center, p), right) for p in (points[0], points[-1]))
        if b - a > 1:
            intervals.append((a, b))
    return intervals


def bike_exclusions(edge, start, end, right):
    for lane in edge['laneDefinition']['bikes']:
        if lane['kind'] != 'lane':
            continue
        low, high = (lane['offset'] - lane['width'] / 2, lane['offset'] + lane['width'] / 2)
        yield Polygon([move(p, right, lateral)
                       for p, lateral in ((start, low), (start, high), (end, high), (end, low))])


def bgt_section(edge, intervals):
    lanes = nominal(edge)
    definition = edge['laneDefinition']
    total = definition['totalCount']
    old_width = definition['width']
    nominal_mean = sum(offset for offset, _ in lanes) / len(lanes)
    candidates = []
    for low, high in intervals:
        original_width = high - low
        if not old_width * .62 <= original_width <= max(old_width * 1.45, old_width + 1.4):
            continue
        if not low - 1.0 <= nominal_mean <= high + 1.0:
            continue
        available = high - low
        width = min(4.1, available / total)
        if width < (2.37 if edge['modes'] & 1 else 2.65):
            continue
        order = total - len(lanes)
        fitted = [(low + available / 2 + (order + i + .5 - total / 2) * width, width)
                  for i in range(len(lanes))]
        score = abs((low + high) / 2) + .38 * abs(original_width - old_width)
        candidates.append((score, fitted))
    if not candidates:
        return None
    candidates.sort(key=lambda item: item[0])
    if len(candidates) > 1 and candidates[1][0] - candidates[0][0] < 1.25:
        return None
    return candidates[0][1]


def marking_fit(edge, hits, motorway):
    lanes = nominal(edge)
    widths = [w for _, w in lanes]
    boundaries = [lanes[0][0] - widths[0] / 2] + [offset + width / 2 for offset, width in lanes]
    count = len(lanes)
    if len(hits) < 2:
        return None
    tolerance = 1.10 if motorway else 1.25
    midpoint = (boundaries[0] + boundaries[-1]) / 2
    scales = [1.]
    if not motorway and count > 1:
        nominal_width = median(widths)
        observed_gaps = [q[0] - p[0] for p, q in pairwise(hits) if 2.2 <= q[0] - p[0] <= 4.3]
        if observed_gaps:
            scales.append(median(observed_gaps) / nominal_width)
    candidates = []
    for scale in scales:
        trial = [midpoint + (value - midpoint) * scale for value in boundaries]
        for hit in hits:
            for boundary in trial:
                shift = hit[0] - boundary
                if abs(shift) > (4.8 if motorway else 4.0):
                    continue
                selected = []
                score = abs(shift) * .24 + abs(1 - scale) * .2
                for i, offset in enumerate(trial):
                    choices = []
                    for candidate in hits:
                        side, role, _, source = candidate
                        gap = abs(side - offset - shift)
                        if gap > tolerance:
                            continue
                        edge_line = i in (0, count)
                        if role == 'edge' and not edge_line:
                            continue
                        penalty = .18 if role == 'solid' else .25 if edge_line and role == 'divider' else 0
                        if motorway and source == 'aerial':
                            penalty += .25
                        choices.append((gap + penalty, candidate))
                    if choices:
                        error, candidate = min(choices)
                        selected.append(candidate)
                        score += error
                    else:
                        selected.append(None)
                        score += 1.9
                observed = [item for item in selected if item]
                evidence_min = max(2, count)
                if (len(observed) < evidence_min or len(set(observed)) != len(observed)
                        or count > 1 and not any(item and item[1] != 'edge' for item in selected[1:-1])):
                    continue
                deltas = [hit[0] - offset for hit, offset in zip(selected, trial) if hit]
                middle = median(deltas)
                positions = [hit[0] if hit else offset + middle for hit, offset in zip(selected, trial)]
                widths_found = [b - a for a, b in pairwise(positions)]
                if any(not (2.72 if motorway else 2.2) <= w <= (4.45 if motorway else 4.3) for w in widths_found):
                    continue
                score += sum(abs(w - median(widths_found)) for w in widths_found) * .2
                candidates.append((score, [((a + b) / 2, b - a) for a, b in pairwise(positions)], observed))
    if not candidates:
        return None
    candidates.sort(key=lambda q: q[0])
    best = candidates[0]
    # An equally plausible different marking band can belong to a parallel exit or carriageway.
    for other in candidates[1:]:
        if other[0] - best[0] > .60:
            break
        if max(abs(a[0] - b[0]) for a, b in zip(best[1], other[1])) > .95:
            return None
    return best[1:]


def stations(length, step):
    count = max(2, math.ceil(length / step))
    return [length * i / count for i in range(count + 1)]


def old_xy(edge, lane, s):
    x, z, _ = edge['inset']
    dx, dz = edge['axis']
    lateral = edge['lanes'][lane]
    return x + dx * s - dz * lateral, z + dz * s + dx * lateral


def axis_points(edge, frame):
    x, z, length = edge['inset']
    dx, dz = edge['axis']
    a = frame.scene_to_rd(x, z)
    b = frame.scene_to_rd(x + dx * length, z + dz * length)
    return a, b


def sample_path(rows, t):
    for a, b in pairwise(rows):
        if t <= b[0]:
            f = max(0, min(1, (t - a[0]) / (b[0] - a[0])))
            return blend(a[1], b[1], f), blend(a[2], b[2], f), blend(a[3], b[3], f)
    return rows[-1][1:]


def swept(rows, pavement, bus=False, *, segment=False):
    if not rows or pavement.is_empty:
        return False
    length = rows[-1][0]
    # Standard simulator clearance envelopes plus a margin. The bus envelope applies only to GTFS-used lanes.
    half_width, half_length = (1.35, 6.1) if bus else (1.075, 3.0)
    boxes = []
    for s in stations(length, 1.8 if bus else 2.0):
        x, y, _ = sample_path(rows, s)
        a, b = sample_path(rows, max(0, s - .4)), sample_path(rows, min(length, s + .4))
        u = unit(a, b)
        r = norm(u)
        # Include front/rear of the vehicle as it traverses this route and adjoining connectors.
        corner = [move(move((x, y), u, longitudinal), r, lateral)
                  for longitudinal in (-half_length, half_length) for lateral in (-half_width, half_width)]
        boxes.append(corner)
    limits = None
    if segment:
        # Junctions check what happens beyond these stations using their own swept geometry.
        start, end = rows[0][1:3], rows[-1][1:3]
        entry, exit_ = unit(start, rows[1][1:3]), unit(rows[-2][1:3], end)
        reach = max(length * 2, 30)

        def half_plane(point, heading):
            right = norm(heading)
            outer = move(point, heading, reach)
            return Polygon([move(p, right, lateral)
                            for p, lateral in ((point, -reach), (point, reach), (outer, reach), (outer, -reach))])

        limits = half_plane(start, entry).intersection(half_plane(end, (-exit_[0], -exit_[1])))
    for i, (a, b) in enumerate(pairwise(boxes)):
        hull = MultiPoint(a + b).convex_hull
        if limits is not None and (i < 5 or i >= len(boxes) - 6):
            hull = hull.intersection(limits)
        if not pavement.covers(hull):
            return False
    return True


def fill_missing(samples, step, coverage):
    known = [i for i, value in enumerate(samples) if value is not None]
    if not known or len(known) / len(samples) < coverage:
        return None
    filled = []
    for i, current in enumerate(samples):
        if current is not None:
            filled.append(current)
            continue
        before = max((j for j in known if j < i), default=None)
        after = min((j for j in known if j > i), default=None)
        if before is None or after is None:
            j = after if before is None else before
            if abs(j - i) * step > 10:
                return None
            filled.append(samples[j])
        else:
            if (after - before) * step > 25:
                return None
            t = (i - before) / (after - before)
            filled.append([(blend(a[0], b[0], t), blend(a[1], b[1], t))
                           for a, b in zip(samples[before], samples[after])])
    return filled


def smooth_sections(sections, step):
    result = []
    for i, current in enumerate(sections):
        earlier, later = sections[max(0, i - 1)], sections[min(len(sections) - 1, i + 1)]
        result.append([(a[0] * .15 + b[0] * .7 + c[0] * .15,
                        a[1] * .15 + b[1] * .7 + c[1] * .15) for a, b, c in zip(earlier, current, later)])
    for a, b in pairwise(result):
        if any(abs(v[0] - w[0]) > .34 * step + .14 for v, w in zip(a, b)):
            return None
    return result


def prepare(edge, pavement, markings, nwb, frame):
    length = edge['inset'][2]
    if edge.get('boundary') or length < MIN_EDGE or not edge.get('openLanes'):
        return None, 'short/boundary/unknown-layout'
    a, b = axis_points(edge, frame)
    axis = unit(a, b)
    right = norm(axis)
    dist = math.dist(a, b)
    sample_stations = stations(length, 4.5)
    step = sample_stations[1]
    motorway = edge['kind'].startswith('motorway')
    legal, _, source_ids = pavement.local(edge['layer'], a, b, edge['width'] + 12)
    if not source_ids:
        return None, 'no same-level BGT motor pavement'
    dedicated_bike_space = list(bike_exclusions(edge, a, b, right))
    if dedicated_bike_space:
        # Keep the surveyed width for inference while treating painted cycle lanes as blocked.
        fit_pavement = legal.difference(union_all(dedicated_bike_space))
        prepare_geometry(fit_pavement)
    else:
        fit_pavement = legal
    samples, markings_used, marks_sources = [], set(), set()
    matches = nwb.matches(edge, Point(move(a, axis, dist / 2))) if motorway else []
    audit_samples = []
    for s in sample_stations:
        center = move(a, axis, s / length * dist)
        hits = markings.station_hits(edge, center, axis, motorway)
        section = marking_fit(edge, hits, motorway)
        if section:
            fit, observed = section
            samples.append(fit)
            markings_used.update(hit[2] for hit in observed)
            marks_sources.update(hit[3] for hit in observed)
            audit_samples.append(True)
            continue
        audit_samples.append(False)
        if motorway:
            samples.append(None)
        else:
            cross_sections = legal_sections(legal, center, right, min(28, edge['width'] * .85 + 5))
            fit = bgt_section(edge, cross_sections)
            if fit and dedicated_bike_space:
                # The lane offsets remain in graph order. Check each allocated lane against the motor band.
                drive_sections = legal_sections(fit_pavement, center, right, min(28, edge['width'] * .85 + 5))
                fit = next((inset for interval in drive_sections
                            if (inset := bgt_section(edge, [interval])) and
                            any(interval[0] <= offset <= interval[1] for offset, _ in fit)), None)
            samples.append(fit)
    if motorway and not matches and sum(audit_samples) / len(samples) < .90:
        return None, 'motorway count or markings uncorroborated'
    filled = fill_missing(samples, step, .68 if motorway else .74)
    if not filled:
        return None, 'intermittent or ambiguous cross-sections'
    fitted = smooth_sections(filled, step)
    if not fitted:
        return None, 'abrupt lane variation'
    lanes = []
    for lane, index in enumerate(edge['openLanes']):
        if index < 0:
            return None, 'invalid lane index'
        lane_rows = []
        for s, section in zip(sample_stations, fitted):
            center = move(a, axis, s / length * dist)
            offset, width = section[index]
            x, y = move(center, right, offset)
            lane_rows.append((s, x, y, width))
        lanes.append(lane_rows)
    source = ('1gis' if '1gis' in marks_sources else 'bgt')
    if 'aerial' in marks_sources:
        source += '+aerial'
    return {
        'edge': edge, 'pavement': fit_pavement, 'lanes': lanes,
        'source': source, 'confidence': 'high' if markings_used and (not motorway or matches) else 'medium',
        'sourceIds': sorted(markings_used), 'nwb': sorted(matches), 'bgt': sorted(set(source_ids)),
        'fade': [[False, False] for _ in lanes],
    }, None


def adjusted(candidate, lane, frame, strength=1):
    edge = candidate['edge']
    length = edge['inset'][2]
    left, right = candidate['fade'][lane]
    source = candidate['lanes'][lane]
    changes = []
    # At fallback junctions, retain the exact original tangent over the last metre of the approach.
    fade = min(14, length * .38)
    if left:
        changes += [min(1.0, length * .08), fade]
    if right:
        changes += [length - min(1.0, length * .08), length - fade]
    sample = sorted(set([row[0] for row in source] + changes))
    result = []
    for s in sample:
        x, y, width = sample_path(source, s)
        ax, ay = frame.scene_to_rd(*old_xy(edge, lane, s))
        scale = strength
        if left:
            scale *= smooth((s - min(1.0, length * .08)) / fade)
        if right:
            scale *= smooth((length - s - min(1.0, length * .08)) / fade)
        result.append((s, blend(ax, x, scale), blend(ay, y, scale),
                       blend(edge['offsetWidths'][lane], width, scale)))
    return result


def scene_rows(rows, frame):
    return [(s, *frame.rd_to_scene(x, y), width) for s, x, y, width in rows]


def rounded_rd(rows, frame):
    return [(round(s, 3), *frame.scene_to_rd(round(x, 3), round(z, 3)), round(width, 3))
            for s, x, z, width in scene_rows(rows, frame)]


def simplified(rows, tolerance=.065):
    if len(rows) < 3:
        return rows
    a, b = rows[0], rows[-1]
    scale = b[0] - a[0]
    def error(row):
        t = (row[0] - a[0]) / scale
        return max(math.hypot(row[1] - blend(a[1], b[1], t), row[2] - blend(a[2], b[2], t)),
                   abs(row[3] - blend(a[3], b[3], t)))
    i = max(range(1, len(rows) - 1), key=lambda i: error(rows[i]))
    if error(rows[i]) <= tolerance:
        return [a, b]
    return simplified(rows[:i + 1], tolerance)[:-1] + simplified(rows[i:], tolerance)


def pack_rows(rows):
    result = []
    distance = 0
    previous = None
    for s, x, z, width in rows:
        point = round(x, 3), round(z, 3)
        if previous:
            distance += math.dist(previous, point)
        result.extend((round(s, 3), *point, round(distance, 3), round(width, 3)))
        previous = point
    return result


def fitted_lane(candidate, lane, frame, strength):
    rows = adjusted(candidate, lane, frame, strength)
    left, right = candidate['fade'][lane]
    first, last = int(left), len(rows) - int(right)
    return rows[:first] + simplified(rows[first:last]) + rows[last:]


def cubic(ctrl, t):
    u = 1 - t
    return tuple(u ** 3 * a + 3 * u * u * t * b + 3 * u * t * t * c + t ** 3 * d
                 for a, b, c, d in zip(*ctrl))


def connector_rows(move_spec, edges, lane_rows, surfaces, frame):
    aid, i, bid, j, length, old, turn, bus = move_spec
    a, b = edges[aid], edges[bid]
    if a['layer'] != b['layer'] or length < .16:
        return None
    first, second = lane_rows.get((aid, i)), lane_rows.get((bid, j))
    p0b, p1b, p2b, p3b = [frame.scene_to_rd(*p) for p in zip(old[::2], old[1::2])]
    p0 = first[-1][1:3] if first else p0b
    p3 = second[0][1:3] if second else p3b
    u = unit(first[-2][1:3], p0) if first else unit(p0b, p1b)
    v = unit(p3, second[1][1:3]) if second else unit(p2b, p3b)
    end_changes = (math.dist(p0, p0b)>.008 or dot(u, unit(p0b, p1b))<.9999,
                   math.dist(p3, p3b)>.008 or dot(v, unit(p2b, p3b))<.9999)
    if not any(end_changes):
        return [], end_changes
    pavement, _, ids = surfaces.local(a['layer'], p0, p3, 15)
    if not ids:
        return None
    span = math.dist(p0, p3)
    if span < .14:
        return None
    w0 = first[-1][3] if first else a['offsetWidths'][i]
    w3 = second[0][3] if second else b['offsetWidths'][j]
    k0 = min(span * .8, max(span * .18, math.dist(p0b, p1b)))
    k3 = min(span * .8, max(span * .18, math.dist(p2b, p3b)))
    fit = [p0, move(p0, u, k0), move(p3, v, -k3), p3]
    samples = [cubic(fit, t / 16) for t in range(17)]
    cumulative = [0.0]
    for a0, b0 in pairwise(samples):
        cumulative.append(cumulative[-1] + math.dist(a0, b0))
    # Fitted connectors follow the original logical station domain used by reservations and bus runs.
    rd = [(length * d / cumulative[-1], *p, blend(w0, w3, d / cumulative[-1]))
          for d, p in zip(cumulative, samples)]
    return (rd, end_changes) if swept(rounded_rd(rd, frame), pavement, bus) else None


def fit_many(graph, surfaces, markings, evidence, frame):
    edges = {row['id']: row for row in graph['edges']}
    counts = Counter()
    fallbacks = []
    accepted = {}
    for edge in edges.values():
        fit, reason = prepare(edge, surfaces, markings, evidence, frame)
        if fit is None:
            counts[reason] += 1
            fallbacks.append([edge['key'], reason])
        else:
            accepted[edge['id']] = fit
    print(f'{len(accepted)} directed edge candidates before footprint and connector checks', flush=True)
    lane_rows = {}
    connectors = {}
    settled = False
    invalid_moves = set()
    by_bus_lane = {int(k): set(v) for k, v in graph['busLanes'].items()}
    baseline_outside = set()
    for id_, candidate in accepted.items():
        edge = candidate['edge']
        if any(not swept([(s, *frame.scene_to_rd(*old_xy(edge, lane, s)), width)
                          for s in (0., edge['inset'][2])], candidate['pavement'],
                         lane in by_bus_lane.get(id_, ()), segment=True)
               for lane, width in enumerate(edge['offsetWidths'])):
            baseline_outside.add(edge['key'])
    checked_footprints = len(accepted)
    for pass_number in range(12):
        lane_rows = {}
        needed_changes = set()
        dropped = set()
        for id_, candidate in accepted.items():
            options = []
            for strength in (1.0, .66, .33):
                adjusted_rows = [fitted_lane(candidate, lane, frame, strength)
                                 for lane in range(len(candidate['lanes']))]
                for lane, rows in enumerate(adjusted_rows):
                    bus = lane in by_bus_lane.get(id_, ())
                    if not swept(rounded_rd(rows, frame), candidate['pavement'], bus, segment=True):
                        break
                else:
                    options = adjusted_rows
                    break
            if options:
                lane_rows.update({(id_, lane): rows for lane, rows in enumerate(options)})
            else:
                dropped.add(id_)
        for id_ in dropped:
            counts['swept footprint outside usable pavement'] += 1
            fallbacks.append([edges[id_]['key'], 'swept footprint outside usable pavement'])
            del accepted[id_]
        connectors = {}
        for row in graph['moves']:
            aid, i, bid, j, length, old, _, _ = row
            if (aid, i) not in lane_rows and (bid, j) not in lane_rows:
                continue
            result = connector_rows(row, edges, lane_rows, surfaces, frame)
            if result is None:
                invalid_moves.add((aid, i, bid, j))
                for id_, lane, side in ((aid, i, 1), (bid, j, 0)):
                    candidate = accepted.get(id_)
                    if candidate and not candidate['fade'][lane][side]:
                        needed_changes.add((id_, lane, side))
            elif result[0]:
                connectors[(aid, i, bid, j)] = result[0]
        if not needed_changes and not dropped:
            settled = True
            break
        for id_, lane, side in needed_changes:
            accepted[id_]['fade'][lane][side] = True
        print(f'Connector pass {pass_number + 1}: {len(dropped)} dropped edges, '
              f'{len(needed_changes)} ends held to legacy', flush=True)
    if not settled:
        raise RuntimeError('Lane and connector fallback did not stabilize')
    result = {}
    kept_residuals = []
    moved_edges = {id_ for a, _, b, _ in connectors for id_ in (a, b)}
    for id_, candidate in accepted.items():
        edge = edges[id_]
        rows = []
        shifts = []
        for lane in range(len(edge['lanes'])):
            scene = scene_rows(lane_rows[id_, lane], frame)
            shifts.append(max(math.dist(row[1:3], old_xy(edge, lane, row[0])) for row in scene))
            rows.append(pack_rows(scene))
        if max(shifts) < .12 and id_ not in moved_edges:
            counts['already aligned'] += 1
            continue
        kept_residuals.append(max(shifts))
        result[edge['key']] = {'source': candidate['source'], 'confidence': candidate['confidence'],
                               'start': [round(v, 3) for v in edge['inset'][:2]],
                               'paint': graph['paint'].get(edge['key']), 'lanes': rows}
    baked_connectors = defaultdict(lambda: defaultdict(dict))
    for (aid, i, bid, j), rows in connectors.items():
        a, b = edges[aid]['key'], edges[bid]['key']
        if a not in result and b not in result:
            continue
        baked_connectors[a][b][f'{i}:{j}'] = pack_rows(scene_rows(rows, frame))
    evidence_rows = {
        edges[id_]['key']: {key: candidate[key] for key in ('source', 'confidence', 'sourceIds', 'nwb', 'bgt')}
        for id_, candidate in accepted.items() if edges[id_]['key'] in result
    }
    counts.update(row['source'] for row in result.values())
    report = {
        'graphEdges': len(edges), 'graphConnectors': len(graph['moves']), 'fittedEdges': len(result),
        'fittedConnectors': sum(len(lanes) for destinations in baked_connectors.values() for lanes in destinations.values()),
        'counts': dict(counts), 'maxFittedShiftM': round(max(kept_residuals, default=0), 3),
        'footprintAudit': {
            'checkedDirectedEdges': checked_footprints,
            'baselineOutsideDirectedEdges': len(baseline_outside),
            'remainingOutsideDirectedEdges': len(baseline_outside - result.keys()),
            'remainingOutside': sorted(baseline_outside - result.keys()),
            'scope': 'Same-level BGT and reviewed exclusions on edges with usable cross-section evidence',
        },
        'fallbackEdges': fallbacks,
        'unfittedConnectorChecks': [[edges[a]['key'], i, edges[b]['key'], j] for a, i, b, j in sorted(invalid_moves)],
        'evidence': evidence_rows,
    }
    return {'version': 1, 'gisVersion': GIS_VERSION, 'edges': result, 'connectors': baked_connectors}, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--graph', type=Path, help='Existing export-ede-traffic-graph --lane-fitting output')
    parser.add_argument('--aerial', type=Path, default=AERIAL)
    parser.add_argument('--output', type=Path, default=OUT)
    parser.add_argument('--report', type=Path, default=REVIEW)
    cli = parser.parse_args()
    graph = read_json(cli.graph) if cli.graph else import_graph()
    frame = Frame(graph['lonLatAffine'])
    raw, bgt = read_json(RWS), read_json(BGT)
    aerial = read_json(cli.aerial) if cli.aerial.exists() else None
    markings = Markings(raw, aerial, frame)
    surfaces = Surfaces(bgt['surfaces'], frame, markings.exclusions)
    evidence = MotorwayEvidence(read_json(NWB), read_json(COUNTS), frame)
    asset, report = fit_many(graph, surfaces, markings, evidence, frame)
    write_json(cli.output, asset)
    report.update({'assetBytes': cli.output.stat().st_size, 'gisVersion': GIS_VERSION,
                   'sources': {'1gis': raw['date'], 'bgt': bgt['date'], 'aerial': cli.aerial.name if aerial else None}})
    write_json(cli.report, report)
    print({k: v for k, v in report.items()
           if k not in ('fallbackEdges', 'unfittedConnectorChecks', 'evidence', 'footprintAudit')})
    print({k: v for k, v in report['footprintAudit'].items() if k != 'remainingOutside'})


if __name__ == '__main__':
    main()
