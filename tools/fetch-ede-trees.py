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

from ede_map import load_playable_scene, load_scene

PDOK = 'https://api.pdok.nl/kadaster/bgt/ogc/v1/collections/vegetatieobject_punt/items'
EDE_WFS = 'https://geo.ede.nl/geoserver/Ede/wfs'
GELDERLAND = 'https://geoportaal.gelderland.nl/gisserver/rest/services/Overig/Mobiliteit/MapServer/673/query'
RD_NEW = 'http://www.opengis.net/def/crs/EPSG/0/28992'


def fetch_json(url, **parameters):
    if parameters:
        url += '?' + urlencode(parameters)
    raw = subprocess.check_output(['curl', '-fsSL', '--max-time', '20', '--retry', '2', url])
    return json.loads(raw)


def bounds(playable):
    scene = load_playable_scene() if playable else load_scene()
    return tuple(Decimal(str(value)) for value in scene['meta']['geographicBounds'])


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


def fetch_expansion(directory, snapshot_date, playable=False):
    from ede_gis import Frame
    meta = (load_playable_scene() if playable else load_scene())['meta']
    frame = Frame(meta['lonLatAffine'])
    min_x, min_z, max_x, max_z = meta['bounds']
    corners = [frame.scene_to_rd(x, z) for x in (min_x, max_x) for z in (min_z, max_z)]
    es, ns = zip(*corners)
    envelope = [min(es) - 20, min(ns) - 20, max(es) + 20, max(ns) + 20]
    # The WFS coordinates are RD New even when GeoServer labels them EPSG:4326.
    # Read the small municipal extract whole rather than filtering in the wrong CRS.
    municipal = fetch_json(EDE_WFS, service='WFS', request='GetFeature', version='2.0.0',
                           typeNames='Ede:mor_bomen', outputFormat='application/json', count=100000)
    if not municipal.get('features') or len(municipal['features']) != municipal['numberMatched']:
        raise ValueError('Incomplete MOR tree snapshot')
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / f'mor-{snapshot_date}.geojson'
    target.write_text(json.dumps(municipal, separators=(',', ':')) + '\n')
    print(f'{target}: {len(municipal["features"]):,} features', flush=True)

    # ArcGIS applies its page limit to features, but returns the complete ID set.
    inventory = fetch_json(GELDERLAND, f='json', where='1=1',
                           geometry=','.join(f'{value:.3f}' for value in envelope),
                           geometryType='esriGeometryEnvelope', inSR=28992,
                           spatialRel='esriSpatialRelIntersects', returnIdsOnly='true')
    id_field = inventory.get('objectIdFieldName')
    ids = sorted(set(inventory.get('objectIds') or []))
    if not id_field or not ids:
        raise ValueError('No provincial tree IDs for the extraction envelope')
    out_fields = (f'{id_field},boo_id,soortnaam_boom,boomhoogteklasse_actueel,stamdiameterklasse,status,weg,'
                  'bgt_status,relatieve_hoogteligging,jaar_van_aanleg,lastupdate')

    def page(batch):
        data = fetch_json(GELDERLAND, f='json', objectIds=','.join(map(str, batch)), outSR=28992,
                          returnGeometry='true', orderByFields=id_field, outFields=out_fields)
        features = data.get('features') or []
        returned_ids = [feature['attributes'].get(id_field) for feature in features]
        if returned_ids != batch or data.get('exceededTransferLimit'):
            raise ValueError(f'Incomplete provincial tree page starting at {batch[0]}')
        return data

    batches = [ids[start:start + 500] for start in range(0, len(ids), 500)]
    with ThreadPoolExecutor(max_workers=4) as pool:
        pages = list(pool.map(page, batches))
    roadside = {**pages[0], 'features': [feature for page in pages for feature in page['features']]}
    target = directory / f'gelderland-{snapshot_date}.geojson'
    target.write_text(json.dumps(roadside, separators=(',', ':')) + '\n')
    print(f'{target}: {len(roadside["features"]):,} features', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--date', type=date.fromisoformat, required=True)
    parser.add_argument('--expansion-only', action='store_true',
                        help='Fetch the MOR and Gelderland snapshots for the expanded inventory')
    parser.add_argument('--playable', action='store_true', help='Download across the expanded map envelope')
    args = parser.parse_args()
    if args.expansion_only:
        fetch_expansion(args.directory, args.date, args.playable)
        return
    south, west, north, east = bounds(args.playable)
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
