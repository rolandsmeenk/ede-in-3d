#!/usr/bin/env python3
"""Export the LoD 2.2 walls and neighbourhoods for the Ede façade pilot."""

import argparse
from collections import Counter
import json
import math
from pathlib import Path
import runpy
from urllib.parse import urlencode
from urllib.request import urlopen

from pyproj import Transformer
from shapely import transform
from shapely.geometry import LineString, Point, Polygon, shape
from shapely.ops import unary_union
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[1]
BAG = 'https://api.3dbag.nl/collections/pand/items'
CBS = 'https://api.pdok.nl/cbs/wijken-en-buurten-2025/ogc/v1/collections/buurten/items'
SITES = {
    'kolkakkerweg': (5.664727, 52.039074, 92),
    'grotestraat': (5.67087, 52.04734, 78),
    'oude-kerk': (5.67139, 52.04583, 47),
}
STREETS = {'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'pedestrian'}


def fetch_json(url):
    with urlopen(url, timeout=60) as response:
        return json.load(response)


def bag_site(cache, name, bounds, fetch):
    path = cache / f'{name}.json'
    if not fetch:
        return json.loads(path.read_text())
    pages = []
    url = f'{BAG}?{urlencode(dict(bbox=",".join(map(str, bounds)), limit=100))}'
    while url:
        page = fetch_json(url)
        pages.append(page)
        url = next((link['href'] for link in page.get('links', []) if link['rel'] == 'next'), None)
    path.write_text(json.dumps(pages, separators=(',', ':')))
    return pages


def coordinates(flat):
    return list(zip(flat[::2], flat[1::2]))


def footprint(geometry, vertices):
    return unary_union([Polygon([vertices[i][0:3:2] for i in surface[0]],
                                [[vertices[i][0:3:2] for i in hole] for hole in surface[1:]]).buffer(0)
                        for surface in geometry['boundaries']])


def build_site(pages, scene_xy, neighbourhoods, osm, street_tree, shops, terrain, name):
    buildings = {}
    for page in pages:
        transform = page['metadata']['transform']
        for feature in page['features']:
            bag_id = feature['id']
            city = feature['CityObjects']
            main = city[bag_id]
            vertices = []
            for point in feature['vertices']:
                east, north, nap = (p * scale + shift for p, scale, shift in
                                    zip(point, transform['scale'], transform['translate']))
                x, z = scene_xy(east, north)
                vertices.append((x, nap, z))
            geometries = [g for building in city.values() for g in building.get('geometry', [])
                          if g['lod'] == '2.2' and g['type'] in ('Solid', 'MultiSolid')]
            if not geometries:
                continue
            footprint_record = next((g for g in main.get('geometry', [])
                                     if g['type'] == 'MultiSurface' and g['lod'] == '0'), None)
            if not footprint_record:
                continue
            shape_ = footprint(footprint_record, vertices)
            if shape_.is_empty:
                continue
            faces = []
            for geom in geometries:
                semantics = geom['semantics']
                solids = geom['boundaries'] if geom['type'] == 'MultiSolid' else [geom['boundaries']]
                values = semantics['values'] if geom['type'] == 'MultiSolid' else [semantics['values']]
                for solid, shell_values in zip(solids, values):
                    for shell, indices in zip(solid, shell_values):
                        for rings, index in zip(shell, indices):
                            if index is not None:
                                faces.append((semantics['surfaces'][index], [vertices[i] for i in rings[0]]))
            if not faces:
                continue
            nap_base = min(p[1] for _, points in faces for p in points)
            seat = min(terrain.at((x, z)) - terrain.nap - (y - nap_base)
                       for _, points in faces for x, y, z in points if y - nap_base <= 0.25)
            buildings[bag_id] = (shape_, faces, nap_base, seat, main.get('attributes', {}))

    entries = list(buildings.values())
    footprints = STRtree([row[0] for row in entries])
    eaves = [row[3] + (row[4].get('b3_h_dak_min') or row[2]) - row[2] for row in entries]
    osm_tree, osm_data, osm_shapes = osm
    rows = []
    for number, (bag_id, (shape_, faces, nap_base, seat, attrs)) in enumerate(buildings.items()):
        match = max(((shape_.intersection(osm_shapes[i]).area, i) for i in osm_tree.query(shape_)), default=(0, -1))
        meta = osm_data[match[1]] if match[0] >= shape_.area * 0.5 else {}
        centre = shape_.representative_point()
        neighbourhood = next((code for code, poly in neighbourhoods if poly.covers(centre)), None)
        selected = {}
        for semantics, points in faces:
            if semantics['type'] != 'WallSurface' or len(points) < 3:
                continue
            wall = wall_segment(points, shape_, nap_base, seat)
            if wall is None:
                continue
            a, b, min_y, height = wall
            dx, dz = b[0] - a[0], b[1] - a[1]
            width = math.hypot(dx, dz)
            normal = (-dz / width, dx / width)
            edge = LineString((a, b))
            outside = LineString([(x + normal[0] * 0.28, z + normal[1] * 0.28) for x, z in (a, b)])
            shared = (min_y - seat < 1 and any(i != number and
                eaves[i] >= min_y + height - 0.20
                and outside.intersection(footprints.geometries[i].buffer(0.12)).length > width * 0.65
                for i in footprints.query(edge.buffer(0.50))))
            wall_type, street = ('shared', '') if shared else street_facing(edge, normal, street_tree)
            base_offset = min_y - seat
            # Orientation and stable geometry, independent of the API's face order and the scene terrain.
            wall_id = ','.join(f'{v:.2f}' for v in (*a, *b, base_offset))
            row = dict(bagId=bag_id, wallId=wall_id, a=list(map(round_cm, a)), b=list(map(round_cm, b)),
                       minY=round_cm(min_y), baseOffset=round_cm(base_offset),
                       height=round_cm(height), width=round_cm(width), wallType=wall_type,
                       neighbourhood=neighbourhood, site=name, street=street)
            if wall_id not in selected or height > selected[wall_id]['height']:
                selected[wall_id] = row
        if not selected:
            continue
        street_walls = [w for w in selected.values() if w['wallType'] == 'street']
        front = max(street_walls, key=lambda w: w['width'] * w['height'], default=None)
        if front:
            fx, fz = (end - start for start, end in zip(front['a'], front['b']))
            for wall in selected.values():
                if wall['wallType'] != 'side':
                    continue
                dx, dz = (end - start for start, end in zip(wall['a'], wall['b']))
                if dx * fx + dz * fz < -0.8 * front['width'] * wall['width']:
                    wall['wallType'] = 'rear'
        kind = meta.get('kind')
        if kind in {'church', 'cathedral', 'chapel'}:
            building_type = 'landmark'
        elif kind in {'retail', 'commercial', 'supermarket', 'shops'} or (
                kind in {'yes', 'building', 'apartments', 'residential', None}
                and bool(len(shops.query(shape_, predicate='covers')))):
            building_type = 'shop'
        elif kind in {'apartments', 'dormitory'}:
            building_type = 'apartments'
        elif kind in {'house', 'terrace', 'detached', 'semidetached_house', 'residential'}:
            attached = any(i != number and shape_.boundary.intersection(footprints.geometries[i].buffer(0.14)).length > 2
                           for i in footprints.query(shape_.buffer(0.14)))
            building_type = 'terraced' if attached or kind == 'terrace' else 'detached'
        else:
            building_type = 'other'
        for wall in selected.values():
            rows.append({**wall, 'buildingType': building_type,
                         'storeys': meta.get('levels') or attrs.get('b3_bouwlagen') or None,
                         'name': meta.get('name', ''), 'osmId': meta.get('id')})
    return rows


def round_cm(value):
    return round(value, 2)


def wall_segment(points, footprint, nap_base, seat):
    xz = [(x, z) for x, _, z in points]
    width, a, b = max((math.dist(a, b), a, b) for i, a in enumerate(xz) for b in xz[i + 1:])
    ys = [y for _, y, _ in points]
    min_y, height = min(ys), max(ys) - min(ys)
    if width < 1.1 or height < 1.0:
        return None
    dx, dz = (b[0] - a[0]) / width, (b[1] - a[1]) / width
    if max(abs((x - a[0]) * dz - (z - a[1]) * dx) for x, z in xz) > 0.18:
        return None
    # CityJSON exterior rings are right-handed in RD + NAP. The game frame keeps that handedness.
    nx = nz = 0.
    for (x, y, z), (qx, qy, qz) in zip(points, points[1:] + points[:1]):
        nx += (y - qy) * (z + qz)
        nz += (x - qx) * (y + qy)
    if nx * -dz + nz * dx < 0:
        a, b, dx, dz = b, a, -dx, -dz
    mx, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
    if footprint.contains(Point(mx - dz * 0.18, mz + dx * 0.18)) and not footprint.contains(
            Point(mx + dz * 0.18, mz - dx * 0.18)):
        a, b = b, a
    return a, b, seat + min_y - nap_base, height


def street_facing(edge, normal, street_tree):
    paths, names = street_tree
    center = edge.interpolate(0.5, normalized=True)
    nearest = None
    for i in paths.query(center.buffer(30)):
        target = paths.geometries[i].interpolate(paths.geometries[i].project(center))
        dx, dz = target.x - center.x, target.y - center.y
        distance = math.hypot(dx, dz)
        outward = dx * normal[0] + dz * normal[1]
        if 1 < distance < 30 and outward > distance * 0.55:
            score = distance * (2 - outward / distance)
            if nearest is None or score < nearest[0]:
                nearest = score, names[i]
    if nearest:
        return 'street', nearest[1]
    return 'side', ''


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('cache', type=Path)
    cli.add_argument('output', type=Path)
    cli.add_argument('--fetch', action='store_true')
    args = cli.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    common = runpy.run_path(str(ROOT / 'tools' / 'build-ede-grade.py'))
    scene = common['load_scene']()
    terrain = common['Terrain']()
    frame, project = scene['meta']['lonLatAffine'], common['project']
    to_rd = Transformer.from_crs(4326, 28992, always_xy=True).transform
    to_wgs = Transformer.from_crs(28992, 4326, always_xy=True).transform
    cbs_cache = args.cache / 'buurten.json'
    if args.fetch:
        cbs_cache.write_text(json.dumps(fetch_json(f'{CBS}?gemeentecode=GM0228&limit=500')))
    areas = json.loads(cbs_cache.read_text())['features']
    neighbourhoods = [(f['properties']['buurtcode'],
                       transform(shape(f['geometry']), lambda lon, lat: ((lon - frame['lon0']) * frame['x'][1],
                                 (lat - frame['lat0']) * frame['z'][2]), interleaved=False)) for f in areas]
    osm_data = [b for b in scene['buildings'] if not b.get('part') and len(b['ring']) >= 6]
    osm_shapes = [Polygon(coordinates(b['ring']), [coordinates(h) for h in b.get('holes', [])]).buffer(0)
                  for b in osm_data]
    roads = [r for r in scene['roads'] if r.get('kind') in STREETS and r.get('name')]
    street_tree = STRtree([LineString(coordinates(r['pts'])) for r in roads]), [r['name'] for r in roads]
    shops = STRtree([Point(x, z) for _, x, z, _ in (
        json.loads(line.strip().rstrip(',')) for line in (ROOT / 'js' / 'ede-shops.js').read_text().splitlines()
        if line.lstrip().startswith('["'))])
    osm = STRtree(osm_shapes), osm_data, osm_shapes
    walls = {}
    for name, (lon, lat, radius) in SITES.items():
        east, north = to_rd(lon, lat)
        bounds = [round(east - radius), round(north - radius), round(east + radius), round(north + radius)]
        pages = bag_site(args.cache, name, bounds, args.fetch)
        site_rows = build_site(pages, lambda e, n: project(frame, *to_wgs(e, n)),
                               neighbourhoods, osm, street_tree, shops, terrain, name)
        print(name, len(site_rows), Counter(row['buildingType'] for row in site_rows))
        for row in site_rows:
            walls[row['bagId'], row['wallId']] = row
    args.output.write_text(json.dumps(dict(version=1, walls=list(walls.values())), separators=(',', ':')) + '\n')


if __name__ == '__main__':
    main()
