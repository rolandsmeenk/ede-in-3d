#!/usr/bin/env python3
"""Bake paved BGT terrain where it replaces a centerline-based access road or path."""

import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date
import json
import math
from pathlib import Path
from runpy import run_path

from shapely import STRtree, difference, make_valid, prepare, set_precision, transform, union_all
from shapely.geometry import LineString, MultiLineString, shape

from ede_gis import Frame, source_crs
from ede_map import ROOT, load_coverage_polygon, load_playable_scene


ROAD_BAKE = run_path(str(ROOT / 'tools/build-ede-bgt-roads.py'))
CORRIDOR_BAKE = run_path(str(ROOT / 'tools/build-ede-corridor-paving.py'))
BGT = ROAD_BAKE['BGT']
COLLECTION = 'onbegroeidterreindeel'
ROAD_ASSETS = ('ede-road-surfaces', 'ede-corridor-paving', 'ede-north-paving', 'ede-fringe-paving')
TRAFFIC_KINDS = {'service', 'living_street', 'track', 'cycleway'}
ACCESS_KINDS = TRAFFIC_KINDS | {'footway', 'path', 'pedestrian', 'bridleway'}
HARD_PAVING = {'asphalt', 'brick', 'block', 'tile', 'concrete'}


def tile_path(cache, index):
    return cache / f'{index:03}.geojson'


def fetch_snapshot(cache, tiles, day):
    cache.mkdir(parents=True, exist_ok=True)

    def fetch_tile(item):
        index, bounds = item
        path = tile_path(cache, index)
        if path.is_file():
            return
        _, features = BGT['fetch_tile'](COLLECTION, bounds, day, timeout=24)
        selected = [feature for feature in features if active_paving(feature)]
        temporary = path.with_suffix('.tmp')
        temporary.write_text(json.dumps({'type': 'FeatureCollection', 'features': selected}, separators=(',', ':')))
        temporary.replace(path)

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(fetch_tile, enumerate(tiles)))


def active_paving(feature):
    p = feature['properties']
    return (feature.get('geometry') and p.get('status') == 'bestaand'
            and p.get('relatieve_hoogteligging') == 0
            and p.get('fysiek_voorkomen') in {'open verharding', 'gesloten verharding'}
            and p.get('in_onderzoek') not in (True, 'true'))


def survey_features(cache, count):
    latest = {}
    for index in range(count):
        document = json.loads(tile_path(cache, index).read_text())
        crs = source_crs(document)
        for feature in document['features']:
            if not active_paving(feature):
                continue
            props = feature['properties']
            material = ROAD_BAKE['DETAILED_MATERIALS'].get(props.get('plus_fysiek_voorkomen'))
            if material not in HARD_PAVING or props.get('plus_fysiek_voorkomen') == 'grasklinkers':
                continue
            identity = props['lokaal_id']
            registered = props.get('tijdstip_registratie') or ''
            if identity not in latest or registered > latest[identity][0]:
                latest[identity] = (registered, feature, source_crs(feature, default=crs), material)
    if not latest:
        raise ValueError(f'No dated BGT terrain features found in {cache}')
    return latest


def existing_paving():
    covered = defaultdict(set)
    ground = []
    for name in ROAD_ASSETS:
        data = CORRIDOR_BAKE['read_paving'](ROOT / 'assets' / (name + '.json.gz'))
        for identity, indices in data['covered'].items():
            covered[identity].update(indices)
        ground.extend(CORRIDOR_BAKE['paving_geometry'](row, BGT['pairs'])
                      for row in data['surfaces'] if not row['layer'])
    return covered, STRtree(ground)


def fallback_ways(scene, covered):
    ways, lines = [], []
    for road in scene['roads']:
        if (road['kind'] not in ACCESS_KINDS or road.get('layer') or road.get('bridge') or road.get('tunnel')):
            continue
        points = BGT['pairs'](road['pts'])
        segments = [(i, LineString((a, b))) for i, (a, b) in enumerate(zip(points, points[1:]))
                    if i not in covered.get(road['id'], ()) and math.dist(a, b) >= 0.8]
        if not segments:
            continue
        ways.append((road, segments))
        lines.append(MultiLineString([segment for _, segment in segments]))
    return ways, STRtree(lines)


def overlapping(tree, geometry):
    return tree.geometries[tree.query(geometry, predicate='intersects')]


def select_surfaces(features, frame, area, ways, centerlines, paved):
    prepare(area)
    geometries, rows = [], []
    addressed = set()
    for identity, (_, feature, crs, material) in sorted(features.items()):
        geometry = transform(shape(feature['geometry']),
                             lambda x, y: frame.to_scene(x, y, crs, axis_order='xy'),
                             interleaved=False)
        geometry = make_valid(geometry)
        if not area.covers(geometry):
            geometry = geometry.intersection(area)
        if geometry.is_empty or not centerlines.query(geometry, predicate='intersects').size:
            continue
        geometry = set_precision(geometry.simplify(0.08, preserve_topology=True), 0.001)
        geometry = difference(geometry, union_all(overlapping(paved, geometry), grid_size=0.001), grid_size=0.001)
        if geometry.area <= 0:
            continue

        # Require a meaningful run along a route. A crossing through the edge of a plaza is insufficient.
        interior = geometry.buffer(-0.08)
        minimum = max(3, min(8, math.sqrt(geometry.area) * 0.35), geometry.area / 28)
        matches = [i for i in centerlines.query(interior, predicate='intersects')
                   if centerlines.geometries[i].intersection(interior).length >= minimum]
        if not matches:
            continue
        traffic = any(ways[i][0]['kind'] in TRAFFIC_KINDS for i in matches)
        addressed.update(matches)

        corners = list(geometry.minimum_rotated_rectangle.exterior.coords)
        dx, dz = max(((b[0] - a[0], b[1] - a[1]) for a, b in zip(corners, corners[1:])),
                     key=lambda edge: math.hypot(*edge))
        props = feature['properties']
        rows.append({
            'id': identity, 'layer': 0, 'function': COLLECTION, 'traffic': traffic,
            'fysiek_voorkomen': props['fysiek_voorkomen'],
            'plus_fysiek_voorkomen': props['plus_fysiek_voorkomen'],
            'material': material, 'resolution': 'bgt-detail', 'angle': round(math.atan2(dz, dx) % math.pi, 3),
        })
        geometries.append(geometry)
    selected = STRtree(geometries)
    final_geometries, final_rows = [], []
    for i, (geometry, row) in enumerate(zip(geometries, rows)):
        others = [geometries[j] for j in selected.query(geometry, predicate='intersects') if j < i]
        if others:
            geometry = difference(geometry, union_all(others, grid_size=0.001), grid_size=0.001)
        rings = ROAD_BAKE['encode_surface'](geometry)
        if rings:
            final_geometries.append(geometry)
            final_rows.append({**row, 'polygons': rings})
    return final_geometries, final_rows, addressed


def coverage(ways, centerlines, paved, terrain, addressed):
    covered = {}
    for i in sorted(addressed):
        road, segments = ways[i]
        line = centerlines.geometries[i]
        new = union_all(overlapping(terrain, line))
        surveyed = union_all([new, *overlapping(paved, line)]).buffer(0.12)
        indices = [index for index, segment in segments
                   if new.intersection(segment).length >= min(1.0, segment.length / 2)
                   and surveyed.intersection(segment).length >= segment.length * 0.94]
        if indices:
            covered[road['id']] = indices
    return covered


def build(scene, cache, frame, area, day, tiles):
    features = survey_features(cache, len(tiles))
    prior_coverage, paved = existing_paving()
    ways, centerlines = fallback_ways(scene, prior_coverage)
    geometries, rows, addressed = select_surfaces(features, frame, area, ways, centerlines, paved)
    covered = coverage(ways, centerlines, paved, STRtree(geometries), addressed)
    return {
        'version': 1, 'date': str(day),
        'source': {'url': f"{BGT['API']}/collections/{COLLECTION}", 'license': 'CC0 1.0',
                   'collection': COLLECTION, 'pavedFeatures': len(features)},
        'counts': dict(sorted(Counter(row['material'] for row in rows).items())),
        'covered': covered, 'surfaces': rows,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshot', type=Path)
    parser.add_argument('--date', type=date.fromisoformat, required=True)
    parser.add_argument('--fetch', action='store_true')
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/ede-terrain-paving.json.gz')
    args = parser.parse_args()
    scene = load_playable_scene(include_shorelines=False)
    frame = Frame(scene['meta']['lonLatAffine'])
    area = load_coverage_polygon('buildingBoundary')
    tiles = list(CORRIDOR_BAKE['municipality_tiles'](area, frame))
    if args.fetch:
        fetch_snapshot(args.snapshot, tiles, args.date)
    asset = build(scene, args.snapshot, frame, area, args.date, tiles)
    CORRIDOR_BAKE['write_paving'](args.output, asset)
    print(f"{len(asset['surfaces'])} BGT terrain surfaces, {len(asset['covered'])} covered ways, "
          f"{sum(map(len, asset['covered'].values()))} covered segments.")


if __name__ == '__main__':
    main()
