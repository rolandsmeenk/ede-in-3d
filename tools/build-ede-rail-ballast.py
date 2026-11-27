"""Bake PDOK BGT railway footprints in the game's scene coordinates."""

import gzip
import json
import math
import subprocess
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode

from ede_scene import SceneAffine

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'https://api.pdok.nl/kadaster/bgt/ogc/v1/collections/wegdeel/items'
TILE = 0.015


def fetch(bounds):
    query = urlencode({
        'bbox': ','.join(f'{value:.8f}' for value in bounds),
        'filter': "functie = 'spoorbaan'",
        'filter-lang': 'cql2-text',
        'limit': 1000,
        'f': 'json',
    })
    url, checked = f'{SOURCE}?{query}', set()
    while url:
        if url in checked or not url.startswith(SOURCE + '?'):
            raise ValueError(f'Unexpected PDOK page: {url}')
        checked.add(url)
        page = json.loads(subprocess.check_output([
            'curl', '-fsSL', '--max-time', '20', '--retry', '2', '--retry-max-time', '45', url
        ]))
        yield from page['features']
        url = next((link['href'] for link in page['links'] if link['rel'] == 'next'), None)


def main():
    assets = ROOT / 'assets'
    def read(name):
        return json.loads(gzip.decompress((assets / name).read_bytes()))

    base = read('ede-map-v1.json.gz')
    frame = SceneAffine(base['meta']['lonLatAffine'])
    overlays = [read('ede-corridors-v1.json.gz'), read('ede-north-v1.json.gz')]
    tiles = set()
    for data in [base, *overlays]:
        for rail in data['railways']:
            points = rail['pts']
            coords = [frame.scene_to_lon_lat(x, z) for x, z in zip(points[::2], points[1::2])]
            for (lon, lat), (end_lon, end_lat) in zip(coords, coords[1:]):
                count = max(1, math.ceil(max(abs(end_lon - lon), abs(end_lat - lat)) / (TILE / 2)))
                for i in range(count + 1):
                    tiles.add((math.floor((lon + (end_lon - lon) * i / count) / TILE),
                               math.floor((lat + (end_lat - lat) * i / count) / TILE)))
    bounds = [(x * TILE - 0.001, y * TILE - 0.001, (x + 1) * TILE + 0.001, (y + 1) * TILE + 0.001)
              for x, y in sorted(tiles)]
    print(f'Fetching {len(bounds)} railway tiles from PDOK', flush=True)
    with ThreadPoolExecutor(max_workers=6) as pool:
        pages = list(pool.map(lambda tile: list(fetch(tile)), bounds))

    surfaces = {}
    for feature in (feature for page in pages for feature in page):
        props = feature['properties']
        geometry = feature['geometry']
        if props['functie'] != 'spoorbaan' or props['status'] != 'bestaand' or props.get('in_onderzoek') or not geometry:
            continue
        coords = geometry['coordinates']
        if geometry['type'] == 'Polygon':
            coords = [coords]
        elif geometry['type'] != 'MultiPolygon':
            raise ValueError(f"Unexpected railway geometry: {geometry['type']}")
        key = props['lokaal_id']
        polygons = [
            [[round(v, 2) for lon, lat, *_ in ring for v in frame.lon_lat_to_scene(lon, lat)] for ring in polygon]
            for polygon in coords
        ]
        surfaces[key] = {'id': key, 'layer': int(props['relatieve_hoogteligging']), 'polygons': polygons}
    if not surfaces:
        raise ValueError('No BGT spoorbaan footprints returned')
    result = {'version': 1, 'source': SOURCE, 'date': datetime.now(timezone.utc).date().isoformat(),
              'license': 'CC0-1.0', 'covered': {},
              'surfaces': [surfaces[key] for key in sorted(surfaces)]}
    output = assets / 'ede-rail-ballast.json.gz'
    output.write_bytes(gzip.compress(json.dumps(result, separators=(',', ':')).encode(), mtime=0))
    print(f'{len(surfaces)} BGT railway footprints written to {output.name}')


if __name__ == '__main__':
    main()
