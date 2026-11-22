#!/usr/bin/env python3
"""Cache the northern OSM strip as the same geometry records consumed by the Ede map bake."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import math
from pathlib import Path
from time import sleep
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
API = 'https://api.openstreetmap.org/api/0.6/map.json'
USER_AGENT = 'Ede-in-3D/1.0 (https://github.com/rolandsmeenk/ede-in-3d)'


def request_tile(cache, bounds, offline, depth=0):
    bbox = ','.join(f'{v:.6f}' for v in bounds)
    file = cache / f'osm-{bbox}.json'
    if file.is_file():
        return json.loads(file.read_bytes())['elements']
    if not offline:
        for attempt in range(3):
            try:
                with urlopen(Request(f'{API}?bbox={bbox}', headers={'User-Agent': USER_AGENT}), timeout=60) as response:
                    raw = response.read()
                parsed = json.loads(raw)
                if not isinstance(parsed.get('elements'), list):
                    raise ValueError(f'Incomplete OSM tile {bbox}')
                file.write_bytes(raw)
                return parsed['elements']
            except HTTPError as error:
                if error.code in {400, 509} and depth < 2:
                    break
                if error.code < 500 and error.code != 429 or attempt == 2:
                    raise
            except (URLError, TimeoutError):
                if attempt == 2:
                    raise
            sleep(2 ** attempt)
    # Oversized OSM API boxes are split at their centre.
    if depth >= 2:
        raise FileNotFoundError(file)
    w, s, e, n = bounds
    x, y = (w + e) / 2, (s + n) / 2
    return [row for child in ((w, s, x, y), (x, s, e, y), (w, y, x, n), (x, y, e, n))
            for row in request_tile(cache, child, offline, depth + 1)]


def wanted(tags):
    return (any(key in tags for key in ('building', 'building:part', 'highway', 'waterway', 'historic', 'barrier'))
            or tags.get('railway') in {'rail', 'light_rail', 'tram', 'level_crossing', 'crossing', 'switch'}
            or tags.get('natural') in {'water', 'wood', 'heath', 'sand', 'scrub', 'grassland', 'bare_rock', 'tree'}
            or tags.get('landuse') in {'grass', 'recreation_ground', 'cemetery', 'village_green', 'forest'}
            or tags.get('leisure') in {'park', 'garden', 'playground', 'pitch', 'nature_reserve'}
            or tags.get('boundary') == 'protected_area' or tags.get('place') == 'square'
            or tags.get('tourism') in {'viewpoint', 'museum', 'attraction'}
            or tags.get('amenity') in {'parking', 'cafe', 'restaurant', 'fast_food', 'bank', 'pharmacy'}
            or 'shop' in tags)


def compact(rows):
    nodes = {row['id']: row for row in rows if row['type'] == 'node'}
    ways = {row['id']: row for row in rows if row['type'] == 'way'}

    def geometry(ids):
        if not all(identity in nodes for identity in ids):
            return None
        return [{key: nodes[identity][key] for key in ('lon', 'lat')} for identity in ids]

    result = []
    for row in rows:
        tags = row.get('tags', {})
        if not wanted(tags):
            continue
        kind = row['type']
        feature = {key: row[key] for key in ('type', 'id', 'tags')}
        if kind == 'node':
            feature.update(lat=row['lat'], lon=row['lon'])
        elif kind == 'way':
            points = geometry(row['nodes'])
            if points is None:
                raise ValueError(f"Missing OSM way nodes for {row['id']}")
            feature.update(nodes=row['nodes'], geometry=points)
        else:
            if tags.get('type') not in ('multipolygon', 'boundary'):
                continue
            members = []
            for member in row['members']:
                way = ways.get(member['ref']) if member['type'] == 'way' else None
                if way is None:
                    continue
                points = geometry(way['nodes'])
                if points is not None:
                    members.append({**member, 'geometry': points})
            if not members:
                continue
            feature['members'] = members
        result.append(feature)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('--offline', action='store_true')
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    coverage = json.loads((ROOT / 'tools/data/ede-outer-coverage.json').read_text())
    _, west, north, east = coverage['geographicBounds']
    south = coverage['previousNorth'] - 0.010
    north += 0.003
    cols, rows = math.ceil((east - west) / 0.024), math.ceil((north - south) / 0.016)
    x = [west + (east - west) * i / cols for i in range(cols + 1)]
    y = [south + (north - south) * i / rows for i in range(rows + 1)]
    boxes = [(x[i], y[j], x[i + 1], y[j + 1]) for j in range(rows) for i in range(cols)]
    merged = {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        for index, page in enumerate(pool.map(lambda box: request_tile(args.cache, box, args.offline), boxes), 1):
            for row in page:
                key = row['type'], row['id']
                if key not in merged or merged[key].get('version', 0) < row.get('version', 0):
                    merged[key] = row
            print(f'OSM {index}/{len(boxes)}: {len(page)} records', flush=True)
    features = compact(merged.values())
    timestamp = max(row.get('timestamp', '') for row in merged.values())
    (args.cache / 'osm-north.json').write_text(json.dumps({
        'osm3s': {'timestamp_osm_base': timestamp, 'copyright': '© OpenStreetMap contributors, ODbL 1.0'},
        'elements': features,
    }, separators=(',', ':'), ensure_ascii=False))
    print(f'{len(features)} northern OSM features from {len(merged)} records')


if __name__ == '__main__':
    main()
