#!/usr/bin/env python3
"""Match dated PDOK BGT road surfaces to OSM centerlines for physical evidence.

Requires Shapely 2.1+. Use --fetch to populate the snapshot directory.
The BGT classes and transverse widths describe mapped surfaces only.
"""

import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date
import hashlib
import json
import math
from pathlib import Path
import runpy
from statistics import median, quantiles

from shapely import STRtree
from shapely.geometry import LineString, box


ROOT = Path(__file__).resolve().parents[1]
BGT = runpy.run_path(str(ROOT / 'tools/build-ede-bgt.py'))
COLLECTIONS = ('wegdeel', 'ondersteunendwegdeel')
KEPT_PROPERTIES = {'lokaal_id', 'status', 'relatieve_hoogteligging', 'tijdstip_registratie',
                   'functie', 'plus_functie', 'fysiek_voorkomen', 'plus_fysiek_voorkomen',
                   'type', 'plus_type', 'in_onderzoek'}
FUNCTIONS = {'fietspad': 'cycle', 'voetpad': 'foot', 'voetpad op trap': 'foot',
             'voetgangersgebied': 'foot', 'ov-baan': 'bus', 'woonerf': 'shared', 'inrit': 'motor'}
OSM_PHYSICAL = {
    'path': {'foot', 'cycle', 'shared'}, 'footway': {'foot'}, 'steps': {'foot'},
    'pedestrian': {'foot', 'shared'}, 'cycleway': {'cycle', 'shared'}, 'bridleway': {'foot', 'cycle', 'shared'},
    'track': {'motor', 'shared'}, 'busway': {'bus', 'motor'}, 'service': {'motor', 'shared', 'bus'},
}
WIDTH_RANGE = {'foot': (0.65, 6), 'cycle': (1.1, 6.5), 'motor': (2.4, 23),
               'bus': (2.8, 12), 'shared': (1.5, 12)}
MIN_COVERAGE = 0.75


def fetch(directory, scene, day):
    directory.mkdir(parents=True, exist_ok=True)
    south, west, north, east = scene['meta']['geographicBounds']
    xs = [west + (east - west) * i / 6 for i in range(7)]
    ys = [south + (north - south) * i / 6 for i in range(7)]
    work = [(name, (x0, y0, x1, y1), day) for name in COLLECTIONS
            for y0, y1 in zip(ys, ys[1:]) for x0, x1 in zip(xs, xs[1:])]
    features = {name: {} for name in COLLECTIONS}
    with ThreadPoolExecutor(max_workers=8) as pool:
        for name, batch in pool.map(lambda args: BGT['fetch_tile'](*args), work):
            for feature in batch:
                props = feature['properties']
                if props.get('status') != 'bestaand':
                    continue
                key = (props['lokaal_id'], props.get('tijdstip_registratie') or '')
                feature['properties'] = {p: props[p] for p in KEPT_PROPERTIES if p in props}
                features[name][key] = feature
    for name, data in features.items():
        path = directory / f'{name}.geojson'
        path.write_text(json.dumps({'type': 'FeatureCollection', 'features': [data[key] for key in sorted(data)]},
                                   ensure_ascii=False, separators=(',', ':')) + '\n')


def get_snapshot(directory, scene, area):
    sources, geometries, surfaces = {}, [], []
    for name in COLLECTIONS:
        path = directory / f'{name}.geojson'
        document = json.loads(path.read_bytes())
        if document.get('type') != 'FeatureCollection':
            raise ValueError(f'Expected a GeoJSON collection in {path}')
        latest = {}
        for feature in document['features']:
            props = feature['properties']
            if props.get('status') != 'bestaand' or not feature.get('geometry'):
                continue
            key = props['lokaal_id']
            registered = props.get('tijdstip_registratie') or ''
            if key not in latest or registered > (latest[key]['properties'].get('tijdstip_registratie') or ''):
                feature['properties'] = {p: props[p] for p in KEPT_PROPERTIES if p in props}
                latest[key] = feature
        listing = [latest[key] for key in sorted(latest)]
        raw = json.dumps(listing, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()
        sources[name] = {'count': len(listing), 'sha256': hashlib.sha256(raw).hexdigest()}
        if not listing:
            raise ValueError(f'Empty BGT collection {name}')
        for feature in listing:
            props = feature['properties']
            geometry = BGT['world_geometry'](feature, scene['meta']['lonLatAffine'], area)
            tag = ((props.get('plus_functie') or props.get('functie')) or '').lower()
            kind = FUNCTIONS.get(tag)
            if tag in {'verbindingsweg', 'verkeersdrempel'} or tag.startswith('rijbaan '):
                kind = 'motor'
            if name == 'ondersteunendwegdeel' or props.get('in_onderzoek') in (True, 'true'):
                kind = None
            for polygon in BGT['polygons'](geometry):
                geometries.append(polygon)
                surfaces.append((props.get('relatieve_hoogteligging'), kind, tag, props['lokaal_id']))
    return STRtree(geometries), surfaces, sources


def line_parts(geometry):
    if geometry.geom_type == 'LineString':
        if geometry.length > 0:
            yield geometry
    elif hasattr(geometry, 'geoms'):
        for part in geometry.geoms:
            yield from line_parts(part)


def samples(road):
    for line in line_parts(road):
        count = max(3, math.ceil(line.length / 7))
        for i in range(count):
            distance = (i + 0.5) * line.length / count
            point = line.interpolate(distance)
            # Junctions and tight bends frequently measure a different surface than the corridor.
            before, after = line.interpolate(max(0, distance - 1.4)), line.interpolate(distance + 1.4)
            yield point, before, after, min(distance, line.length - distance)


def cross_width(point, before, after, polygons, kind):
    dx, dz = after.x - before.x, after.y - before.y
    length = math.hypot(dx, dz)
    if length < 0.8:
        return None
    nx, nz = -dz / length, dx / length
    ray = LineString([(point.x - nx * 15, point.y - nz * 15),
                      (point.x + nx * 15, point.y + nz * 15)])
    lo, hi = WIDTH_RANGE[kind]
    widths = []
    for polygon in polygons:
        for section in line_parts(polygon.intersection(ray)):
            if section.distance(point) > 0.02 or not lo <= section.length <= hi:
                continue
            offsets = [(x - point.x) * nx + (z - point.y) * nz for x, z in section.coords]
            if min(-min(offsets), max(offsets)) >= section.length * 0.15:
                widths.append(section.length)
    if widths and max(widths) - min(widths) < 0.25:
        return median(widths)
    return None


def match_way(line, level, expected, tree, surfaces):
    counts, off_layer, supporting, sources = Counter(), Counter(), Counter(), set()
    sections = defaultdict(list)
    total = 0
    for point, before, after, end_reach in samples(line):
        total += 1
        hits = tree.query(point, predicate='intersects')
        matching = defaultdict(list)
        off_kinds, other_tags = set(), set()
        for index in hits:
            layer, kind, tag, identity = surfaces[index]
            if layer == level and kind:
                matching[kind].append(index)
                sources.add(identity)
            elif kind:
                off_kinds.add(f'{kind}:{layer}')
            elif tag:
                other_tags.add(tag)
        if len(matching) == 1:
            kind = next(iter(matching))
            counts[kind] += 1
            if end_reach >= 2.5:
                value = cross_width(point, before, after, (tree.geometries[i] for i in matching[kind]), kind)
                if value is not None:
                    sections[kind].append(value)
        elif matching:
            counts['ambiguous'] += 1
        off_layer.update(off_kinds)
        supporting.update(other_tags)
    if not total:
        return None, 'outsideBounds', {}

    winner, count = max(((kind, count) for kind, count in counts.items() if kind != 'ambiguous'),
                        key=lambda item: (item[1], item[0]), default=('', 0))
    coverage = count / total
    diagnostic = {'samples': total, 'sameLayer': dict(sorted(counts.items())),
                  'differentLayer': dict(sorted(off_layer.items())), 'otherSurfaces': dict(sorted(supporting.items())),
                  'candidateIds': sorted(sources)}
    if coverage <= MIN_COVERAGE:
        reason = ('differentLayer' if max(off_layer.values(), default=0) / total > 0.5 else
                  'mixedPhysicalClass' if len(counts) > 1 or counts['ambiguous'] else
                  'insufficientSurfaceCoverage')
        return None, reason, diagnostic
    if winner not in expected:
        return None, 'osmPhysicalClassConflict', diagnostic
    result = {'kind': winner, 'coverage': round(coverage, 3)}
    widths = sections[winner]
    if len(widths) >= max(3, math.ceil(count * 0.6)):
        middle = median(widths)
        q1, _, q3 = quantiles(widths, n=4, method='inclusive')
        close = sum(abs(width - middle) <= max(0.4, middle * 0.25) for width in widths)
        if q3 - q1 <= max(0.4, middle * 0.2) and close >= len(widths) * 0.8:
            result['width'] = round(middle, 1)
    return result, None if 'width' in result else 'uncertainWidth', diagnostic


def build(scene, directory, day):
    area = box(*scene['meta']['bounds'])
    index, surfaces, sources = get_snapshot(directory, scene, area)
    ways, issues = {}, {}
    counts, kinds = Counter(), Counter()
    for road in sorted(scene['roads'], key=lambda road: road['id']):
        if len(road['pts']) < 4:
            continue
        level = road.get('layer', 1 if road.get('bridge') else -1 if road.get('tunnel') else 0)
        line = LineString(BGT['pairs'](road['pts'])).intersection(area)
        expected = OSM_PHYSICAL.get(road['kind'], {'motor', 'shared'})
        result, issue, diagnostic = match_way(line, level, expected, index, surfaces)
        if result:
            ways[road['id']] = result
            kinds[result['kind']] += 1
            counts['accepted'] += 1
            if 'width' in result:
                counts['confidentWidth'] += 1
        if issue:
            counts[issue] += 1
            issues[road['id']] = {'issue': issue, 'osmKind': road['kind'], 'level': level, **diagnostic}
    if len(ways) < len(scene['roads']) / 4:
        raise ValueError('BGT evidence matches fewer than a quarter of Ede OSM ways')
    assert all(MIN_COVERAGE <= result['coverage'] <= 1 for result in ways.values())
    source = f"{BGT['API']}/collections?f=html"
    asset = {'version': 1, 'date': str(day), 'source': {'url': source, 'license': 'CC0 1.0', 'collections': sources},
             'ways': ways}
    report = {'date': str(day), 'source': source,
              'collections': sources, 'counts': dict(counts), 'matchedClasses': dict(kinds), 'issues': issues}
    return asset, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--date', type=date.fromisoformat, required=True)
    parser.add_argument('--fetch', action='store_true')
    parser.add_argument('--output', type=Path, default=ROOT / 'tools/data/ede-bgt-road-evidence.json')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    scene = BGT['load_scene']()
    if args.fetch:
        fetch(args.directory, scene, args.date)
    asset, report = build(scene, args.directory, args.date)
    metadata = {key: value for key, value in asset.items() if key != 'ways'}
    prefix = json.dumps(metadata, indent=2).removesuffix('\n}')
    rows = ',\n'.join(f'    {json.dumps(key)}:{json.dumps(row, separators=(",", ":"))}'
                       for key, row in asset['ways'].items())
    args.output.write_text(prefix + ',\n  "ways": {\n' + rows + '\n  }\n}\n')
    if args.report:
        args.report.write_text(json.dumps(report, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(json.dumps({key: report[key] for key in ('collections', 'counts', 'matchedClasses')}, indent=2))


if __name__ == '__main__':
    main()
