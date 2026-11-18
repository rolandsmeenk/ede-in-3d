#!/usr/bin/env python3
"""Extract the Ede playable area from the official WKD_FIETSSTRK GeoPackage."""

import argparse
import json
import sqlite3
from datetime import date
from pathlib import Path
from runpy import run_path

BOUNDS = (5.5925, 52.012, 5.7005, 52.0605)


def extract(package):
    geometry = run_path(str(Path(__file__).with_name('build-ede-posted-speeds.py')))
    read_linestring, rd_to_lon_lat = geometry['read_linestring'], geometry['rd_to_lon_lat']
    west, south, east, north = BOUNDS
    with sqlite3.connect(package.resolve().as_uri() + '?mode=ro', uri=True) as db:
        rows = db.execute('''
            SELECT t.id, t.geom, t.WVK_ID, t.BEGINDAT, t.FTS_SUG_H, t.FTS_SUG_T
            FROM WKD_FIETSSTRK AS t JOIN rtree_WKD_FIETSSTRK_geom AS r ON t.id = r.id
            WHERE r.maxx >= 168000 AND r.minx <= 178000 AND r.maxy >= 446000 AND r.miny <= 454000
            ORDER BY t.id
        ''')
        for feature_id, blob, way_id, valid_from, forward, reverse in rows:
            if forward not in ('0', '1') or reverse not in ('0', '1'):
                continue
            rd = read_linestring(blob)
            coords = [tuple(round(v, 8) for v in rd_to_lon_lat(x, y)) for x, y in zip(rd[::2], rd[1::2])]
            xs, ys = zip(*coords)
            if max(xs) < west or min(xs) > east or max(ys) < south or min(ys) > north:
                continue
            yield {'type': 'Feature', 'id': feature_id, 'geometry': {'type': 'LineString', 'coordinates': coords},
                   'properties': {'wvk_id': way_id, 'begindat': valid_from, 'fts_sug_h': forward, 'fts_sug_t': reverse}}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('geopackage', type=Path)
    parser.add_argument('release', type=date.fromisoformat)
    parser.add_argument('source')
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    features = list(extract(args.geopackage))
    if not features:
        raise ValueError('No WKD cycle-strip records found in the Ede bounds')
    header = {'type': 'FeatureCollection', 'source': args.source, 'release': args.release.isoformat(),
              'numberMatched': len(features), 'bbox': BOUNDS}

    def encode(value):
        return json.dumps(value, separators=(',', ':'))

    args.output.write_text(encode(header)[:-1] + ',\n"features":[\n' + ',\n'.join(map(encode, features)) + '\n]}\n')
    print(f'WKD cycle strips: {len(features)} records in the Ede bounds')
