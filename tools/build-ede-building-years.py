#!/usr/bin/env python3
"""Match PDOK BAG construction years to the checked-in Ede footprints."""

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import gzip
import json
from pathlib import Path
import time
from urllib.parse import urlencode, urlsplit
from urllib.request import urlopen

from shapely import STRtree, make_valid, transform
from shapely.geometry import Polygon, shape

from ede_map import ROOT, load_scene
from ede_scene import SceneAffine


PAND = 'https://api.pdok.nl/kadaster/bag/ogc/v2/collections/pand/items'
ACTIVE = {'Pand in gebruik', 'Pand in gebruik (niet ingemeten)', 'Verbouwing pand', 'Pand buiten gebruik'}


def download(bounds):
    url = PAND + '?' + urlencode({'bbox': ','.join(map(str, bounds)), 'limit': 1000, 'f': 'json'})
    result = {}
    while url:
        if urlsplit(url)._replace(query='').geturl() != PAND:
            raise ValueError('Unexpected BAG pagination URL')
        for attempt in range(3):
            try:
                with urlopen(url, timeout=35) as response:
                    page = json.load(response)
                break
            except OSError:
                if attempt == 2:
                    raise
                time.sleep(2 ** attempt)
        for feature in page['features']:
            props = feature['properties']
            year = props.get('bouwjaar')
            if props['status'] in ACTIVE and feature['geometry'] and isinstance(year, int) and 1000 <= year < 2100:
                result[props['identificatie']] = (year, feature['geometry'])
        url = next((link['href'] for link in page['links'] if link['rel'] == 'next'), None)
    return result


def source_rows(scene):
    min_x, min_z, max_x, max_z = scene['meta']['bounds']
    frame = SceneAffine(scene['meta']['lonLatAffine'])
    west, south, east, north = frame.geographic_bounds((min_x - 50, min_z - 50, max_x + 50, max_z + 50))
    lon = [west + i * (east - west) / 6 for i in range(7)]
    lat = [south + i * (north - south) / 5 for i in range(6)]
    boxes = [(w, s, e, n) for w, e in zip(lon, lon[1:]) for s, n in zip(lat, lat[1:])]
    with ThreadPoolExecutor(max_workers=6) as workers:
        rows = {}
        for page in workers.map(download, boxes):
            rows.update(page)
        return rows


def ordered_ids(buildings):
    checksum = 2166136261
    for building in buildings:
        for byte in (building['id'] + '\n').encode('ascii'):
            checksum = ((checksum ^ byte) * 16777619) & 0xffffffff
    return checksum


def periods(scene, rows):
    project = SceneAffine(scene['meta']['lonLatAffine']).lon_lat_to_scene

    candidates = [(year, make_valid(transform(shape(geometry), project, interleaved=False)))
                  for year, geometry in rows.values()]
    polygons = [polygon for _, polygon in candidates]
    tree = STRtree(polygons)
    years = []
    for building in scene['buildings']:
        rings = [building['ring'], *building['holes']]
        outer, *holes = [list(zip(ring[::2], ring[1::2])) for ring in rings]
        polygon = make_valid(Polygon(outer, holes))
        result = 0
        area = polygon.area
        if area > 0:
            votes = Counter()
            for index in tree.query(polygon, predicate='intersects'):
                year, footprint = candidates[index]
                votes[year] += footprint.intersection(polygon).area
            if votes:
                year, overlap = votes.most_common(1)[0]
                if overlap >= 0.55 * area:
                    result = year
        years.append(result)
    return years


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path, help='JSON file for the downloaded BAG snapshot')
    parser.add_argument('--fetch', action='store_true', help='refresh the BAG snapshot before building')
    args = parser.parse_args()
    scene = load_scene(include_shorelines=False)
    if args.fetch:
        rows = source_rows(scene)
        args.cache.write_text(json.dumps(rows, separators=(',', ':')))
    else:
        rows = json.loads(args.cache.read_text())
    if not rows:
        raise ValueError('Empty BAG snapshot')
    years = periods(scene, rows)
    payload = {'version': 1, 'orderedIds': ordered_ids(scene['buildings']), 'years': years}
    content = json.dumps(payload, separators=(',', ':')).encode()
    output = ROOT / 'assets' / 'ede-building-years.json.gz'
    output.write_bytes(gzip.compress(content, mtime=0))
    print(f'Matched {sum(bool(year) for year in years):,} of {len(years):,} map footprints to {len(rows):,} active BAG buildings.')
    print(f'{output.name}: {output.stat().st_size:,} bytes')


if __name__ == '__main__':
    main()
