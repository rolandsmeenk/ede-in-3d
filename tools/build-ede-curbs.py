#!/usr/bin/env python3
"""Bake reviewed curb top triangles in the Oude Kerk scene frame."""

import argparse
from collections import Counter
import gzip
import json
from math import hypot
from pathlib import Path
import xml.etree.ElementTree as ET

from shapely import constrained_delaunay_triangles, make_valid
from shapely.geometry import LineString, Polygon
from shapely.ops import split

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'assets'
PAVING = ('ede-road-surfaces', 'ede-corridor-paving', 'ede-north-paving', 'ede-fringe-paving',
          'ede-terrain-paving')


def read(name):
    with gzip.open(ASSETS / f'{name}.json.gz') as stream:
        return json.load(stream)


def polygon(rings):
    exterior, *holes = [list(zip(ring[::2], ring[1::2])) for ring in rings]
    return Polygon(exterior, holes)


def parts(geometry):
    if geometry.geom_type == 'Polygon':
        if geometry.area > 1e-8:
            yield geometry
    elif hasattr(geometry, 'geoms'):
        for item in geometry.geoms:
            yield from parts(item)


def station(origin, direction, knots):
    x, z = direction
    length = hypot(x, z)
    return x / length, z / length, origin, knots


def cut(poly, x, z, center, distance):
    min_x, min_z, max_x, max_z = poly.bounds
    cx, cz = center[0] + x * distance, center[1] + z * distance
    span = max(abs(min_x - cx), abs(max_x - cx), abs(min_z - cz), abs(max_z - cz)) * 2 + 1
    edge = LineString([(cx - z * span, cz + x * span), (cx + z * span, cz - x * span)])
    return list(parts(split(poly, edge)))


def plane(band, point):
    x, z, (ox, oz), knots = band
    s = x * (point.x - ox) + z * (point.y - oz)
    for (a, y), (b, end) in zip(knots, knots[1:]):
        if s < a:
            return 0, 0, y
        if s <= b:
            slope = (end - y) / (b - a)
            return x * slope, z * slope, y - slope * (a + x * ox + z * oz)
    return 0, 0, knots[-1][1]


def bake_top(rings, bands, lift, seam=None):
    surface = make_valid(polygon(rings))
    if seam is not None:
        # The surveyed sidewalk and NDW footprint can differ by a few centimetres at their join.
        surface = surface.union(surface.buffer(0.025).intersection(seam))
    pieces = list(parts(surface))
    for x, z, origin, knots in bands:
        for distance, _ in knots:
            pieces = [part for piece in pieces for part in cut(piece, x, z, origin, distance)]
    cap = []
    for piece in pieces:
        planes = [plane(band, piece.representative_point()) for band in bands]
        if len(planes) == 2:
            a, b, c = [u - v for u, v in zip(*planes)]
            length = hypot(a, b)
            cells = cut(piece, a / length, b / length, (0, 0), -c / length) if length else [piece]
        else:
            cells = [piece]
        for cell in cells:
            for triangle in constrained_delaunay_triangles(cell).geoms:
                for x, z in list(triangle.exterior.coords)[:3]:
                    y = min(a * x + b * z + c for a, b, c in planes)
                    cap.extend([round(x, 4), round(lift + max(0, y), 5), round(z, 4)])
    if not cap:
        raise ValueError('Empty curb profile')
    return cap


def osm_kerbs(files):
    nodes = {}
    for path in files:
        if path.suffix == '.json':
            source = json.loads(path.read_text())
            nodes.update((str(node['id']), node['tags']) for node in source['elements']
                         if node['type'] == 'node' and {'kerb', 'kerb:height', 'tactile_paving'} & node.get('tags', {}).keys())
        else:
            for _, element in ET.iterparse(path, events=('end',)):
                if element.tag == 'node':
                    tags = {child.attrib['k']: child.attrib['v'] for child in element if child.tag == 'tag'}
                    if {'kerb', 'kerb:height', 'tactile_paving'} & tags.keys():
                        nodes[element.attrib['id']] = tags
                    element.clear()
                elif element.tag in ('way', 'relation'):
                    element.clear()
    return {key: dict(sorted(Counter(tags[key] for tags in nodes.values() if key in tags).items()))
            for key in ('kerb', 'kerb:height', 'tactile_paving')}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--review', type=Path, default=ROOT / 'tools/data/ede-curb-pilots.json')
    parser.add_argument('--output', type=Path, default=ASSETS / 'ede-curbs-v1.json.gz')
    parser.add_argument('--audit', type=Path)
    parser.add_argument('--osm', type=Path, nargs='*', default=[], help='Dated Overpass JSON or OSM XML snapshots')
    args = parser.parse_args()
    review = json.loads(args.review.read_text())
    if review['version'] != 1:
        raise ValueError('Unsupported curb review version')
    paving = [read(name) for name in PAVING]
    inventory = {row['id']: row for pack in reversed(paving) for row in pack['surfaces']}
    surfaces = {key.split('.', 1)[-1]: value for key, value in inventory.items()}
    street = read('ede-street-features')
    crossings = {row['id']: row for row in street['crossings']}
    bumps = {row['id']: row for row in street['bumps']}
    defaults = review['defaults']
    walk, island, lift = (defaults[key] for key in ('sidewalk', 'island', 'roadLift'))
    profiles, tactile, counts = {}, {}, Counter()
    baked_sites, driveways, grade_profiles = [], [], {}

    def add(key, bands, kind, seam=None):
        row = surfaces[key]
        if row['layer'] or row['function'] not in ('voetpad', 'verkeerseiland', 'inrit') or row['id'] in profiles:
            raise ValueError(f"Unexpected or duplicate curb surface {row['id']}")
        profiles[row['id']] = [bake_top(rings, bands, lift, seam) for rings in row['polygons']]
        counts[kind] += 1

    for site in review['sites']:
        if 'gradeProfiles' in site:
            grade_profiles.update((profile, defaults['gradeLift']) for profile in site['gradeProfiles'])
        else:
            baked_sites.append([*site['center'], site['radius']])
        for item in site.get('crossings', []):
            crossing = crossings[item['id']]
            assert crossing['control'] == 'signal' and crossing['refuge'] and not crossing['layer']
            # Use the linked crossing axis while keeping the separately mapped asphalt cut-through.
            a, b = crossing['ends']
            direction = a[1] - b[1], b[0] - a[0]
            opening = surfaces[item['cutThrough']]
            assert opening['layer'] == 0 and opening['function'] == 'fietspad'
            for key in item['lowered'] + item['raised']:
                refuge = surfaces[key]['function'] == 'verkeerseiland'
                height = island if refuge else walk
                band = station(crossing['refugePoint'], direction,
                               [(-2.4, height), (-1.25, 0), (1.25, 0), (2.4, height)])
                add(key, [band], 'refuge island' if refuge else 'crossing approach')
            counts['existing refuge cut-through'] += 1
        if 'table' in site:
            crossing, table = crossings[site['crossing']], bumps[site['table']]
            assert crossing['bumpId'] == table['id'] and table['profile'] == 'table' and table['layer'] == 0
            landing = table['height'] + defaults['tableLift'] - lift
            assert 0 <= landing <= walk
            knots = [(-18, 0), (-15, walk), (-2.8, walk), (-1.45, landing),
                     (1.45, landing), (2.8, walk), (15, walk), (18, 0)]
            band = station((crossing['x'], crossing['z']), table['tangent'], knots)
            a, b = crossing['ends']
            table_surface = surfaces[site['tableSurface']]
            assert table_surface['layer'] == 0 and table_surface['function'] == 'verkeersdrempel'
            seam = polygon(table_surface['polygons'][0]).buffer(0.01).intersection(LineString([a, b]).buffer(1.2))
            for key in site['sidewalks']:
                add(key, [band], 'raised-table approach', seam)
            dx, dz = b[0] - a[0], b[1] - a[1]
            length = hypot(dx, dz)
            dx, dz = dx / length, dz / length
            # The OSM tag establishes tactile paving. The panel size and dot spacing are estimates.
            for key, x, z in site.get('tactile', []):
                row = surfaces[key]
                positions = []
                for u in [-0.20, -0.10, 0, 0.10, 0.20]:
                    for v in [-0.40, -0.30, -0.20, -0.10, 0, 0.10, 0.20, 0.30, 0.40]:
                        px, pz = x + u * dx - v * dz, z + u * dz + v * dx
                        points = [(px - 0.017, pz), (px, pz + 0.017),
                                  (px + 0.017, pz), (px, pz - 0.017)]
                        for i in [0, 1, 2, 0, 2, 3]:
                            tx, tz = points[i]
                            positions.extend((round(tx, 4), round(lift + landing + 0.006, 5), round(tz, 4)))
                tactile[row['id']] = positions
                counts['estimated tactile panel'] += 1
        if 'driveway' in site:
            a, b = site['roadSeam']
            dx, dz = b[0] - a[0], b[1] - a[1]
            driveway = station(a, (dz, -dx), [(0, 0), (0.95, walk), (1.65, walk), (site['drivewayDepth'], 0)])
            limit = station(site['center'], (dx, dz), [(-9, 0), (-6, walk), (6, walk), (9, 0)])
            add(site['driveway'], [driveway], 'driveway')
            driveways.append(surfaces[site['driveway']]['id'])
            for key in site['sidewalks']:
                add(key, [driveway, limit], 'driveway sidewalk')

    result = {'version': 1, 'roadLift': lift, 'table': next(site['table'] for site in review['sites'] if 'table' in site),
              'sites': baked_sites, 'profiles': profiles, 'driveways': driveways, 'gradeProfiles': grade_profiles, 'tactile': tactile}
    args.output.write_bytes(gzip.compress(json.dumps(result, separators=(',', ':')).encode(), mtime=0))
    audit = {
        'inventory': dict(sorted(Counter(row['function'] for row in inventory.values()).items())),
        'crossings': len(crossings),
        'osmKerbTagsInSuppliedSnapshots': osm_kerbs(args.osm) if args.osm else None,
        'fitted': dict(sorted(counts.items())),
        'existingGradeContacts': len(grade_profiles),
        'heightSources': {'measured': 0, 'default': len(profiles), 'existingTableEstimate': 1},
        'unresolved': [site['id'] for site in review['sites'] if 'review' in site],
        'compressedBytes': args.output.stat().st_size,
    }
    if args.audit:
        args.audit.write_text(json.dumps(audit, indent=2) + '\n')
    print(json.dumps(audit, indent=2))


if __name__ == '__main__':
    main()
