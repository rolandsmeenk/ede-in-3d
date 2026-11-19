#!/usr/bin/env python3
"""Reconcile BGT and OSM water and cut shared shoreline holes into the Ede map."""

import argparse
from collections import Counter
from datetime import date
import gzip
import json
from pathlib import Path
import runpy

from shapely import STRtree, get_coordinates, make_valid, set_precision, snap, union_all
from shapely.geometry import MultiPoint, Polygon, box

from ede_map import SHORELINE_ASSET, shoreline_base, load_scene

ROOT = Path(__file__).resolve().parents[1]
BGT = runpy.run_path(str(Path(__file__).with_name('build-ede-bgt.py')))
MIN_AREA = 0.02
SIMPLIFY = 0.30
REPLACE_COVERAGE = 0.80


def polygon_parts(shape):
    yield from BGT['polygons'](shape)


def unpack(item):
    rings = [item['ring'], *item.get('holes', ())]
    points = [list(zip(ring[::2], ring[1::2])) for ring in rings if len(ring) >= 6]
    return make_valid(Polygon(points[0], points[1:])) if points else Polygon()


def pack(geometry):
    def flat(ring):
        return [round(value, 6) for point in list(ring.coords)[:-1] for value in point]
    return {'ring': flat(geometry.exterior), 'holes': [flat(hole) for hole in geometry.interiors]}


def sorted_parts(shape):
    return sorted(polygon_parts(shape), key=lambda polygon: (-polygon.area, polygon.bounds))


def ground(feature):
    return not feature.get('layer') and not feature.get('bridge') and not feature.get('tunnel')


def active(feature, day):
    prop = feature['properties']
    return (feature.get('geometry') and ground({'layer': prop.get('relatieve_hoogteligging')})
            and prop.get('status') == 'bestaand' and prop.get('plus_status') not in {'plan', 'historie'}
            and (prop.get('creation_date') or '')[:10] <= day
            and all(day < prop[key][:10] for key in ('eind_registratie', 'termination_date') if prop.get(key)))


def surveyed(directory, collection, scene, day):
    files = sorted(directory.glob(f'*-{collection}.geojson'))
    if not files:
        raise ValueError(f'No {collection} tiles in {directory}')
    latest = {}
    for filename in files:
        for feature in json.loads(filename.read_bytes())['features']:
            prop = feature['properties']
            key = prop['lokaal_id']
            if key not in latest or prop['tijdstip_registratie'] > latest[key]['properties']['tijdstip_registratie']:
                latest[key] = feature
    clip = box(*scene['meta']['bounds'])
    for key, feature in sorted(latest.items()):
        if not active(feature, day):
            continue
        prop = feature['properties']
        if collection == 'waterdeel' and 'droge sloot' in (prop.get('plus_type') or prop.get('type') or ''):
            continue
        geometry = BGT['world_geometry'](feature, scene['meta']['lonLatAffine'], clip)
        geometry = set_precision(set_precision(geometry.simplify(SIMPLIFY, preserve_topology=True), 0.01), 0)
        if geometry.area >= MIN_AREA:
            yield key, prop.get('type') or 'water', geometry


def overlap_audit(water, land):
    tree = STRtree(land)
    results = []
    for item, wet in water:
        mask = union_all(tree.geometries[tree.query(wet, predicate='intersects')])
        loss = wet.intersection(mask).area
        if loss > 0.01:
            centre = wet.centroid
            results.append({'id': item['id'], 'name': item['name'], 'areaM2': round(wet.area, 2),
                            'coveredM2': round(loss, 2), 'full': wet.area - loss <= 0.01,
                            'center': [round(centre.x, 2), round(centre.y, 2)]})
    return {'waterPolygons': len(water), 'fullyCovered': sum(row['full'] for row in results),
            'partlyCovered': sum(not row['full'] for row in results), 'overlaps': results}


def resolve_water(osm, native, banks):
    bgt = STRtree([shape for _, _, shape in native])
    shores = STRtree([shape for _, _, shape in banks])
    retained = []
    islands = []
    decisions = Counter()
    selected = set()
    for _, outline in osm:
        compatible = [index for index in bgt.query(outline, predicate='intersects')
                      if (piece := bgt.geometries[index]).intersection(outline).area
                      >= min(piece.area, outline.area) * 0.35]
        selected.update(compatible)
        local = union_all(bgt.geometries[compatible])
        coverage = local.intersection(outline).area / outline.area if outline.area else 0
        if coverage >= REPLACE_COVERAGE:
            decisions['bgt-refined'] += 1
        else:
            decisions['osm-gap' if compatible else 'osm-only'] += 1
            if compatible:
                # Surveyed banks can identify land where a partially mapped OSM outline is broad.
                bank_mask = union_all(shores.geometries[shores.query(outline, predicate='intersects')])
                outline = outline.difference(bank_mask)
            retained.extend(polygon_parts(outline))
        for piece in polygon_parts(outline):
            islands.extend(Polygon(hole) for hole in piece.interiors)
    # An unmatched survey watercourse can be below an OSM road or be seasonal.
    # Refine compatible mapped water rather than invent a new navigation obstacle.
    native_wet = union_all(bgt.geometries[sorted(selected)]).difference(union_all(islands))
    return union_all([native_wet, *retained]), decisions, len(selected)


def contacts_with_land(water, land_shapes):
    shoreline = water.boundary
    tree = STRtree(land_shapes)
    features = tree.geometries[tree.query(shoreline, predicate='intersects')]
    intersections = [shape.boundary.intersection(shoreline) for shape in features]
    coordinates = {tuple(point) for piece in intersections for point in get_coordinates(piece)}
    if not coordinates:
        return water
    noded = snap(water, MultiPoint(sorted(coordinates)), 1e-7)
    if not noded.is_valid or noded.symmetric_difference(water).area > 0.001:
        raise ValueError('Land and water shoreline noding changed the covered area')
    return noded


def water_rows(water, osm, native):
    old = STRtree([shape for _, shape in osm])
    bgt = STRtree([shape for _, _, shape in native])
    duplicates = Counter()
    result = []
    for geometry in sorted_parts(water):
        def matches(tree):
            for index in tree.query(geometry, predicate='intersects'):
                overlap = tree.geometries[index].intersection(geometry).area
                if overlap >= MIN_AREA:
                    yield int(index), overlap

        prior = list(matches(old))
        near = list(matches(bgt))
        if prior:
            index, _ = max(prior, key=lambda pair: (pair[1], -pair[0]))
            row = {key: osm[index][0][key] for key in ('id', 'name', 'kind')}
        else:
            if not near:
                raise ValueError('Water outline does not match a source')
            identity, kind, _ = native[max(near, key=lambda pair: (pair[1], -pair[0]))[0]]
            row = {'id': f'bgt:{identity}', 'name': '', 'kind': kind}
        identity = row['id']
        duplicates[identity] += 1
        if duplicates[identity] > 1:
            row['id'] = f'{identity}:{duplicates[identity]}'
        result.append({**row, **pack(geometry)})
    return result


def build(scene, directory, day):
    osm = [(item, unpack(item)) for item in scene['water'] if ground(item)]
    shapes = [(group, index, item, unpack(item)) for group in ('parks', 'squares')
              for index, item in enumerate(scene[group]) if ground(item)]
    before = overlap_audit(osm, [shape for _, _, _, shape in shapes])
    native = list(surveyed(directory, 'waterdeel', scene, day))
    banks = list(surveyed(directory, 'ondersteunendwaterdeel', scene, day))
    if not native:
        raise ValueError('Empty surveyed water collection')
    wet, decisions, selected = resolve_water(osm, native, banks)
    wet = contacts_with_land(wet, [shape for _, _, _, shape in shapes])
    tree = STRtree(list(polygon_parts(wet)))
    changes = {'parks': [], 'squares': []}
    land_after = []
    for group, index, item, shape in shapes:
        near = union_all(tree.geometries[tree.query(shape, predicate='intersects')])
        if not shape.intersection(near).area:
            land_after.append(shape)
            continue
        result = sorted_parts(shape.difference(near))
        fragments = [pack(part) for part in result]
        changes[group].append([index, item['id'], fragments])
        land_after.extend(unpack(part) for part in fragments)
    rows = water_rows(wet, osm, native)
    after = overlap_audit([(item, unpack(item)) for item in rows], land_after)
    if after['overlaps']:
        raise ValueError(f"Land still covers {len(after['overlaps'])} water polygons")
    for item in scene['water']:
        if not ground(item):
            rows.append(item)
    return ({
        'version': 1, 'date': day, 'base': shoreline_base(scene), 'water': rows, 'land': changes,
        'source': 'https://api.pdok.nl/lv/bgt/ogc/v1/collections?f=html',
    }, {'before': before, 'after': after, 'surveyedWater': len(native), 'surveyedBanks': len(banks),
        'compatibleSurveyedWater': selected, 'osmDecisions': dict(decisions), 'landChanges': {key: len(rows) for key, rows in changes.items()}})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path, nargs='?')
    parser.add_argument('--date', type=date.fromisoformat)
    parser.add_argument('--output', type=Path, default=ROOT / SHORELINE_ASSET)
    parser.add_argument('--report', type=Path)
    parser.add_argument('--audit', action='store_true', help='audit the loaded map without writing assets')
    parser.add_argument('--osm', action='store_true', help='audit the original unrefined map')
    args = parser.parse_args()
    if args.audit:
        scene = load_scene(include_shorelines=not args.osm)
        report = overlap_audit([(item, unpack(item)) for item in scene['water'] if ground(item)],
                               [unpack(item) for item in scene['parks'] + scene['squares'] if ground(item)])
    else:
        if args.directory is None or args.date is None:
            parser.error('the PDOK source directory and --date are required to bake shorelines')
        scene = load_scene(include_shorelines=False)
        asset, report = build(scene, args.directory, args.date.isoformat())
        payload = (json.dumps(asset, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
        args.output.write_bytes(gzip.compress(payload, mtime=0))
        report['assetBytes'] = args.output.stat().st_size
    if args.report:
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({key: ({k: val for k, val in val.items() if k != 'overlaps'} if isinstance(val, dict) else val)
                      for key, val in report.items() if key != 'overlaps'}, ensure_ascii=False))


if __name__ == '__main__':
    main()
