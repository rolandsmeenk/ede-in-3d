#!/usr/bin/env python3
"""Fetch a dated PDOK tree extract and the municipal Ede tree inventory."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from decimal import Decimal
import json
from pathlib import Path
import subprocess
from urllib.parse import urlencode

from ede_map import load_scene

PDOK = 'https://api.pdok.nl/kadaster/bgt/ogc/v1/collections/vegetatieobject_punt/items'
EDE_WFS = 'https://geo.ede.nl/geoserver/Ede/wfs'
RD_NEW = 'http://www.opengis.net/def/crs/EPSG/0/28992'


def fetch_json(url, **parameters):
    if parameters:
        url += '?' + urlencode(parameters)
    raw = subprocess.check_output(['curl', '-fsSL', '--max-time', '20', '--retry', '2', url])
    return json.loads(raw)


def bounds():
    return tuple(Decimal(str(value)) for value in load_scene()['meta']['geographicBounds'])


def fetch_pdok_tile(box, snapshot_date):
    page = fetch_json(PDOK, bbox=box, crs=RD_NEW, datetime=f'{snapshot_date}T00:00:00Z', limit=1000, f='json')
    while True:
        for feature in page['features']:
            props, geometry = feature['properties'], feature['geometry']
            if props.get('plus_type') != 'boom' or props.get('status') != 'bestaand':
                continue
            if geometry['type'] != 'Point' or abs(geometry['coordinates'][0]) < 10000:
                raise ValueError('Expected RD New tree points from PDOK')
            yield {
                'type': 'Feature', 'id': props.get('lokaal_id') or feature['id'],
                'geometry': geometry, 'properties': {'plus_type': 'boom', 'status': 'bestaand'}
            }
        next_page = next((link['href'] for link in page['links'] if link['rel'] == 'next'), None)
        if not next_page:
            return
        page = fetch_json(next_page)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--date', type=date.fromisoformat, required=True)
    args = parser.parse_args()
    south, west, north, east = bounds()
    tiles = 6
    xs = [west + (east - west) * i / tiles for i in range(tiles + 1)]
    ys = [south + (north - south) * i / tiles for i in range(tiles + 1)]
    boxes = [','.join(f'{v:.8f}' for v in (x0, y0, x1, y1))
             for y0, y1 in zip(ys, ys[1:]) for x0, x1 in zip(xs, xs[1:])]
    trees = {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        for batch in pool.map(lambda box: list(fetch_pdok_tile(box, args.date)), boxes):
            trees.update((feature['id'], feature) for feature in batch)
    if not trees:
        raise ValueError('PDOK returned no trees in Ede')

    municipal = fetch_json(EDE_WFS, service='WFS', request='GetFeature', version='2.0.0',
                           typeNames='Ede:monumentale-bomen', outputFormat='application/json',
                           srsName='EPSG:4326', bbox=f'{west},{south},{east},{north},urn:ogc:def:crs:OGC::CRS84')
    if not municipal['features'] or len(municipal['features']) != municipal['numberMatched']:
        raise ValueError('Incomplete municipal Ede tree extract')
    pdok = {
        'type': 'FeatureCollection',
        'crs': {'type': 'name', 'properties': {'name': 'EPSG:28992'}},
        'features': [trees[key] for key in sorted(trees)]
    }
    args.directory.mkdir(parents=True, exist_ok=True)
    for name, snapshot in [('pdok', pdok), ('municipal', municipal)]:
        (args.directory / f'{name}.geojson').write_text(json.dumps(snapshot, ensure_ascii=False, separators=(',', ':')) + '\n')
        print(f'{name}: {len(snapshot["features"]):,} features')


if __name__ == '__main__':
    main()
