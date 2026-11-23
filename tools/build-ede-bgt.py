#!/usr/bin/env python3
"""Build the local Ede structure asset from a dated PDOK BGT snapshot.

Requires Shapely 2.1+. Use --fetch to populate the snapshot directory.
"""

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date
import hashlib
import json
import math
from pathlib import Path
import subprocess
from urllib.parse import urlencode
import warnings

from shapely import STRtree, make_valid, orient_polygons, set_precision, union_all
from shapely.affinity import affine_transform
from shapely.geometry import LineString, Polygon, shape

from ede_map import load_coverage_polygon, load_playable_boundary, load_playable_scene, read_packed
from ede_scene import SceneAffine

ROOT = Path(__file__).resolve().parents[1]
API = 'https://api.pdok.nl/kadaster/bgt/ogc/v1'
COLLECTIONS = (
    'overbruggingsdeel', 'kunstwerkdeel_lijn', 'kunstwerkdeel_punt', 'kunstwerkdeel_vlak',
    'scheiding_lijn', 'scheiding_vlak', 'overigbouwwerk', 'pand',
)
WALL_WIDTHS = {'geluidsscherm': 0.32, 'keermuur': 0.45, 'damwand': 0.34, 'kademuur': 0.45, 'muur': 0.36}
CIVIL_OWNERS = {'L0002', 'L0004', 'P0025'}  # Rijkswaterstaat, ProRail, Gelderland
SMALL_TURBINE_HUBS = {
    'G0228.21950daf66f24cff8e1cecb19522613c': 6,
    # AHN 0.5 m DSM samples at RD (173837.04, 460396.17) reach 16 m above ground, including the rotor.
    'G0228.3ee8eb0533604ce9b05475f200118735': 11,
}


@dataclass
class Record:
    kind: str
    layer: int
    ids: tuple
    geometry: object
    estimated_type: bool = False


def fetch_tile(collection, bounds, day, timeout=40, retries=2):
    query = urlencode({
        'bbox': ','.join(f'{value:.8f}' for value in bounds),
        'datetime': f'{day}T00:00:00Z', 'limit': 1000, 'f': 'json',
    })
    url = f'{API}/collections/{collection}/items?{query}'
    features, pages = [], set()
    while url:
        if url in pages:
            raise ValueError(f'Repeated PDOK page for {collection}')
        pages.add(url)
        raw = subprocess.check_output(['curl', '-fsSL', '--max-time', str(timeout), '--retry', str(retries), url])
        page = json.loads(raw)
        for feature in page['features']:
            props = feature['properties']
            if collection == 'pand':
                if not props.get('bag_pnd') or props.get('status') != 'bestaand':
                    continue
                feature['properties'] = {key: props[key] for key in
                                         ('bag_pnd', 'lokaal_id', 'status', 'relatieve_hoogteligging')}
            features.append(feature)
        url = next((link['href'] for link in page['links'] if link['rel'] == 'next'), None)
    return collection, features


def snapshot(directory, scene, day, area=None):
    directory.mkdir(parents=True, exist_ok=True)
    cache = directory / str(day)
    cache.mkdir(exist_ok=True)
    project = SceneAffine(scene['meta']['lonLatAffine'])
    if area is None:
        south, west, north, east = scene['meta']['geographicBounds']
        area = load_playable_boundary()
    else:
        west, south, east, north = project.geographic_bounds(area.bounds)

    def intersects(bounds):
        x0, y0, x1, y1 = bounds
        return area.intersects(Polygon([project.lon_lat_to_scene(x, y) for x, y in
                                        [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]]))

    def subdivisions(bounds, divisions):
        x0, y0, x1, y1 = bounds
        xs = [x0 + (x1 - x0) * i / divisions for i in range(divisions + 1)]
        ys = [y0 + (y1 - y0) * i / divisions for i in range(divisions + 1)]
        for bottom, top in zip(ys, ys[1:]):
            for left, right in zip(xs, xs[1:]):
                cell = left, bottom, right, top
                if intersects(cell):
                    yield cell

    def request(job):
        name, bounds = job
        key = '-'.join(f'{v:.8f}' for v in bounds)
        file = cache / f'{name}-{key}.json'
        if file.exists():
            return name, json.loads(file.read_bytes())
        try:
            _, features = fetch_tile(name, bounds, day, timeout=18, retries=1)
        except subprocess.CalledProcessError:
            if bounds[2] - bounds[0] < .009:
                raise
            features = [row for cell in subdivisions(bounds, 2) for row in request((name, cell))[1]]
        file.write_text(json.dumps(features, ensure_ascii=False, separators=(',', ':')))
        return name, features

    data = {name: {} for name in COLLECTIONS}
    dense = {'scheiding_lijn', 'scheiding_vlak', 'overigbouwwerk', 'pand'}
    work = [(name, bounds) for name in COLLECTIONS
            for bounds in subdivisions((west, south, east, north), 6 if name in dense else 3)]
    with ThreadPoolExecutor(max_workers=8) as pool:
        for name, features in pool.map(request, work):
            for feature in features:
                props = feature['properties']
                key = props['lokaal_id'], props.get('tijdstip_registratie')
                data[name][key] = feature
    for name, features in data.items():
        path = directory / f'{name}.geojson'
        path.write_text(json.dumps({'type': 'FeatureCollection', 'features': list(features.values())},
                                   ensure_ascii=False, separators=(',', ':')) + '\n')


def read_snapshot(directory):
    for name in COLLECTIONS:
        path = directory / f'{name}.geojson'
        document = json.loads(path.read_bytes())
        if document.get('type') != 'FeatureCollection':
            raise ValueError(f'Expected a GeoJSON collection in {path}')
        latest = {}
        for feature in document['features']:
            p = feature['properties']
            if p.get('status') != 'bestaand' or not feature.get('geometry'):
                continue
            identity = p['lokaal_id']
            timestamp = p.get('tijdstip_registratie', '')
            if identity not in latest or timestamp > latest[identity]['properties'].get('tijdstip_registratie', ''):
                latest[identity] = feature
        raw = json.dumps(list(dict(sorted(latest.items())).values()), sort_keys=True, separators=(',', ':')).encode()
        yield name, latest, hashlib.sha256(raw).hexdigest()


def world_geometry(feature, affine, area):
    geom = shape(feature['geometry'])
    min_lon, min_lat, max_lon, max_lat = geom.bounds
    if not (-180 <= min_lon <= max_lon <= 180 and -90 <= min_lat <= max_lat <= 90):
        raise ValueError('Expected PDOK GeoJSON longitude/latitude coordinates')
    transform = SceneAffine(affine).shapely_coefficients()
    return make_valid(affine_transform(geom, transform)).intersection(area)


def pairs(flat):
    return list(zip(flat[::2], flat[1::2]))


def polygons(geom):
    if geom.geom_type == 'Polygon':
        if geom.area >= 0.02:
            yield geom
    elif hasattr(geom, 'geoms'):
        for part in geom.geoms:
            yield from polygons(part)


def nearby_union(tree, geom, distance=0):
    indices = tree.query(geom, predicate='dwithin' if distance else 'intersects', distance=distance or None)
    return union_all([tree.geometries[index] for index in sorted(indices)])


def classify(name, prop, geometry):
    tag = prop.get('plus_type') or prop.get('type')
    level = prop.get('relatieve_hoogteligging') or 0
    if name == 'overbruggingsdeel':
        component = prop.get('type_overbruggingsdeel')
        if component == 'dek' or component is None and level > 0:
            return 'deck', geometry, component is None
        if component in {'landhoofd', 'sloof', 'pijler'}:
            return {'landhoofd': 'abutment', 'sloof': 'foundation', 'pijler': 'pier'}[component], geometry, False
    if name.startswith('kunstwerkdeel'):
        if tag in {'perron', 'hoogspanningsmast'}:
            return {'perron': 'platform', 'hoogspanningsmast': 'pylon'}[tag], geometry, False
        if tag == 'keermuur':
            return 'retainingWall', geometry, False
    if name.startswith('scheiding') and tag in WALL_WIDTHS:
        kind = {'geluidsscherm': 'noiseWall', 'muur': 'civilWall'}.get(tag, 'retainingWall')
        if kind == 'civilWall' and (prop['bronhouder'] not in CIVIL_OWNERS
                                    or geometry.length < (12 if name.endswith('_lijn') else 24)):
            return None
        return kind, geometry.buffer(WALL_WIDTHS[tag] / 2, cap_style='flat', join_style='mitre') if name.endswith('_lijn') else geometry, False
    if name == 'overigbouwwerk' and level == 0:
        if tag == 'opslagtank' and geometry.area >= 12:
            return 'tank', geometry, False
        if tag in {'open loods', 'schuur'} and geometry.area >= 80:
            return ('shed' if tag == 'open loods' else 'closedShed'), geometry, False
        if tag == 'windturbine':
            return 'turbine', geometry, False
    return None


def connected(records, distance):
    """Combine mapped parts without counting a crossing or mast once per BGT ID."""
    if not records:
        return
    tree = STRtree([r.geometry for r in records])
    unseen = set(range(len(records)))
    for first in range(len(records)):
        if first not in unseen:
            continue
        unseen.remove(first)
        cluster = [first]
        for index in cluster:
            for neighbor in sorted(tree.query(tree.geometries[index], predicate='dwithin', distance=distance)):
                if neighbor in unseen and records[neighbor].layer == records[first].layer:
                    unseen.remove(neighbor)
                    cluster.append(neighbor)
        group = [records[i] for i in cluster]
        yield Record(group[0].kind, group[0].layer, tuple(sorted({identity for r in group for identity in r.ids})),
                     union_all([r.geometry for r in group]), all(r.estimated_type for r in group))


def crossing_axis(geometry, routes, area):
    search = geometry.buffer(0.8)
    matches = [(routes.geometries[i].intersection(search).length, int(i))
               for i in routes.query(search, predicate='intersects')]
    if matches and max(matches)[0] > 2:
        route = routes.geometries[max(matches)[1]]
        along = route.project(geometry.centroid)
        a, b = route.interpolate(max(0, along - 8)), route.interpolate(min(route.length, along + 8))
        dx, dz = b.x - a.x, b.y - a.y
        center = route.interpolate(along)
    else:
        corners = list(geometry.minimum_rotated_rectangle.exterior.coords)
        dx, dz = max(((b[0] - a[0], b[1] - a[1]) for a, b in zip(corners, corners[1:])), key=lambda d: math.hypot(*d))
        center = geometry.centroid
    length = math.hypot(dx, dz)
    if length <= 1e-5:
        return None
    ux, uz = dx / length, dz / length
    projection = [(x - center.x) * ux + (z - center.y) * uz for x, z in geometry.convex_hull.exterior.coords]
    axis = LineString([(center.x + t * ux, center.y + t * uz) for t in [min(projection), max(projection)]])
    clipped = axis.intersection(area)
    parts = [clipped] if clipped.geom_type == 'LineString' else list(getattr(clipped, 'geoms', []))
    longest = max((part for part in parts if part.geom_type == 'LineString'), key=lambda part: part.length, default=None)
    if longest is None or longest.is_empty:
        return None
    return [round(v, 2) for point in (longest.coords[0], longest.coords[-1]) for v in point]


def encode(record):
    mesh = set_precision(record.geometry, 0.01).simplify(0.04, preserve_topology=True).normalize()
    rings = []
    for polygon in polygons(orient_polygons(mesh, exterior_cw=True)):
        rings.append([[round(v, 2) for point in list(ring.coords)[:-1] for v in point]
                      for ring in [polygon.exterior, *polygon.interiors]])
    if not rings and record.kind != 'pylon':
        return None
    result = {'kind': record.kind, 'ids': list(record.ids), 'layer': record.layer, 'polygons': rings}
    if record.estimated_type:
        result['estimatedType'] = True
    if record.kind == 'pylon':
        hull = record.geometry.convex_hull
        extent = hull
        if hull.geom_type == 'Polygon':
            with warnings.catch_warnings():
                warnings.filterwarnings('error', 'invalid value encountered in oriented_envelope', RuntimeWarning)
                try:
                    extent = hull.minimum_rotated_rectangle
                except RuntimeWarning:
                    extent = hull.envelope
        center = extent.centroid
        if extent.geom_type == 'Polygon':
            corners = list(extent.exterior.coords)[:-1]
            edges = [(math.dist(a, b), math.atan2(b[1] - a[1], b[0] - a[0]))
                     for a, b in zip(corners, corners[1:] + corners[:1])]
            span, angle = max(edges)
            base = min(edges)[0]
        else:
            span, base, angle = max(3.5, extent.length), max(3.5, extent.length), 0
        result['tower'] = [round(v, 2) for v in (center.x, center.y, span, base, angle)]
    if record.kind == 'turbine':
        for identity in record.ids:
            if identity in SMALL_TURBINE_HUBS:
                result['hubHeight'] = SMALL_TURBINE_HUBS[identity]
                break
    return result


def exterior_building_footprints():
    for building in read_packed('assets/ede-bag-exterior/footprints.json.gz'):
        for outer, *holes in building['polygons']:
            yield make_valid(Polygon(pairs(outer), [pairs(hole) for hole in holes]))


def merge_belt(previous, extension):
    structures = previous['structures']
    owners = {identity: record for record in structures for identity in record['ids']}
    for record in extension['structures']:
        shared = next((owners[identity] for identity in record['ids'] if identity in owners), None)
        if shared is None:
            structures.append(record)
            owners.update((identity, record) for identity in record['ids'])
            continue
        if shared['kind'] != record['kind'] or shared['layer'] != record['layer']:
            raise ValueError(f'Structure classification changed between municipality and belt: {record["ids"]}')
        shared['polygons'].extend(record['polygons'])
        for identity in record['ids']:
            if identity not in owners:
                shared['ids'].append(identity)
                owners[identity] = shared
    previous['source']['exterior'] = extension['source']
    previous['counts'] = dict(sorted(Counter(item['kind'] for item in structures).items()))
    previous['omitted'] = dict(sorted((Counter(previous['omitted']) + Counter(extension['omitted'])).items()))
    covered = set(previous.get('coveredByBuildings', ())) | set(extension.get('coveredByBuildings', ()))
    previous['coveredByBuildings'] = sorted(covered - owners.keys())
    return previous


def build(scene, directory, day, exterior=None):
    affine = scene['meta']['lonLatAffine']
    area = load_playable_boundary() if exterior is None else exterior
    west, south, east, north = SceneAffine(affine).geographic_bounds(area.bounds)
    road_features = [r for r in [*scene['roads'], *scene['railways']] if not r.get('tunnel') and len(r['pts']) >= 4]
    bridge_routes = STRtree([LineString(pairs(r['pts'])) for r in road_features if r.get('bridge')])
    corridor = STRtree([LineString(pairs(r['pts'])).buffer(
        (r.get('width', 3) / 2 + 0.25), cap_style='flat') for r in road_features if not r.get('bridge')])
    footprints = [make_valid(Polygon(pairs(b['ring']), [pairs(h) for h in b.get('holes', [])]))
                  for b in scene['buildings'] if len(b['ring']) >= 6 and not b.get('part')]
    if exterior is not None:
        footprints.extend(exterior_building_footprints())
    selected, source_counts, source_hashes = {}, {}, {}
    omitted = Counter()
    covered_by_buildings = []
    for name, features, digest in read_snapshot(directory):
        source_counts[name], source_hashes[name] = len(features), digest
        for identity, feature in sorted(features.items()):
            props = feature['properties']
            geom = world_geometry(feature, affine, area)
            if geom.is_empty:
                continue
            if name == 'pand':
                if props.get('bag_pnd') and (props.get('relatieve_hoogteligging') or 0) == 0:
                    footprints.append(geom)
                continue
            classification = classify(name, props, geom)
            if classification:
                kind, form, estimated_type = classification
                selected.setdefault(kind, []).append(
                    Record(kind, props.get('relatieve_hoogteligging') or 0, (identity,), form.intersection(area), estimated_type))
            elif name == 'overbruggingsdeel':
                omitted['unclassifiedCrossingComponent'] += 1
    if exterior is None and (not footprints or not selected.get('deck') or not selected.get('platform')):
        raise ValueError('Required BGT structure or building data is missing')

    footprint_index = STRtree(footprints)
    noise_index = STRtree([r.geometry for r in selected.get('noiseWall', [])])
    items = []
    for kind, records in sorted(selected.items()):
        retained = []
        for record in records:
            geom = record.geometry
            if kind in {'tank', 'shed', 'closedShed', 'abutment', 'foundation', 'pier', 'civilWall', 'retainingWall', 'noiseWall'}:
                buildings = nearby_union(footprint_index, geom)
                if kind in {'tank', 'shed', 'closedShed'} and geom.intersection(buildings).area > geom.area * 0.4:
                    omitted['coveredByBuilding'] += 1
                    covered_by_buildings.extend(record.ids)
                    continue
                geom = geom.difference(buildings)
            if kind in {'civilWall', 'retainingWall'}:
                geom = geom.difference(nearby_union(noise_index, geom, 1.0).buffer(1.0))
            if kind in {'civilWall', 'retainingWall', 'noiseWall', 'abutment', 'pier', 'foundation'} and record.layer == 0:
                geom = geom.difference(nearby_union(corridor, geom))
            if geom.is_empty:
                omitted[f'{kind}Overlap'] += 1
                continue
            record.geometry = geom
            retained.append(record)
        distance = {'pylon': 6, 'deck': 0.7, 'platform': 0.12}.get(kind, 0.08)
        for record in connected(retained, distance):
            item = encode(record)
            if item:
                if kind == 'deck':
                    item['axis'] = crossing_axis(record.geometry, bridge_routes, area)
                items.append(item)

    decks = [item for item in items if item['kind'] == 'deck']
    deck_index = STRtree([union_all([Polygon(pairs(outer), [pairs(h) for h in holes])
                                    for outer, *holes in deck['polygons']]) for deck in decks])
    for item in items:
        if item['kind'] not in {'abutment', 'pier', 'foundation'}:
            continue
        footing = union_all([Polygon(pairs(outer), [pairs(h) for h in holes]) for outer, *holes in item['polygons']])
        nearest = deck_index.query_nearest(footing)
        if not len(nearest):
            continue
        index = int(min(nearest))
        if deck_index.geometries[index].distance(footing) <= 9:
            item['deck'] = decks[index]['ids'][0]

    counts = Counter(item['kind'] for item in items)
    assert all(item['ids'] and (item['polygons'] or 'tower' in item) for item in items)
    assert all(math.isfinite(v) for item in items for poly in item['polygons'] for ring in poly for v in ring)
    return {
        'version': 1,
        'source': {'url': f'{API}/collections?f=html', 'license': 'CC0 1.0', 'date': str(day),
                   'municipality': scene['meta']['municipality']['id'],
                   'geographicBounds': [south, west, north, east] if exterior is not None else scene['meta']['geographicBounds'],
                   'collections': source_counts, 'sha256': source_hashes},
        'uncertainty': {
            'elevation': 'AHN DTM ground, inferred structure heights unless externally documented',
            'decks': 'Untyped raised bridge components are treated as decks; untyped ground pieces are excluded',
            'walls': 'BGT civil muur is generic wall; only mapped keermuur, damwand and kademuur are classified as retaining',
            'turbines': 'Maanderbroek Siemens SWT-3.2-101, 99.5 m hub and 101 m rotor. Small Lunteren and northern turbines scaled from local AHN observations.',
            'turbineDimensionsSource': 'https://verwaard-bv.nl/raedthuys-windpark-a30-a12-maanderbroek/',
        },
        'counts': dict(sorted(counts.items())), 'omitted': dict(sorted(omitted.items())),
        'coveredByBuildings': sorted(covered_by_buildings), 'structures': items,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--date', type=date.fromisoformat, required=True)
    parser.add_argument('--fetch', action='store_true')
    parser.add_argument('--retain-structures', type=Path, help='Keep the existing municipal asset and add source structures to the 500 m belt')
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/ede-bgt.json')
    args = parser.parse_args()
    scene = load_playable_scene()
    exterior = (load_coverage_polygon('buildingBoundary').difference(load_coverage_polygon('playableBoundary'))
                if args.retain_structures else None)
    if args.fetch:
        snapshot(args.directory, scene, args.date, exterior)
    result = build(scene, args.directory, args.date, exterior)
    if args.retain_structures:
        result = merge_belt(json.loads(args.retain_structures.read_bytes()), result)
    metadata = {key: value for key, value in result.items() if key != 'structures'}
    prefix = json.dumps(metadata, ensure_ascii=False, indent=2).removesuffix('\n}')
    rows = ',\n'.join('    ' + json.dumps(row, ensure_ascii=False, separators=(',', ':'))
                       for row in result['structures'])
    args.output.write_text(prefix + ',\n  "structures": [\n' + rows + '\n  ]\n}\n')
    print(json.dumps({'structureCounts': result['counts'], 'omitted': result['omitted']}, indent=2))


if __name__ == '__main__':
    main()
