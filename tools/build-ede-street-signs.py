#!/usr/bin/env python3
"""Refresh the public Ede sign snapshot, or rebuild projected sign records offline."""

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import gzip
from hashlib import sha256
import json
from math import atan2, degrees, hypot, isfinite
from pathlib import Path
import subprocess
from urllib.parse import urlencode, urljoin

from ede_map import load_scene

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = ROOT / 'tools/data/ede-street-signs.snapshot.json.gz'
NDW = 'https://data.ndw.nu/api/rest/static-road-data/traffic-signs/v5/current-state'
BGT = 'https://api.pdok.nl/kadaster/bgt/ogc/v1/collections/bord/items'
NWB = 'https://api.pdok.nl/rws/nationaal-wegenbestand-wegen/ogc/v1/collections/wegvakken/items'
BGT_KINDS = {'straatnaambord': 'street-name', 'wegwijzer': 'wayfinder'}
ATLAS = ROOT / 'assets/ede-street-sign-faces.json'
NDW_FIELDS = ('rvvCode', 'blackCode', 'bearing', 'placement', 'zoneCode', 'supplementarySigns',
              'conditions', 'roadSectionId', 'drivingDirection', 'fraction', 'nwbVersion',
              'externalReferences', 'missingRoadSection', 'privateProperty')


def scene_metadata():
    return load_scene()['meta']


def build_tiles(bounds):
    south, west, north, east = bounds
    xs = [west + (east - west) * i / 6 for i in range(7)]
    ys = [south + (north - south) * i / 3 for i in range(4)]
    return [(x0, y0, x1, y1) for y0, y1 in zip(ys, ys[1:]) for x0, x1 in zip(xs, xs[1:])]


def query(endpoint, bounds, **options):
    return endpoint + '?' + urlencode(dict(bbox=','.join(f'{value:.12f}' for value in bounds), **options))


def fetch_pages(url):
    seen = set()
    features = []
    while url:
        if url in seen:
            raise ValueError(f'Repeated page: {url}')
        seen.add(url)
        page = json.loads(subprocess.check_output([
            'curl', '-fsSL', '--max-time', '40', '--retry', '2', url,
        ]))
        if page.get('type') != 'FeatureCollection':
            raise ValueError(f'Expected GeoJSON FeatureCollection from {url}')
        features.extend(page['features'])
        following = next((link['href'] for link in page.get('links', ()) if link['rel'] == 'next'), None)
        url = urljoin(url, following) if following else None
    return features


def distinct(features, identify, modified):
    by_id = {}
    for feature in features:
        identity = identify(feature)
        if not identity:
            raise ValueError('Feature has no source identity')
        old = by_id.get(identity)
        if old is None or modified(feature) > modified(old):
            by_id[identity] = feature
    return [by_id[key] for key in sorted(by_id)]


def snapshot(bounds):
    south, west, north, east = bounds
    tiles = build_tiles(bounds)
    urls = [query(NDW, tile, status='PLACED') for tile in tiles]
    with ThreadPoolExecutor(max_workers=8) as pool:
        bgt_fetch = pool.submit(fetch_pages, query(BGT, (west, south, east, north), f='json', limit=1000))
        nwb_fetch = pool.submit(fetch_pages, query(NWB, (west, south, east, north), f='json', limit=1000))
        ndw_features = [feature for tile in pool.map(fetch_pages, urls) for feature in tile]
        bgt_features = bgt_fetch.result()
        nwb_features = nwb_fetch.result()
    if not ndw_features or not bgt_features or not nwb_features:
        raise ValueError('Refusing to save an incomplete traffic-sign snapshot')
    ndw = distinct(ndw_features, lambda f: f['id'], lambda f: (
        f['properties'].get('lastModifiedOn') or '', f['properties'].get('registeredOn') or ''))
    linked_road_ids = {f['properties'].get('roadSectionId') for f in ndw}
    nwb = distinct((f for f in nwb_features if f['properties']['wvk_id'] in linked_road_ids),
                   lambda f: f['properties']['wvk_id'], lambda f: f['properties'].get('wvk_begdat') or '')
    return {
        'retrievedAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'bounds': bounds,
        'sources': {'ndw': NDW, 'bgt': BGT, 'nwb': NWB},
        'ndwTiles': tiles,
        'ndwDuplicates': len(ndw_features) - len(ndw),
        'ndw': ndw,
        'bgt': distinct(bgt_features, lambda f: f['id'], lambda f: f['properties']['tijdstip_registratie']),
        'nwb': nwb,
    }


def project(point, affine):
    dlon = point[0] - affine['lon0']
    dlat = point[1] - affine['lat0']
    return tuple(base + lon * dlon + lat * dlat for base, lon, lat in (affine['x'], affine['z']))


def road_match(point, feature, affine):
    geometry = feature['geometry']
    parts = geometry['coordinates']
    if geometry['type'] == 'LineString':
        parts = [parts]
    elif geometry['type'] != 'MultiLineString':
        raise ValueError(f"Unexpected NWB geometry {geometry['type']}")
    x, z = point
    matches = []
    for part in parts:
        points = [project(coordinate, affine) for coordinate in part]
        for (x0, z0), (x1, z1) in zip(points, points[1:]):
            dx, dz = x1 - x0, z1 - z0
            length2 = dx * dx + dz * dz
            if not length2:
                continue
            t = max(0, min(1, ((x - x0) * dx + (z - z0) * dz) / length2))
            near = x0 + dx * t, z0 + dz * t
            matches.append((hypot(x - near[0], z - near[1]), near, degrees(atan2(dx, -dz)) % 360))
    return min(matches, default=None)


def face_key(record):
    code = record.get('rvvCode', '')
    value = record.get('blackCode', '')
    zone = record.get('zoneCode')
    if zone not in ('BEGIN', 'END', 'REPEAT') or code in ('E10', 'E11'):
        zone = ''
    return ':'.join((code, value, zone)).rstrip(':')


def sign_records(raw, meta):
    if raw['bounds'] != meta['geographicBounds']:
        raise ValueError('Sign snapshot and game have different geographic bounds. Refresh with --fetch.')
    south, west, north, east = raw['bounds']
    min_x, min_z, max_x, max_z = meta['bounds']
    affine = meta['lonLatAffine']
    roads = {feature['properties']['wvk_id']: feature for feature in raw['nwb']}
    signs = []
    for source in ('ndw', 'bgt'):
        features = raw[source]
        if source == 'bgt':
            features = distinct(
                (f for f in features if f['properties']['status'] == 'bestaand'
                 and not f['properties']['termination_date'] and not f['properties']['eind_registratie']
                 and f['properties']['plus_type'] in BGT_KINDS),
                lambda f: f['properties']['lokaal_id'], lambda f: f['properties']['tijdstip_registratie'])
        for feature in features:
            geometry = feature['geometry']
            if geometry['type'] != 'Point':
                raise ValueError(f"Expected a Point for {source} sign {feature['id']}")
            lon, lat = geometry['coordinates'][:2]
            if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                raise ValueError(f"Invalid WGS84 coordinates for {source} sign {feature['id']}")
            if not (west <= lon <= east and south <= lat <= north):
                continue
            x, z = point = project((lon, lat), affine)
            if not (min_x <= x <= max_x and min_z <= z <= max_z):
                continue
            props = feature['properties']
            record = {'id': feature['id'], 'source': source, 'x': round(x, 2), 'z': round(z, 2)}
            if source == 'bgt':
                record.update(id=props['lokaal_id'], kind=BGT_KINDS[props['plus_type']],
                              bgtType=props['plus_type'], layer=props['relatieve_hoogteligging'])
            else:
                record['kind'] = 'traffic'
                record.update({key: props[key] for key in NDW_FIELDS if props.get(key) is not None})
                if 'bearing' in record:
                    bearing = record.pop('bearing')
                    if not isfinite(bearing):
                        raise ValueError(f"Invalid NDW bearing for {feature['id']}")
                    record['sourceBearing'] = bearing
                    # NDW reports the road user's viewing direction, opposite the face normal.
                    record['bearing'] = (bearing + 180) % 360
                road = roads.get(record.get('roadSectionId'))
                if road and (matched := road_match(point, road, affine)):
                    distance, near, forward = matched
                    road_props = road['properties']
                    record.update(roadPoint=[round(v, 2) for v in near], nwbDistance=round(distance, 2),
                                  nwbBearing=round(forward, 2))
                    if road_props.get('stt_naam'):
                        record['roadName'] = road_props['stt_naam']
                    if road_props.get('rel_hoogte') is not None:
                        record['layer'] = road_props['rel_hoogte']
                    direction = record.get('drivingDirection')
                    if direction in ('FORTH', 'BACK'):
                        record['appliesBearing'] = round((forward + (180 if direction == 'BACK' else 0)) % 360, 2)
            signs.append(record)
    if len({(s['source'], s['id']) for s in signs}) != len(signs):
        raise ValueError('Duplicate sign identities in scene')
    return signs


def write(path, contents):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_bytes(contents)
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fetch', action='store_true', help='Refresh the checked-in raw-data snapshot')
    parser.add_argument('--snapshot', type=Path, default=SNAPSHOT)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    meta = scene_metadata()
    if args.fetch:
        raw = snapshot(meta['geographicBounds'])
        write(args.snapshot, gzip.compress(json.dumps(raw, separators=(',', ':'), ensure_ascii=False).encode(), mtime=0))
    else:
        raw = json.loads(gzip.decompress(args.snapshot.read_bytes()))
    signs = sign_records(raw, meta)
    if ATLAS.is_file():
        frames = json.loads(ATLAS.read_bytes())['frames']
        for sign in signs:
            if (key := face_key(sign)) in frames:
                sign['faceKey'] = key
    counts = dict(Counter(sign['kind'] for sign in signs))
    out = {'meta': {key: raw[key] for key in ('retrievedAt', 'bounds', 'sources', 'ndwTiles', 'ndwDuplicates')},
           'signs': signs}
    out['meta'].update(counts=counts, snapshotSha256=sha256(args.snapshot.read_bytes()).hexdigest())
    write(args.output, (json.dumps(out, separators=(',', ':'), ensure_ascii=False) + '\n').encode())
    print(f"Imported {counts} from {len(raw['ndwTiles'])} NDW tiles. {raw['ndwDuplicates']} duplicate NDW IDs.")


if __name__ == '__main__':
    main()
