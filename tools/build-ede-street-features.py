#!/usr/bin/env python3
"""Match surveyed Ede street furniture and surfaces to directed game edges."""

import argparse
from collections import Counter
import gzip
import json
import math
from pathlib import Path
import re

from shapely.geometry import LineString, Point, Polygon

from ede_traffic_geometry import SegmentIndex, load_graph, normalize_name

ROOT = Path(__file__).resolve().parents[1]
MOTOR, BICYCLE, FOOT = 7, 8, 16


def rounded(value):
    return round(float(value), 2)


def clamp(value, lo, hi):
    return max(lo, min(hi, value))


def point(feature):
    return feature['x'], feature['z']


def along(edge, at):
    station = clamp(edge.project(*at)[0], 0, edge.length)
    x = edge.a[0] + station * edge.ux
    z = edge.a[1] + station * edge.uz
    return station, math.hypot(at[0] - x, at[1] - z)


def direction(bearing):
    radians = math.radians(bearing)
    return math.sin(radians), -math.cos(radians)


def reference(edge, start, end, confidence):
    return dict(key=edge.data['key'], way=edge.data['way'], layer=edge.data.get('layer', 0),
                modes=edge.data['modes'], **{'from': rounded(start), 'to': rounded(end)},
                confidence=rounded(confidence))


def level(data):
    return data.get('layer') or 0, bool(data.get('bridge')), bool(data.get('tunnel'))


def level_ok(feature, edge):
    return all(feature.get(key) is None or feature[key] == edge.data.get(key, False)
               for key in ('layer', 'bridge', 'tunnel'))


def way_group(edge):
    return edge.data['way'], level(edge.data)


def sign_modes(sign):
    code = (sign.get('rvvCode') or '').upper()
    code = re.sub(r'^([A-Z])0+(\d)', r'\1\2', code)
    if code in {'G7', 'G8'}:
        return FOOT
    if code in {'G11', 'G12', 'G12A', 'G12B', 'G13', 'G14', 'C14'}:
        return BICYCLE
    if code in {'C2', 'C3', 'C4'}:
        return MOTOR | BICYCLE
    if code in {'C7A', 'C7B'}:
        return 4
    if code.startswith('A') or code in {'C6', 'C17', 'C18', 'C19', 'C20', 'C21'}:
        return MOTOR
    return None


def match_sign(sign, roads, paths):
    at = point(sign)
    evidence = sign.get('roadPoint')
    bearing = sign.get('appliesBearing')
    if bearing is None and sign.get('bearing') is not None:
        bearing = (sign['bearing'] + 180) % 360
    heading = direction(bearing) if bearing is not None else None
    modes = sign_modes(sign)
    road_name = normalize_name(sign.get('roadName') or sign.get('name'))
    candidates = []
    search = list(roads.near(*at))
    if modes in (BICYCLE, FOOT):
        search = [edge for edge in paths.near(*at) if edge.data['modes'] == modes] + search
    for edge in search:
        d = edge.data
        station, gap = along(edge, at)
        width = d.get('width') or 3
        if gap > min(24, width * 0.5 + 10):
            continue
        dot = heading[0] * edge.ux + heading[1] * edge.uz if heading else None
        if dot is not None and dot < 0.56:
            continue
        name = normalize_name(d.get('name'))
        mismatch = not level_ok(sign, edge)
        aligned_road = (bool(name and road_name == name)
                        or (re.fullmatch(r'rijkswega\d+', road_name) and (d.get('kind') or '').startswith('motorway'))
                        or modes in (BICYCLE, FOOT) and d['modes'] == modes)
        score = gap
        if evidence is not None:
            distance = along(edge, evidence)[1]
            if distance > 11:
                continue
            score = distance * 1.9 + gap * 0.28
        if mismatch:
            # NWB levels describe the relative crossing order. The game uses OSM layers,
            # which may number exactly the same fitted road or path differently.
            if evidence is None or distance > 1.8 or not aligned_road:
                continue
            score += 1.6
        if road_name and name:
            score += -2.5 if road_name == name else 7
        if dot is not None:
            score += 4 * (1 - dot)
        if modes in (BICYCLE, FOOT) and modes != d['modes']:
            score += 3
        candidates.append((score, d['key'], edge, station))
    if not candidates:
        return [], 'no compatible directed approach'
    candidates.sort(key=lambda item: (item[0], item[1]))
    best, _, edge, station = candidates[0]
    alternate = next((item for item in candidates[1:] if way_group(item[2]) != way_group(edge)), None)
    if alternate and alternate[0] - best < (1.2 if evidence else 2.3):
        if level(alternate[2].data) != level(edge.data):
            return [], 'conflicting elevation levels'
        return [], 'nearby alternative approach'
    confidence = min(0.99, 0.9 + (0.05 if evidence else 0) - max(0, best) * 0.015)
    relabelled = not level_ok(sign, edge)
    if relabelled:
        confidence = min(confidence, 0.8)
    if heading or sign.get('kind') != 'traffic':
        matches = [reference(edge, station, station, confidence if heading else min(0.75, confidence))]
        if not heading:
            for _, _, opposite, s in candidates[1:]:
                if way_group(opposite) == way_group(edge) and edge.ux * opposite.ux + edge.uz * opposite.uz < -0.94:
                    matches.append(reference(opposite, s, s, matches[0]['confidence']))
                    break
        return matches, ('NWB and game layer codes differ' if relabelled
                         else None if heading else 'informational sign without surveyed facing')
    # No bearing or official travel direction means two-way restrictions cannot be applied to either edge.
    if edge.data.get('oneway'):
        return [reference(edge, station, station, min(0.68, confidence))], 'one-way geometry only'
    return [], 'direction unavailable'


def indexed(index, at, radius):
    x, z = at
    return set(edge for sample in ([x, z], [x-radius, z], [x+radius, z], [x, z-radius], [x, z+radius])
               for edge in index.near(*sample))


def rectangle(feature):
    x, z = point(feature)
    dx, dz = feature['tangent']
    length = feature['length'] * 0.5
    width = feature['width'] * 0.5
    return Polygon([(x + a * dx - b * dz, z + a * dz + b * dx)
                    for a, b in [(-length,-width),(length,-width),(length,width),(-length,width)]])


def shape_for_bump(bump):
    rings = bump.get('footprint')
    if not rings:
        return rectangle(bump)
    if isinstance(rings[0][0], (int, float)):
        rings = [rings]
    geometry = Polygon(rings[0], rings[1:])
    return geometry if geometry.is_valid and not geometry.is_empty else rectangle(bump)


def way_hints(feature):
    direct = feature.get('wayIds') or ([feature['wayId']] if feature.get('wayId') else [])
    return set(direct) | set(feature.get('candidateWayIds', ()))


def lane_lines(edge):
    for offset in (0, *edge.data.get('lanes', ())):
        yield LineString([(x - edge.uz * offset, z + edge.ux * offset) for x, z in (edge.a, edge.b)])


def bump_links(bump, roads, paths):
    at = point(bump)
    shape = shape_for_bump(bump)
    radius = min(20, max(bump['width'], bump['length']) / 2)
    hints = way_hints(bump)
    candidates = indexed(roads, at, radius) | indexed(paths, at, radius)
    hits = []
    for edge in candidates:
        if not level_ok(bump, edge) or edge.data['modes'] == FOOT:
            continue
        alignment = abs(sum(a * b for a, b in zip(bump['tangent'], (edge.ux, edge.uz))))
        if alignment < (0.35 if bump['profile'] == 'table' else 0.72) and edge.data['way'] not in hints:
            continue
        for line in lane_lines(edge):
            section = line.intersection(shape)
            fragments = section.geoms if hasattr(section, 'geoms') else [section]
            for fragment in fragments:
                if fragment.geom_type != 'LineString' or fragment.length < 0.24:
                    continue
                start, end = sorted(along(edge, pt)[0] for pt in [fragment.coords[0], fragment.coords[-1]])
                confidence = 0.95 if edge.data['way'] in hints else 0.83
                hits.append((edge, start, end, confidence))
    if hints and hits:
        tiers = {level(edge.data) for edge, *_ in hits if edge.data['way'] in hints}
        if len(tiers) == 1:
            hits = [hit for hit in hits if level(hit[0].data) in tiers]
    if len({level(edge.data) for edge, *_ in hits}) > 1:
        return [], 'conflicting elevation levels'
    return [reference(*hit) for hit in hits], None if hits else 'no road or path intersects bump footprint'


def crossing_segments(crossing):
    return crossing.get('segments') or [crossing]


def crossing_links(crossing, roads, paths):
    result, sidewalks = [], []
    road_tiers = set()
    complete = True
    for segment in crossing_segments(crossing):
        before = len(result)
        ends = segment.get('ends') or crossing['ends']
        line = LineString(ends)
        hints = way_hints(segment) or way_hints(crossing)
        x, z = line.interpolate(0.5, normalized=True).coords[0]
        near = indexed(roads, (x, z), min(22, line.length / 2))
        for edge in near:
            if not level_ok(crossing, edge) or not level_ok(segment, edge):
                continue
            vector = abs(sum(a*b for a,b in zip(crossing['tangent'], (edge.ux,edge.uz))))
            if vector < 0.66 and edge.data['way'] not in hints:
                continue
            hits = [geometry for lane in lane_lines(edge) if not (geometry := lane.intersection(line)).is_empty]
            if not hits:
                # Marked crossings can occupy the mouth of a split edge.
                road = LineString([edge.a, edge.b])
                node = road.interpolate(road.project(line.interpolate(.5, normalized=True)))
                if edge.data['way'] not in hints or node.distance(line) > 1.7:
                    continue
                hits = [node]
            stations = [along(edge, geometry.representative_point().coords[0])[0] for geometry in hits]
            half = segment.get('length', crossing['length']) / 2
            road_tiers.add(level(edge.data))
            result.append(reference(edge, max(0, min(stations)-half), min(edge.length, max(stations)+half),
                                    0.96 if edge.data['way'] in hints else 0.85))
        complete &= len(result) > before
    if len(road_tiers) > 1:
        return [], [], 'conflicting elevation levels'

    points = crossing['ends']
    foot_hints = set(crossing.get('pathWayIds', ()))
    surveyed = set(map(str, crossing.get('osmNodeIds', ())))
    for p in points:
        near = []
        for edge in paths.near(*p):
            if edge.data['modes'] != FOOT or not level_ok(crossing, edge):
                continue
            if road_tiers and level(edge.data) not in road_tiers:
                continue
            station, gap = along(edge, p)
            if gap > 6.8:
                continue
            hint = edge.data['way'] in foot_hints
            if edge.data.get('crossing') and not (hint or str(edge.data['crossing'].get('osmId')) in surveyed):
                continue
            near.append((gap - (1.6 if hint else 0), gap, edge.data['key'], edge, station))
        near.sort(key=lambda item: item[:3])
        chosen = []
        if near:
            first = near[0]
            for score, gap, _, edge, station in near:
                if score > first[0] + 0.85 or way_group(edge) != way_group(first[3]):
                    continue
                item = reference(edge, station, station, max(0.48, 0.92 - gap * 0.068))
                chosen.append(item)
        result.extend(chosen)
        sidewalks.append(dict(point=p, edges=[ref['key'] for ref in chosen]))
    if not road_tiers:
        reason = 'no crossed road edge'
    elif not complete:
        reason = 'one or more carriageway strips unmatched'
    elif any(not end['edges'] for end in sidewalks):
        reason = 'sidewalk endpoint unmatched'
    else:
        reason = None
    return result, sidewalks, reason


def finalize(feature, refs, reason):
    edges = {}
    for ref in refs:
        old = edges.get(ref['key'])
        if old:
            old['from'] = min(old['from'], ref['from'])
            old['to'] = max(old['to'], ref['to'])
            old['confidence'] = max(old['confidence'], ref['confidence'])
        else:
            edges[ref['key']] = ref
    result = {**feature, 'edges': [edges[key] for key in sorted(edges)]}
    if not refs:
        result['match'] = 'unmatched'
    elif reason is not None or max(e['confidence'] for e in refs) < 0.7:
        result['match'] = 'uncertain'
    else:
        result['match'] = 'matched'
    if refs:
        strongest = max(refs, key=lambda ref: (ref['confidence'], ref['key']))
        if result.get('layer') is None:
            result['layer'] = strongest['layer']
        result['renderWay'] = strongest['way']
    if reason:
        result['matchReason'] = reason
    return result


def build(sign_source, surface_source, graph):
    paths = SegmentIndex(graph.paths, margin=24)
    signs, bumps, crossings = [], [], []
    bounds = graph.bounds
    in_bounds = lambda f: bounds[0] <= f['x'] <= bounds[2] and bounds[1] <= f['z'] <= bounds[3]
    for sign in sorted(filter(in_bounds, sign_source['signs']), key=lambda f: f['id']):
        refs, reason = match_sign(sign, graph.index, paths)
        sign = dict(sign)
        if sign.get('appliesBearing') is None and sign.get('bearing') is not None:
            sign.update(appliesBearing=(sign['bearing'] + 180) % 360, directionSource='NDW face orientation')
        if refs and sign.get('layer') is not None and refs[0]['layer'] != sign['layer']:
            sign.update(sourceLayer=sign['layer'], layer=refs[0]['layer'])
        modes = sign_modes(sign)
        if modes:
            sign['affectedModes'] = modes
        signs.append(finalize(sign, refs, reason))
    for bump in sorted(filter(in_bounds, surface_source['bumps']), key=lambda f: f['id']):
        refs, reason = bump_links(bump, graph.index, paths)
        bumps.append(finalize(bump, refs, reason))
    for crossing in sorted(filter(in_bounds, surface_source['crossings']), key=lambda f: f['id']):
        refs, sidewalks, reason = crossing_links(crossing, graph.index, paths)
        crossings.append(finalize({**crossing, 'sidewalks': sidewalks}, refs, reason))
    return dict(version=1, sources={'signs': sign_source.get('meta'), **surface_source.get('sources', {})},
                signs=signs, bumps=bumps, crossings=crossings)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('signs', type=Path)
    parser.add_argument('surfaces', type=Path)
    parser.add_argument('--output', type=Path, default=ROOT / 'assets' / 'ede-street-features.json.gz')
    args = parser.parse_args()
    data = build(json.loads(args.signs.read_text()), json.loads(args.surfaces.read_text()),
                 load_graph(street_features=True))
    encoded = (json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n').encode('utf-8')
    args.output.write_bytes(gzip.compress(encoded, mtime=0) if args.output.suffix == '.gz' else encoded)
    for key in ('signs', 'bumps', 'crossings'):
        print(key, len(data[key]), dict(Counter(f['match'] for f in data[key])))
        print('  Review', dict(Counter(f['matchReason'] for f in data[key] if 'matchReason' in f)))


if __name__ == '__main__':
    main()
