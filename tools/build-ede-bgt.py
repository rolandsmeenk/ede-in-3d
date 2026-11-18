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

from shapely import STRtree, make_valid, orient_polygons, set_precision, union_all
from shapely.affinity import affine_transform
from shapely.geometry import LineString, Polygon, box, shape


ROOT = Path(__file__).resolve().parents[1]
API = 'https://api.pdok.nl/lv/bgt/ogc/v1'
COLLECTIONS = (
    'overbruggingsdeel', 'kunstwerkdeel_lijn', 'kunstwerkdeel_punt', 'kunstwerkdeel_vlak',
    'scheiding_lijn', 'scheiding_vlak', 'overigbouwwerk', 'pand',
)
WALL_WIDTHS = {'geluidsscherm': 0.32, 'keermuur': 0.45, 'damwand': 0.34, 'kademuur': 0.45, 'muur': 0.36}
CIVIL_OWNERS = {'L0002', 'L0004', 'P0025'}  # Rijkswaterstaat, ProRail, Gelderland


@dataclass
class Record:
    kind: str
    layer: int
    ids: tuple
    geometry: object
    estimated_type: bool = False


def load_scene():
    prefix = 'export const EDE_DATA = '
    with (ROOT / 'js/ede-geodata.js').open() as stream:
        line = next(line for line in stream if line.startswith(prefix))
    return json.loads(line[len(prefix):].strip().removesuffix(';'))


def fetch_tile(collection, bounds, day):
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
        raw = subprocess.check_output(['curl', '-fsSL', '--max-time', '40', '--retry', '2', url])
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


def snapshot(directory, scene, day):
    directory.mkdir(parents=True, exist_ok=True)
    south, west, north, east = scene['meta']['geographicBounds']
    work = [(name, (west, south, east, north), day) for name in COLLECTIONS if name != 'pand']
    xs = [west + (east - west) * i / 6 for i in range(7)]
    ys = [south + (north - south) * i / 6 for i in range(7)]
    work.extend(('pand', (x0, y0, x1, y1), day) for y0, y1 in zip(ys, ys[1:]) for x0, x1 in zip(xs, xs[1:]))
    data = {name: {} for name in COLLECTIONS}
    with ThreadPoolExecutor(max_workers=8) as pool:
        for name, features in pool.map(lambda args: fetch_tile(*args), work):
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
    lon0, lat0 = affine['lon0'], affine['lat0']
    x0, x_lon, x_lat = affine['x']
    z0, z_lon, z_lat = affine['z']
    geom = shape(feature['geometry'])
    min_lon, min_lat, max_lon, max_lat = geom.bounds
    if not (-180 <= min_lon <= max_lon <= 180 and -90 <= min_lat <= max_lat <= 90):
        raise ValueError('Expected PDOK GeoJSON longitude/latitude coordinates')
    transform = (x_lon, x_lat, z_lon, z_lat,
                 x0 - lon0 * x_lon - lat0 * x_lat, z0 - lon0 * z_lon - lat0 * z_lat)
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


def crossing_axis(geometry, routes):
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
    return [round(v, 2) for t in [min(projection), max(projection)] for v in
            (center.x + t * ux, center.y + t * uz)]


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
        extent = record.geometry.convex_hull.minimum_rotated_rectangle
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
    return result


def build(scene, directory, day):
    affine = scene['meta']['lonLatAffine']
    area = box(*scene['meta']['bounds'])
    road_features = [r for r in [*scene['roads'], *scene['railways']] if not r.get('tunnel') and len(r['pts']) >= 4]
    bridge_routes = STRtree([LineString(pairs(r['pts'])) for r in road_features if r.get('bridge')])
    corridor = STRtree([LineString(pairs(r['pts'])).buffer(
        (r.get('width', 3) / 2 + 0.25), cap_style='flat') for r in road_features if not r.get('bridge')])
    footprints = [make_valid(Polygon(pairs(b['ring']), [pairs(h) for h in b.get('holes', [])]))
                  for b in scene['buildings'] if len(b['ring']) >= 6 and not b.get('part')]
    selected, source_counts, source_hashes = {}, {}, {}
    omitted = Counter()
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
    if not footprints or not selected.get('deck') or not selected.get('platform'):
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
                    item['axis'] = crossing_axis(record.geometry, bridge_routes)
                items.append(item)

    decks = [item for item in items if item['kind'] == 'deck']
    deck_index = STRtree([union_all([Polygon(pairs(outer), [pairs(h) for h in holes])
                                    for outer, *holes in deck['polygons']]) for deck in decks])
    for item in items:
        if item['kind'] not in {'abutment', 'pier', 'foundation'}:
            continue
        footing = union_all([Polygon(pairs(outer), [pairs(h) for h in holes]) for outer, *holes in item['polygons']])
        index = int(min(deck_index.query_nearest(footing)))
        if deck_index.geometries[index].distance(footing) <= 9:
            item['deck'] = decks[index]['ids'][0]

    counts = Counter(item['kind'] for item in items)
    assert all(item['ids'] and (item['polygons'] or 'tower' in item) for item in items)
    assert all(math.isfinite(v) for item in items for poly in item['polygons'] for ring in poly for v in ring)
    return {
        'version': 1,
        'source': {'url': f'{API}/collections?f=html', 'license': 'CC0 1.0', 'date': str(day),
                   'collections': source_counts, 'sha256': source_hashes},
        'uncertainty': {
            'elevation': 'AHN DTM ground, inferred structure heights unless externally documented',
            'decks': 'Untyped raised bridge components are treated as decks; untyped ground pieces are excluded',
            'walls': 'BGT civil muur is generic wall; only mapped keermuur, damwand and kademuur are classified as retaining',
            'turbines': 'Maanderbroek Siemens SWT-3.2-101, 99.5 m hub and 101 m rotor diameter',
            'turbineDimensionsSource': 'https://verwaard-bv.nl/raedthuys-windpark-a30-a12-maanderbroek/',
        },
        'counts': dict(sorted(counts.items())), 'omitted': dict(sorted(omitted.items())), 'structures': items,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--date', type=date.fromisoformat, required=True)
    parser.add_argument('--fetch', action='store_true')
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/ede-bgt.json')
    args = parser.parse_args()
    scene = load_scene()
    if args.fetch:
        snapshot(args.directory, scene, args.date)
    result = build(scene, args.directory, args.date)
    metadata = {key: value for key, value in result.items() if key != 'structures'}
    prefix = json.dumps(metadata, ensure_ascii=False, indent=2).removesuffix('\n}')
    rows = ',\n'.join('    ' + json.dumps(row, ensure_ascii=False, separators=(',', ':'))
                       for row in result['structures'])
    args.output.write_text(prefix + ',\n  "structures": [\n' + rows + '\n  ]\n}\n')
    print(json.dumps({'structureCounts': result['counts'], 'omitted': result['omitted']}, indent=2))


if __name__ == '__main__':
    main()
