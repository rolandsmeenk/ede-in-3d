#!/usr/bin/env python3
"""Bake BGT paving around N224 and the rural arrivals, outside the city bake."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import date
import gzip
import json
from pathlib import Path
import runpy

from shapely.geometry import box

from ede_map import ROOT, load_scene_metadata


# Rectangles follow N224 to Planken Wambuis, with separate arrival site surveys.
BOUNDS = [
    (5.700, 52.0437, 5.7175, 52.0520), (5.716, 52.0370, 5.7365, 52.0480),
    (5.734, 52.031, 5.756, 52.041), (5.754, 52.027, 5.772, 52.036),
    (5.770, 52.027, 5.796, 52.034),
    (5.568, 52.041, 5.579, 52.051), (5.641, 52.059, 5.657, 52.069),
    (5.755, 52.057, 5.770, 52.068),
    (5.673, 52.0669, 5.681, 52.0701),  # Jan Hilgersmonument
    (5.734, 52.069, 5.741, 52.0726),  # Uitkijkpunt De Valenberg
]


def fetch(module, directory, day, bounds):
    directory.mkdir(parents=True, exist_ok=True)
    rows = {key: {} for key in module['COLLECTIONS']}
    jobs = [(name, area, day) for area in bounds for name in rows]
    with ThreadPoolExecutor(max_workers=6) as pool:
        for name, features in pool.map(lambda params: module['BGT']['fetch_tile'](*params), jobs):
            for feature in features:
                props = feature['properties']
                rows[name][props['lokaal_id'], props.get('tijdstip_registratie', '')] = feature
    for name, entries in rows.items():
        (directory / f'{name}.geojson').write_text(json.dumps({
            'type': 'FeatureCollection', 'features': [entries[key] for key in sorted(entries)]
        }))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshot', type=Path)
    parser.add_argument('--date', type=date.fromisoformat, required=True)
    parser.add_argument('--fetch', action='store_true')
    parser.add_argument('--north', action='store_true')
    parser.add_argument('--map', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    module = runpy.run_path(str(ROOT / 'tools/build-ede-bgt-roads.py'))
    coverage = json.loads((ROOT / 'tools/data/ede-outer-coverage.json').read_text())
    mapping = args.map or ROOT / 'assets' / ('ede-north-v1.json.gz' if args.north else 'ede-corridors-v1.json.gz')
    output = args.output or ROOT / 'assets' / ('ede-north-paving.json.gz' if args.north else 'ede-corridor-paving.json.gz')
    bounds = coverage['northDetail']['pavingBounds'] if args.north else BOUNDS
    if args.fetch:
        fetch(module, args.snapshot, args.date, bounds)
    base = load_scene_metadata()
    with gzip.open(mapping, 'rt') as file:
        data = json.load(file)
    area = box(*data['bounds']).difference(box(*base['bounds']))
    scene = {'meta': base, 'roads': data['roads']}
    index, surfaces, collections = module['get_snapshot'](args.snapshot, scene, area)
    source = {'url': f"{module['BGT']['API']}/collections?f=html", 'license': 'CC0 1.0',
              'collections': collections}
    tags = {row['id']: row['surface'] for row in data['roads'] if row.get('surface')}
    result = module['build_surfaces'](scene, index, surfaces, tags, source, args.date)
    output.write_bytes(gzip.compress(json.dumps(result, separators=(',', ':'), ensure_ascii=False,
                                                     allow_nan=False).encode(), mtime=0))
    print(f"Corridor paving: {len(result['surfaces'])} BGT surfaces, {len(result['covered'])} covered OSM ways.")


if __name__ == '__main__':
    main()
