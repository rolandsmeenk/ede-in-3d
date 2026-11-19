#!/usr/bin/env python3
"""Bake Rijkswaterstaat DTB motorway furniture into Slop Ede's local frame."""

import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date
import json
import math
from pathlib import Path
import runpy
from statistics import median
from urllib.parse import urlencode

from shapely import STRtree
from shapely.geometry import LineString, Point, Polygon

from ede_map import load_scene
from ede_motorway_infrastructure import Motorway, ROOT, import_line, project, read_json, snap, write_json

SOURCE = 'https://api.pdok.nl/rws/digitaal-topografisch-bestand/ogc/v1/collections'
SNAPSHOT = ROOT / 'tools/data/ede-dtb-detail.snapshot.json.gz'
COLLECTIONS = ('lijnen', 'punten', 'vlakken')
KINDS = {
    'R030101': 'guardrail', 'R030103': 'guardrail',
    'R2503': 'noiseBarrier',
    'T0105': 'fence', 'T010501': 'fence', 'T030101': 'fence',
    'R61': 'gantry', 'MD11': 'gantry',
    'R5107': 'hectometre',
}


def fetch(directory, bounds):
    fetch_pages = runpy.run_path(str(ROOT / 'tools/build-ede-motorway-lanes.py'))['fetch_pages']
    south, west, north, east = bounds
    query = urlencode({'bbox': f'{west},{south},{east},{north}', 'limit': 1000, 'f': 'json'})
    directory.mkdir(parents=True, exist_ok=True)
    urls = [f'{SOURCE}/{name}/items?{query}' for name in COLLECTIONS]
    with ThreadPoolExecutor(max_workers=3) as pool:
        for collection, features in zip(COLLECTIONS, pool.map(fetch_pages, urls)):
            unique = {record['id']: record for record in features}
            write_json(directory / f'{collection}.geojson', {
                'type': 'FeatureCollection', 'features': [unique[key] for key in sorted(unique)],
            })


def read_snapshot(path, day):
    if path.is_file():
        snapshot = read_json(path)
        if snapshot.get('version') != 1 or tuple(snapshot['collections']) != COLLECTIONS:
            raise ValueError(f'Invalid DTB snapshot {path}')
        return snapshot

    collections = {}
    raw_counts = {}
    keys = ('cte', 'datum', 'dtb_id', 'gradenhoek', 'hecto', 'laag')
    for collection in COLLECTIONS:
        raw = read_json(path / f'{collection}.geojson')
        if raw['type'] != 'FeatureCollection':
            raise ValueError(f'{collection} must contain a GeoJSON FeatureCollection')
        unique = {record['id']: record for record in raw['features']}
        raw_counts[collection] = len(unique)
        collections[collection] = [
            {'id': identity, 'geometry': record['geometry'],
             'properties': {key: record['properties'].get(key) for key in keys}}
            for identity, record in sorted(unique.items())
            if record['properties']['cte'] in KINDS and record.get('geometry')
        ]
    return {'version': 1, 'source': SOURCE, 'date': day, 'rawRecords': raw_counts, 'collections': collections}


def source_line(line, motorway):
    return LineString([motorway.xyz(point) for point in line])


def import_gantry(line, code, motorway):
    if not (4.0 <= line.length <= 58 and motorway.area.covers(line)):
        return None
    a, b = line.coords[0], line.coords[-1]
    length = math.dist(a[:2], b[:2])
    if length < line.length * 0.95 or abs(a[2] - b[2]) > 1:
        return None
    direction = ((b[0] - a[0]) / length, (b[1] - a[1]) / length)
    # Half gantries can start entirely on a shoulder and end just inside a lane.
    stations = [line.interpolate(t, normalized=True).coords[0] for t in (.12, .33, .5, .67, .88)]
    hits = [match for sample in stations if (match := motorway.match(sample, 'gantry', direction))]
    crossing_hits = [match for match in hits if abs(match[4]) <= match[2].data['width'] / 2 + 1.5]
    if not crossing_hits:
        return None
    match = min(crossing_hits, key=lambda item: item[0])
    if any(hit[7] != match[7] and abs(hit[5] - match[5]) > 2.0 for hit in crossing_hits):
        return None
    if code == 'MD11':
        shoulder = [abs(project(match[2], *p[:2])[2]) for p in (a, b)]
        if abs(shoulder[0] - shoulder[1]) < 1:
            return None
        if shoulder[1] > shoulder[0]:
            a, b = b, a
    feature = {**motorway.references(match), 'level': match[7], 'points': [snap(a), snap(b)],
               'beamY': round(median((a[2], b[2])), 2), 'collidable': False}
    if code == 'MD11':
        feature['half'] = True
    if match[6]:
        feature['profileId'] = match[6]
    feature.pop('side', None)
    return feature


def import_marker(record, motorway):
    point = motorway.xyz(record['geometry']['coordinates'])
    if not motorway.corridor.covers(Point(point)):
        return None
    label = record['properties']['hecto']
    match = motorway.match(point, 'hectometre')
    if not match:
        return None
    edge = match[2]
    if abs(match[4]) < max(1.5, edge.data['width'] / 2 - 1.4):
        return None
    feature = {**motorway.references(match, label), 'level': match[7], 'position': snap(point),
               'observedNap': round(point[2], 2), 'label': label,
               'angle': round(math.atan2(-edge.ux, -edge.uz), 4)}
    if match[6]:
        feature['profileId'] = match[6]
    return feature


def inventory(snapshot, motorway, day):
    features = []
    records = Counter()
    seen = Counter()
    stats = Counter()
    review = defaultdict(list)
    geometry = defaultdict(list)
    for collection, source_records in snapshot['collections'].items():
        for record in source_records:
            identity = record['id']
            p = record['properties']
            code = p['cte']
            kind = KINDS.get(code)
            geo = record.get('geometry')
            if not kind or not geo:
                continue
            seen[f'{collection}:{code}'] += 1
            if collection == 'vlakken':
                for poly in geo['coordinates']:
                    footprint = Polygon([motorway.xyz(point)[:2] for point in poly[0]])
                    if motorway.corridor.intersects(footprint):
                        geometry['noiseBarrier'].append(footprint)
                continue
            if collection == 'lijnen':
                lines = [source_line(coords, motorway) for coords in geo['coordinates']]
                if not any(motorway.corridor.intersects(line) for line in lines):
                    continue
                records[f'{collection}:{code}'] += 1
                if kind == 'gantry':
                    added = [result for line in lines if (result := import_gantry(line, code, motorway))]
                else:
                    added = [result for line in lines for result in import_line(line, kind, motorway, stats)]
            else:
                if not motorway.corridor.covers(Point(motorway.xyz(geo['coordinates']))):
                    continue
                records[f'{collection}:{code}'] += 1
                added = [result] if (result := import_marker(record, motorway)) else []
            if not added:
                review[f'{collection}:{code}'].append(identity)
            for index, item in enumerate(added):
                item.update(id=f'{identity}:{index + 1}' if len(added) > 1 else identity, type=kind,
                            date=(p.get('datum') or '')[:10], dtbId=p['dtb_id'],
                            sourceCode=code, sourceLayer=p['laag'])
                features.append(item)
    dtb_walls = [LineString(item['points']).buffer(1.8) for item in features if item['type'] == 'noiseBarrier']
    bgt_walls = [wall for tree in motorway.walls.values() for wall in tree.geometries]
    bgt_index = STRtree(bgt_walls)
    wall_index = STRtree(dtb_walls + bgt_walls)
    footprints = geometry['noiseBarrier']
    stats['noiseFootprints'] = len(footprints)
    stats['noiseFootprintsWithBgtOverlap'] = sum(
        bool(len(bgt_index.query(footprint, predicate='intersects'))) for footprint in footprints)
    stats['noiseFootprintsWithoutMatchedLine'] = sum(
        not len(wall_index.query(footprint, predicate='intersects')) for footprint in footprints)
    features.sort(key=lambda item: (item['type'], item['id']))
    stats['reviewCarriageway'] = sum(item['matchConfidence'] == 'review' for item in features)
    stats['withNwb'] = sum('nwbId' in item for item in features)
    stats['withProfile'] = sum('profileId' in item for item in features)
    return {'version': 1, 'source': SOURCE, 'date': day, 'features': features}, {
        'rawRecords': snapshot['rawRecords'], 'targetedRecords': dict(sorted(seen.items())),
        'corridorRecords': dict(sorted(records.items())),
        'emitted': dict(sorted(Counter(item['type'] for item in features).items())),
        'stats': dict(sorted(stats.items())), 'omittedRecordIds': dict(sorted(review.items())),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshot', type=Path, nargs='?', default=SNAPSHOT,
                        help='Bundled DTB snapshot or directory containing source GeoJSON')
    parser.add_argument('--date', help='Override snapshot retrieval date YYYY-MM-DD')
    parser.add_argument('--fetch', action='store_true', help='Refresh all three collection snapshots')
    parser.add_argument('--save-snapshot', type=Path, help='Save a compact copy of the relevant DTB source records')
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/ede-dtb-detail.json.gz')
    parser.add_argument('--report', type=Path, help='Write counts and source IDs for manual review as JSON')
    args = parser.parse_args()
    day = date.fromisoformat(args.date).isoformat() if args.date else None
    scene = load_scene()
    if args.fetch:
        if args.snapshot.suffix == '.gz' or args.snapshot.is_file():
            parser.error('--fetch requires a directory path for the raw GeoJSON')
        fetch(args.snapshot, scene['meta']['geographicBounds'])
    snapshot = read_snapshot(args.snapshot, day or date.today().isoformat())
    if args.save_snapshot:
        write_json(args.save_snapshot, snapshot)
    asset, report = inventory(snapshot, Motorway(scene), day or snapshot['date'])
    write_json(args.output, asset)
    if args.report:
        write_json(args.report, report)
    print(json.dumps({k: v for k, v in report.items() if k != 'omittedRecordIds'}, indent=2))


if __name__ == '__main__':
    main()
