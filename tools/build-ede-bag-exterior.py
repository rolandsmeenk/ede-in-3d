#!/usr/bin/env python3
"""Bake whole exterior BAG footprints and gray 3DBAG meshes for Ede.

Requires Fiona, mapbox-earcut, NumPy, Shapely and the pinned Ede GIS environment.
The boundary input is the official EPSG:28992 GM0228 GeoJSON used by build-ede-municipality.py.
Source downloads and intermediate snapshots are cached outside the repository.
"""
import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
import gzip
import hashlib
import json
import math
from pathlib import Path
import re
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import fiona
import mapbox_earcut
import numpy as np
from shapely import box, dwithin, make_valid, prepare, transform, union_all
from shapely.geometry import Point, Polygon, shape
from shapely.geometry.polygon import orient

from ede_gis import Frame, SCENE_NAP_ORIGIN
from ede_map import ROOT, load_scene_metadata

BAG = 'https://api.pdok.nl/kadaster/bag/ogc/v2/collections/pand/items'
CITYJSON = 'https://3dbag.fsn1.your-objectstorage.com/v20250903/'
ACTIVE = {'Pand in gebruik', 'Pand in gebruik (niet ingemeten)', 'Verbouwing pand', 'Pand buiten gebruik',
          'Bouw gestart'}
TILE_SIZE = 512
ID = re.compile(r'(?:NL\.IMBAG\.Pand\.)?([0-9]{16})')


def download(url, attempts=4, timeout=45):
    for attempt in range(attempts):
        try:
            req = Request(url, headers={'User-Agent': 'Ede-in-3D data bake', 'Accept-Encoding': 'gzip'})
            with urlopen(req, timeout=timeout) as response:
                return response.read()
        except OSError:
            if attempt == attempts - 1:
                raise
            time.sleep(2 ** attempt)


def ungzip(data):
    return gzip.decompress(data) if data[:2] == b'\x1f\x8b' else data


def write_gzip(file, data):
    file.write_bytes(gzip.compress(json.dumps(data, separators=(',', ':'), allow_nan=False).encode(), mtime=0))


def fetch_footprints(region, cache):
    minx, miny, maxx, maxy = region.bounds
    step = 2000
    jobs = [(x, y) for x in range(math.floor(minx / step) * step, math.ceil(maxx / step) * step, step)
            for y in range(math.floor(miny / step) * step, math.ceil(maxy / step) * step, step)
            if region.intersects(box(x, y, x + step, y + step))]

    def query(x, y, size):
        bounds = (x, y, x + size, y + size)
        rd = 'http://www.opengis.net/def/crs/EPSG/0/28992'
        url = BAG + '?' + urlencode({
            'bbox': ','.join(map(str, bounds)), 'bbox-crs': rd, 'crs': rd, 'limit': 1000, 'f': 'json',
        })
        result = []
        try:
            while url:
                if not url.startswith(BAG + '?'):
                    raise ValueError('Unexpected BAG pagination URL')
                page = json.loads(ungzip(download(url, attempts=2, timeout=12)))
                for feature in page['features']:
                    props = feature['properties']
                    bag_id = ID.fullmatch(props['identificatie'])
                    if bag_id and props['status'] in ACTIVE and feature['geometry']:
                        result.append([bag_id[1], feature['geometry']])
                url = next((link['href'] for link in page['links'] if link['rel'] == 'next'), None)
        except OSError:
            # Smaller extents recover timeouts in dense cells without dropping any part of the band.
            if size <= 250:
                raise
            half = size // 2
            return [row for u in (x, x + half) for v in (y, y + half)
                    if region.intersects(box(u, v, u + half, v + half)) for row in query(u, v, half)]
        return result

    def read(cell):
        x, y = cell
        path = cache / f'bag-rd-{x}-{y}.json.gz'
        if path.exists():
            return json.loads(gzip.decompress(path.read_bytes()))
        result = query(x, y, step)
        write_gzip(path, result)
        return result

    footprints = {}
    with ThreadPoolExecutor(max_workers=5) as executor:
        for features in executor.map(read, jobs):
            for bag_id, geometry in features:
                footprints[bag_id] = geometry
    print(f'PDOK BAG: {len(jobs)} cells, {len(footprints):,} active footprints in query boxes', flush=True)
    return footprints


def fetch_cityjson(region, cache):
    catalogue = cache / 'tile_index.fgb'
    if not catalogue.exists():
        catalogue.write_bytes(download(CITYJSON + 'tile_index.fgb'))
    with fiona.open(catalogue) as source:
        if source.crs.to_epsg() != 28992:
            raise ValueError('Unexpected 3DBAG tile-index CRS')
        records = [dict(feature['properties']) for feature in source.filter(bbox=region.bounds)
                   if region.intersects(shape(feature['geometry']))]
    records.sort(key=lambda record: record['tile_id'])

    def read(record):
        url = record['cj_download']
        if not url.startswith(CITYJSON + 'tiles/'):
            raise ValueError('Unexpected 3DBAG CityJSON download URL')
        file = cache / url.rsplit('/', 1)[1]
        if not file.exists():
            data = download(url)
            if hashlib.sha256(data).hexdigest() != record['cj_sha256']:
                raise ValueError(f'Checksum mismatch: {url}')
            file.write_bytes(data)
        return file

    with ThreadPoolExecutor(max_workers=6) as executor:
        files = list(executor.map(read, records))
    print(f'3DBAG: {len(files)} CityJSON tiles', flush=True)
    return files


def polygons(geometry):
    if geometry.geom_type == 'Polygon':
        if not geometry.is_empty:
            yield orient(geometry, sign=1)
    elif hasattr(geometry, 'geoms'):
        for part in geometry.geoms:
            yield from polygons(part)


def ownership(footprint, municipality):
    if municipality.covers(footprint):
        return True
    return footprint.intersection(municipality).area >= footprint.area * .5 - footprint.area * 1e-12


def triangle_indices(rings):
    """Project to the most stable plane and preserve the CityJSON surface winding."""
    if not rings or len(rings[0]) < 3 or any(len(ring) < 3 for ring in rings):
        return ()
    points = np.asarray([point for ring in rings for point in ring], dtype=np.float64)
    outer = points[:len(rings[0])] - points[0]
    normal = np.cross(outer, np.roll(outer, -1, axis=0)).sum(axis=0)
    axis = int(np.argmax(np.abs(normal)))
    if abs(normal[axis]) < 1e-8:
        return ()
    flat = np.delete(points, axis, axis=1)
    ends = np.cumsum([len(ring) for ring in rings], dtype=np.uint32)
    triangles = mapbox_earcut.triangulate_float64(flat, ends).reshape(-1, 3)
    a, b, c = flat[triangles[:, 0]], flat[triangles[:, 1]], flat[triangles[:, 2]]
    u, v = b - a, c - a
    sign = -normal[axis] if axis == 1 else normal[axis]
    reverse = (u[:, 0] * v[:, 1] - u[:, 1] * v[:, 0]) * sign < 0
    triangles[reverse] = triangles[reverse][:, [0, 2, 1]]
    return triangles.reshape(-1)


def mesh_for(building, objects, vertices, conversion):
    roof = None
    attributes = building.get('attributes', {})
    source_ground = attributes.get('b3_h_maaiveld')
    roof_height = attributes.get('b3_h_dak_70p')
    if source_ground is not None and roof_height is not None and roof_height > source_ground:
        roof = roof_height - source_ground
    parts = [objects[part] for part in building.get('children', [])]
    # Use the best complete geometry per part, retaining every solid of the BAG feature.
    if not parts:
        return ('height', None, roof, [], [])
    surfaces = []
    levels = []
    projected = {}

    def point(index):
        value = projected.get(index)
        if value is None:
            value = projected[index] = conversion(vertices[index])
        return value

    for part in parts:
        levels_seen = {g['lod']: g for g in part.get('geometry', []) if g['type'] == 'Solid'}
        for level in ('2.2', '1.3', '1.2'):
            geometry = levels_seen.get(level)
            if not geometry:
                continue
            found = []
            semantics = geometry['semantics']
            for shell, labels in zip(geometry['boundaries'], semantics['values'], strict=True):
                for surface, label in zip(shell, labels, strict=True):
                    if label is None:
                        continue
                    kind = semantics['surfaces'][label]['type']
                    rings = [[point(index) for index in ring] for ring in surface]
                    if kind == 'GroundSurface':
                        found.append((0, rings, ()))
                    else:
                        indices = triangle_indices(rings)
                        if len(indices):
                            found.append((2 if kind == 'RoofSurface' else 1, rings, indices))
            if sum(kind == 2 for kind, _, _ in found) and sum(kind == 1 for kind, _, _ in found):
                levels.append(level)
                surfaces.extend(found)
                break
        else:
            return ('height', None, roof, [], [])
    walls, roofs, bases = [], [], []
    for kind, rings, indices in surfaces:
        flat = [point for ring in rings for point in ring]
        if kind == 0:
            bases.extend(flat)
        else:
            target = roofs if kind == 2 else walls
            target.extend(flat[i] for i in indices)
    ground = min((point[1] for point in bases), default=min(p[1] for p in walls))
    return (min(levels), ground, roof, walls, roofs)


def measured_meshes(files, exterior, frame):
    results = {}
    overlaps = {}
    for file in files:
        document = json.loads(ungzip(file.read_bytes()))
        if not document['metadata']['referenceSystem'].endswith('/7415'):
            raise ValueError(f'Unexpected 3DBAG compound CRS: {file}')
        sx, sy, sz = document['transform']['scale']
        tx, ty, tz = document['transform']['translate']
        objects = document['CityObjects']

        def conversion(vertex):
            x, z = frame.rd_to_scene(vertex[0] * sx + tx, vertex[1] * sy + ty)
            return x, vertex[2] * sz + tz - SCENE_NAP_ORIGIN, z

        for key, building in objects.items():
            match = ID.fullmatch(key)
            if not match or match[1] not in exterior:
                continue
            bag_id = match[1]
            # If the BAG geometry was redrawn since the 3DBAG snapshot, seats and roofs
            # can no longer use the old aligned model. The old measured height still applies.
            def outline_ring(indices):
                return [(x, z) for x, _, z in (conversion(document['vertices'][i]) for i in indices)]

            outline = [Polygon(outline_ring(outer), [outline_ring(hole) for hole in holes])
                       for geom in building.get('geometry', []) if geom['lod'] == '0'
                       for outer, *holes in geom['boundaries']]
            old = make_valid(union_all([make_valid(part) for part in outline]))
            current = exterior[bag_id]
            overlap = current.intersection(old).area / max(current.area, old.area, 1e-8)
            if overlap <= overlaps.get(bag_id, -1):
                continue
            mesh = mesh_for(building, objects, document['vertices'], conversion)
            if overlap < .9:
                _, _, roof, walls, roofs = mesh
                if roof is None and walls and roofs:
                    roof = max(p[1] for p in roofs) - min(p[1] for p in walls)
                mesh = ('height', None, roof, [], [])
            results[bag_id] = mesh
            overlaps[bag_id] = overlap
    return results


def flatten_footprint(geometry):
    return [[[round(v, 2) for point in list(ring.coords)[:-1] for v in point]
             for ring in (polygon.exterior, *polygon.interiors)] for polygon in polygons(geometry)]


def ahn_height(footprint, directory, datasets, stack):
    if directory is None:
        return None

    def sample(kind, x, y):
        tile = math.floor(x / 2000) * 2000, math.floor(y / 2000) * 2000
        key = kind, *tile
        if key not in datasets:
            path = directory / f'{kind}-{tile[0]}-{tile[1]}.tif'
            if not path.exists():
                datasets[key] = None
            else:
                import rasterio
                source = stack.enter_context(rasterio.open(path))
                if source.crs.to_epsg() != 28992:
                    raise ValueError(f'Unexpected AHN raster CRS: {path}')
                datasets[key] = source
        source = datasets[key]
        if source is not None:
            value = next(source.sample([(x, y)], masked=True))[0]
            if not np.ma.is_masked(value) and math.isfinite(value):
                return float(value)
        return None

    minx, miny, maxx, maxy = footprint.bounds
    step = max(2, math.ceil(math.sqrt((maxx - minx) * (maxy - miny) / 50)))
    interior = footprint.buffer(-0.8)
    if interior.is_empty:
        interior = footprint
    points = [interior.representative_point()]
    points.extend(point for x in np.arange(minx + step / 2, maxx, step)
                  for y in np.arange(miny + step / 2, maxy, step)
                  if interior.covers(point := Point(x, y)))
    # The bare-earth raster may mask the interior of a building. In that case
    # sample the ground immediately beyond its footprint, leaving the roof sample in place.
    outside = [polygon.exterior for polygon in polygons(footprint.buffer(2.5))]
    surrounding = []
    for ring in outside:
        for fraction in np.arange(0, 1, .125):
            point = ring.interpolate(fraction, normalized=True)
            value = sample('dtm', point.x, point.y)
            if value is not None:
                surrounding.append(value)
    perimeter_ground = float(np.median(surrounding)) if surrounding else None
    heights = []
    for point in points:
        surface = sample('dsm', point.x, point.y)
        ground = sample('dtm', point.x, point.y)
        if ground is None:
            ground = perimeter_ground
        if ground is not None and surface is not None and 1 <= surface - ground <= 100:
            heights.append(surface - ground)
    return round(float(np.percentile(heights, 65)), 2) if heights else None


def build(municipality, footprint_records, cityjson_files, frame, output, ahn=None):
    band = municipality.buffer(500.5, quad_segs=24)
    prepare(band)
    edge = municipality.boundary
    prepare(edge)
    prepare(municipality)
    exterior, ownerships = {}, []
    for bag_id, feature in sorted(footprint_records.items()):
        geometry = make_valid(shape(feature))
        if not geometry.is_empty and not (100000 < geometry.bounds[0] < 250000 and 400000 < geometry.bounds[1] < 500000):
            raise ValueError('PDOK BAG footprint is outside the requested RD coordinate frame')
        if geometry.is_empty or geometry.area <= 0 or not band.intersects(geometry) or not dwithin(municipality, geometry, 500):
            continue
        inside = ownership(geometry, municipality)
        if not inside or edge.intersects(box(*geometry.bounds)):
            ownerships.append([bag_id, inside])
        if not inside:
            exterior[bag_id] = geometry
    assert exterior and any(is_ede for _, is_ede in ownerships) and len(dict(ownerships)) == len(ownerships)

    scene_footprints = {bag_id: transform(geometry, frame.rd_to_scene, interleaved=False)
                        for bag_id, geometry in exterior.items()}
    measured = measured_meshes(cityjson_files, scene_footprints, frame)
    output.mkdir(parents=True, exist_ok=True)
    tiles, tile_bounds, footprints, counts = defaultdict(list), {}, [], Counter()
    with ExitStack() as stack:
        datasets = {}
        for bag_id, geometry in scene_footprints.items():
            footprint = flatten_footprint(geometry)
            minx, minz, maxx, maxz = map(lambda value: round(value, 2), geometry.bounds)
            tx, tz = math.floor((minx + maxx) * .5 / TILE_SIZE), math.floor((minz + maxz) * .5 / TILE_SIZE)
            lod, ground, height, walls, roofs = measured.get(bag_id, ('height', None, None, [], []))
            level = lod
            if lod == 'height':
                level = '3DBAG height'
                if height is None:
                    height = ahn_height(exterior[bag_id], ahn, datasets, stack)
                    level = 'AHN height' if height is not None else 'estimatedHeight'
            counts[level] += 1
            collision_height = max(point[1] - ground for point in roofs) if roofs else height or 3
            footprints.append({'id': bag_id, 'polygons': footprint, 'minX': minx, 'minZ': minz, 'maxX': maxx, 'maxZ': maxz,
                               'height': round(collision_height, 2),
                               'sourceGround': None if ground is None else round(ground, 2)})
            coords = [[round(v * 100) for x, y, z in triangles
                       for v in (x - tx * TILE_SIZE, y - ground, z - tz * TILE_SIZE)] for triangles in (walls, roofs)]
            tiles[tx, tz].append((bag_id, lod, None if ground is None else round(ground, 2),
                                  None if height is None else round(height, 2), *coords))
            bounds = tile_bounds.setdefault((tx, tz), [minx, minz, maxx, maxz])
            bounds[0] = min(bounds[0], minx, *(point[0] for point in walls + roofs))
            bounds[1] = min(bounds[1], minz, *(point[2] for point in walls + roofs))
            bounds[2] = max(bounds[2], maxx, *(point[0] for point in walls + roofs))
            bounds[3] = max(bounds[3], maxz, *(point[2] for point in walls + roofs))
    assert sum(counts.values()) == len(footprints)
    records = []
    for (tx, tz), rows in sorted(tiles.items()):
        path = f'{tx}_{tz}.json.gz'
        write_gzip(output / path, rows)
        records.append([tx * TILE_SIZE, tz * TILE_SIZE, path, [round(v, 2) for v in tile_bounds[tx, tz]]])
    write_gzip(output / 'footprints.json.gz', footprints)
    write_gzip(output / 'ownership.json.gz', ownerships)
    (output / 'index.json').write_text(json.dumps({
        'version': 1, 'tileSize': TILE_SIZE, 'tiles': records, 'counts': counts,
        'sources': {'footprints': BAG, 'geometry': CITYJSON},
    }, separators=(',', ':')) + '\n')
    names = {record[2] for record in records}
    for path in output.glob('*_*.json.gz'):
        if path.name not in names:
            path.unlink()
    print(f'Exterior BAG: {len(exterior):,} IDs in {len(tiles)} tiles; {dict(counts)}; '
          f'{sum(is_ede for _, is_ede in ownerships)} overlapping IDs assigned to Ede')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('boundary', type=Path)
    parser.add_argument('cache', type=Path)
    parser.add_argument('--ahn', type=Path, help='directory of AHN DSM and DTM snapshots for measured roof heights')
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/ede-bag-exterior')
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    frame = Frame(load_scene_metadata()['lonLatAffine'])
    municipality = make_valid(shape(json.loads(args.boundary.read_text())['geometry']))
    # The enclosing search includes chord error in the rounded buffer and
    # footprints crossing the municipal edge. Selection uses exact RD distance.
    search = municipality.buffer(500.5, quad_segs=24).difference(municipality.buffer(-150))
    with ThreadPoolExecutor(max_workers=2) as executor:
        footprint_request = executor.submit(fetch_footprints, search, args.cache)
        city_request = executor.submit(fetch_cityjson, search, args.cache)
        build(municipality, footprint_request.result(), city_request.result(), frame, args.output, args.ahn)


if __name__ == '__main__':
    main()
