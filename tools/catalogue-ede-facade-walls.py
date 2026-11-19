#!/usr/bin/env python3
"""Catalogue LoD 2.2 façade walls throughout the playable Ede bounds."""

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import gzip
from hashlib import sha256
from itertools import product
import json
import math
from pathlib import Path
import runpy
from urllib.parse import urlencode, urlparse
from urllib.request import urlopen

import numpy as np
from flatgeobuf import Reader
from ede_gis import Frame, source_crs
from shapely import transform
from shapely.geometry import LineString, Point, Polygon, box, shape
from shapely.ops import unary_union
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[1]
BAG_INDEX = 'https://data.3dbag.nl/v20250903/tile_index.fgb'
BAG_HOST = '3dbag.fsn1.your-objectstorage.com'
BAG_RELEASE = 'v2025.09.03'
CBS = 'https://api.pdok.nl/cbs/wijken-en-buurten-2025/ogc/v1/collections/buurten/items'
STREETS = {'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'pedestrian'}


def cached(path, url, fetch, digest=None):
    if not path.is_file():
        if not fetch:
            raise FileNotFoundError(f'{path} is missing. Use --fetch to populate the offline cache.')
        with urlopen(url, timeout=60) as response:
            data = response.read()
        if digest and sha256(data).hexdigest() != digest:
            raise ValueError(f'Source checksum mismatch: {url}')
        staging = path.with_suffix('.download')
        staging.write_bytes(data)
        staging.replace(path)
    data = path.read_bytes()
    if digest and sha256(data).hexdigest() != digest:
        raise ValueError(f'Cached source checksum mismatch: {path}')
    return data


def cityjson_tiles(cache, frame, bounds, fetch):
    left, bottom, right, top = bounds
    axes = list(zip(*(frame.scene_to_rd(x, z) for x, z in product((left, right), (bottom, top)))))
    rd_bounds = tuple([min(values) - 20 for values in axes] + [max(values) + 20 for values in axes])
    path = cache / 'tile_index.fgb'
    cached(path, BAG_INDEX, fetch)
    with path.open('rb') as source:
        records = [dict(feature.properties) for feature in Reader(source, bbox=rd_bounds)]
    if not records:
        raise ValueError('3DBAG releases no tiles over the playable bounds')

    def load(record):
        url = urlparse(record['cj_download'])
        if url.scheme != 'https' or url.hostname != BAG_HOST or not url.path.startswith('/v20250903/tiles/'):
            raise ValueError('Unexpected 3DBAG tile URL')
        path = cache / Path(url.path).name
        return path.name, cached(path, url.geturl(), fetch, record['cj_sha256'])

    with ThreadPoolExecutor(max_workers=5) as pool:
        for name, compressed in pool.map(load, records):
            document = json.loads(gzip.decompress(compressed))
            meta = document['metadata']
            if meta['version'] != BAG_RELEASE or not meta['referenceSystem'].endswith('/7415'):
                raise ValueError(f'Unexpected 3DBAG coordinate reference or release in {name}')
            yield name, document


def coordinates(flat):
    return list(zip(flat[::2], flat[1::2]))


def footprint(geometry, vertices):
    return unary_union([Polygon([vertices[i][0:3:2] for i in surface[0]],
                                [[vertices[i][0:3:2] for i in hole] for hole in surface[1:]]).buffer(0)
                        for surface in geometry['boundaries']])


def build_buildings(documents, frame, terrain, area):
    buildings = {}
    for tile_name, document in documents:
        city = document['CityObjects']
        sx, sn, sy = document['transform']['scale']
        tx, tn, ty = document['transform']['translate']
        coords = np.asarray(document['vertices'], dtype=float)
        if not coords.size:
            continue
        xs, zs = frame.rd_to_scene(coords[:, 0] * sx + tx, coords[:, 1] * sn + tn)
        vertices = list(zip(xs, coords[:, 2] * sy + ty, zs))
        start = len(buildings)
        for bag_id, main in city.items():
            if main['type'] != 'Building' or bag_id in buildings:
                continue
            outline = next((g for g in main.get('geometry', [])
                            if g['type'] == 'MultiSurface' and g['lod'] == '0'), None)
            if not outline:
                continue
            shape_ = footprint(outline, vertices)
            if shape_.is_empty or not area.intersects(shape_):
                continue
            parts = [main, *(city[child] for child in main.get('children', ()))]
            faces = []
            for geom in (g for part in parts for g in part.get('geometry', []) if g['lod'] == '2.2'):
                if geom['type'] not in ('Solid', 'MultiSolid') or not geom.get('semantics'):
                    continue
                semantics = geom['semantics']
                multi = geom['type'] == 'MultiSolid'
                solids = geom['boundaries'] if multi else [geom['boundaries']]
                values = semantics['values'] if multi else [semantics['values']]
                for solid, shell_values in zip(solids, values):
                    for shell, indices in zip(solid, shell_values):
                        for rings, index in zip(shell, indices):
                            if index is not None and rings:
                                faces.append((semantics['surfaces'][index], [vertices[i] for i in rings[0]]))
            if not faces:
                continue
            nap_base = min(p[1] for _, points in faces for p in points)
            seat = min(terrain.at((x, z)) - terrain.nap - (y - nap_base)
                       for _, points in faces for x, y, z in points if y - nap_base <= 0.25)
            buildings[bag_id] = (shape_, faces, nap_base, seat, main.get('attributes', {}))
        print(tile_name, len(buildings) - start, 'playable BAG buildings', flush=True)
    return buildings


def catalogue_walls(buildings, area, neighbourhoods, osm, street_tree, shops):
    entries = list(buildings.values())
    footprints = STRtree([row[0] for row in entries])
    tops = [max(row[2], row[4].get('b3_h_dak_min') or row[2]) for row in entries]
    osm_tree, osm_data, osm_shapes = osm
    area_tree = STRtree([item[1] for item in neighbourhoods])
    neighbours = []
    for i, (shape_, *_) in enumerate(entries):
        neighbours.append({j for j in footprints.query(shape_.buffer(0.20))
                           if i != j and shape_.boundary.intersection(footprints.geometries[j].buffer(0.15)).length >= 2})
    rows = []
    for number, (bag_id, (shape_, faces, nap_base, seat, attrs)) in enumerate(buildings.items()):
        if not area.intersects(shape_):
            continue
        match = max(((shape_.intersection(osm_shapes[i]).area / max(shape_.area, osm_shapes[i].area), i)
                     for i in osm_tree.query(shape_)), default=(0, -1))
        meta = osm_data[match[1]] if match[0] >= 0.42 else {}
        centre = shape_.representative_point()
        area_match = area_tree.query(centre, predicate='covered_by')
        neighbourhood = neighbourhoods[area_match[0]][0] if len(area_match) else None
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
            bottom = min_y - seat + nap_base
            shared = any(tops[i] >= bottom + min(0.75, height * 0.65)
                         and outside.intersection(footprints.geometries[i].buffer(0.15)).length > width * 0.65
                         for i in neighbours[number])
            wall_type, street = ('shared', '') if shared else street_facing(
                edge, normal, street_tree, footprints, number)
            base_offset = min_y - seat
            # Orientation and stable geometry, independent of the API's face order and the scene terrain.
            wall_id = ','.join(f'{v:.2f}' for v in (*a, *b, base_offset))
            row = dict(bagId=bag_id, wallId=wall_id, a=list(map(round_cm, a)), b=list(map(round_cm, b)),
                       minY=round_cm(min_y), baseOffset=round_cm(base_offset),
                       height=round_cm(height), width=round_cm(width), wallType=wall_type,
                       neighbourhood=neighbourhood, street=street)
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
        has_shop = bool(len(shops.query(shape_, predicate='covers')))
        known_levels = meta.get('levels') or attrs.get('b3_bouwlagen') or None
        if kind in {'church', 'cathedral', 'chapel'}:
            building_type = 'landmark'
        elif has_shop and kind in {'house', 'apartments', 'residential', 'dormitory'}:
            building_type = 'mixed-use'
        elif kind in {'retail', 'commercial', 'supermarket', 'shops'} or (
                kind in {'yes', 'building', None} and has_shop):
            building_type = 'shop'
        elif kind in {'apartments', 'dormitory'}:
            building_type = 'apartments'
        elif kind in {'house', 'terrace', 'detached', 'semidetached_house', 'residential'}:
            attached = neighbours[number]
            if kind == 'detached':
                building_type = 'detached'
            elif kind == 'terrace':
                building_type = 'terraced'
            elif kind == 'semidetached_house':
                building_type = 'semi-detached'
            elif not attached:
                building_type = 'detached'
            elif len(attached) == 1 and all(len(neighbours[i]) == 1 for i in attached):
                building_type = 'semi-detached'
            else:
                building_type = 'terraced'
        else:
            building_type = 'other'
        for wall in selected.values():
            rows.append({**wall, 'buildingType': building_type,
                         'storeys': known_levels,
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


def street_facing(edge, normal, street_tree, footprints, own):
    paths, names = street_tree
    center = edge.interpolate(0.5, normalized=True)
    candidates = []
    for i in paths.query(center.buffer(30)):
        target = paths.geometries[i].interpolate(paths.geometries[i].project(center))
        dx, dz = target.x - center.x, target.y - center.y
        distance = math.hypot(dx, dz)
        outward = dx * normal[0] + dz * normal[1]
        if 1 < distance < 30 and outward > distance * 0.55:
            candidates.append((distance * (2 - outward / distance), i, target))
    for _, i, target in sorted(candidates):
        sightline = LineString([center, target])
        if all(j == own or sightline.intersection(footprints.geometries[j]).length <= 0.5
               for j in footprints.query(sightline, predicate='intersects')):
            return 'street', names[i]
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
    frame = Frame(scene['meta']['lonLatAffine'])
    bounds = scene['meta']['bounds']
    cbs_query = urlencode({'gemeentecode': 'GM0228', 'limit': 500})
    cbs = json.loads(cached(args.cache / 'buurten.json', f'{CBS}?{cbs_query}', args.fetch))
    if any(link.get('rel') == 'next' for link in cbs.get('links', [])):
        raise ValueError('CBS Ede neighbourhood download is incomplete')
    crs = source_crs(cbs)
    neighbourhoods = [(f['properties']['buurtcode'],
                       transform(shape(f['geometry']), lambda x, y: frame.to_scene(x, y, crs, axis_order='xy'),
                                 interleaved=False)) for f in cbs['features']]
    osm_data = [b for b in scene['buildings'] if not b.get('part') and len(b['ring']) >= 6]
    osm_shapes = [Polygon(coordinates(b['ring']), [coordinates(h) for h in b.get('holes', [])]).buffer(0)
                  for b in osm_data]
    roads = [r for r in scene['roads'] if r.get('kind') in STREETS and r.get('name')]
    street_tree = STRtree([LineString(coordinates(r['pts'])) for r in roads]), [r['name'] for r in roads]
    shops = STRtree([Point(x, z) for _, x, z, _ in (
        json.loads(line.strip().rstrip(',')) for line in (ROOT / 'js' / 'ede-shops.js').read_text().splitlines()
        if line.lstrip().startswith('["'))])
    osm = STRtree(osm_shapes), osm_data, osm_shapes
    area = box(*bounds)
    buildings = build_buildings(cityjson_tiles(args.cache, frame, bounds, args.fetch), frame, terrain, area.buffer(4))
    walls = catalogue_walls(buildings, area, neighbourhoods, osm, street_tree, shops)
    print('Play area', len(walls), 'walls', Counter(row['buildingType'] for row in walls))
    source = dict(bagRelease=BAG_RELEASE, bagIndex=BAG_INDEX, neighbourhoods=CBS)
    names = {f['properties']['buurtcode']: f['properties']['buurtnaam'] for f in cbs['features']}
    args.output.write_text(json.dumps(dict(version=1, source=source, neighbourhoodNames=names, walls=walls),
                                      separators=(',', ':')) + '\n')



if __name__ == '__main__':
    main()
