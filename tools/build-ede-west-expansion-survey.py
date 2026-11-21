#!/usr/bin/env python3
"""Bake west expansion landmark exteriors from 3DBAG CityJSON."""

import argparse
import gzip
import json
from pathlib import Path
from runpy import run_path

from ede_gis import Frame
from ede_scene import SCENE_NAP_ORIGIN

ROOT = Path(__file__).resolve().parents[1]
CACHE_FILE = run_path(str(ROOT / 'tools/build-ede-school-survey.py'))['cached_file']
BAKE = run_path(str(ROOT / 'tools/build-ede-estate-survey.py'))['bake']
API = 'https://api.3dbag.nl/collections/pand/items/NL.IMBAG.Pand.'

SITES = (
    ('de-klomp-maalderij', 'Maalderij De Klomp · Stationsweg 11', 'De Klomp', 'Stationsweg',
     (-6790.2, -82), (-6739, -49.6), 12, (
         ('mill', '0228100000068887', 'w267690731', (167700, 450923), 0x775549, 0x45494d),
         ('farm', '0228100000014970', 'w267690428', (167810, 450964), 0x805e50, 0xa55f43),
     )),
    ('hervormde-kerk-ederveen', 'Hervormde Kerk Ederveen', 'Ederveen', 'Hoofdweg',
     (-6502.8, -1450), (-6480, -1447), 6, (
         ('church', '0228100000008001', 'w267693544', (167971, 452332), 0x806b60, 0x545655),
     )),
)


def pack(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def bake_building(cache, fetch, frame, entry):
    kind, bag, osm, (expected_e, expected_n), wall, roof = entry
    payload = json.loads(CACHE_FILE(cache, bag, API + bag, fetch).read_bytes())
    # The 3DBAG endpoint serves RD New and NAP. Verify the returned placement
    # against the independent georeferenced BAG footprint before exporting.
    source = {'metadata': payload['metadata'], 'features': [payload['feature']]}
    reference = source['metadata']['metadata']['referenceSystem']
    if not reference.endswith('/7415'):
        raise ValueError(f'Unexpected survey CRS for {bag}: {reference}')
    base, outline, points, faces = BAKE(source, bag, frame, SCENE_NAP_ORIGIN)
    centre_x, centre_z = frame.rd_to_scene(expected_e, expected_n)
    if not (min(p[0] for p in points) <= centre_x <= max(p[0] for p in points)
            and min(p[2] for p in points) <= centre_z <= max(p[2] for p in points)):
        raise ValueError(f'{bag} is outside the BAG footprint control point')
    return {'kind': kind, 'bagId': bag, 'osmId': osm, 'ground': base,
            'wallColor': wall, 'roofColor': roof, 'outline': outline, 'points': points, 'faces': faces}


def render(cache, fetch, frame):
    lines = [
        '// 3DBAG LoD 2.2 exterior shells in the Oude Kerk scene frame.',
        '// Source CRS EPSG:7415. The vertical origin is 22.54 m NAP.',
        '// Rebuild with tools/build-ede-west-expansion-survey.py.',
        'export const WEST_EXPANSION_SURVEYS = {',
    ]
    sites = []
    for key, name, district, road, (x, z), (ax, az), focus, entries in SITES:
        buildings = [bake_building(cache, fetch, frame, entry) for entry in entries]
        lines.append(f'  {pack(key)}: [')
        for record in buildings:
            properties = ('kind', 'bagId', 'osmId', 'ground', 'wallColor', 'roofColor')
            items = ', '.join(f'{field}: {pack(record[field])}' for field in properties)
            lines += [f'    {{ {items},', f'      outline: {pack(record["outline"])},']
            for field, width in (('points', 5), ('faces', 5)):
                values = record[field]
                lines.append(f'      {field}: [')
                lines.extend('        ' + ', '.join(map(pack, values[i:i + width])) + ','
                             for i in range(0, len(values), width))
                lines.append('      ],')
            lines.append('    },')
        height = round(max(max(p[1] for p in b['points']) - b['ground'] for b in buildings), 2)
        sites += [f'  {{ id: {pack(key)}, name: {pack(name)}, district: {pack(district)}, road: {pack(road)},',
                  f'    x: {x}, z: {z}, height: {height}, focusHeight: {focus}, approach: {{ x: {ax}, z: {az} }} }},']
        lines.append('  ],')
    lines += ['};', '', 'export const EDE_WEST_EXPANSION_LANDMARKS = [', *sites, '].map(site => {',
              '  const buildings = WEST_EXPANSION_SURVEYS[site.id];', '  return {',
              '    ...site, worldSpace: true, mapScenic: true, osmId: buildings[0].osmId,',
              '    annexOsmIds: buildings.slice(1).map(building => building.osmId),',
              '    bagIds: buildings.map(building => building.bagId),',
              '    surveyFootprints: buildings.map(({ outline }) => {',
              '      const [outer, ...holes] = outline.map(ring => ring.map(([x, z]) => ({ x, z })));',
              '      return { outer, holes };',
              '    }),', '  };', '});', '']
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('--fetch', action='store_true')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    with gzip.open(ROOT / 'assets/ede-map-v1.json.gz') as snapshot:
        frame = Frame(json.load(snapshot)['meta']['lonLatAffine'])
    output = render(args.cache, args.fetch, frame)
    target = ROOT / 'js/ede-west-expansion-surveys.js'
    if args.check:
        if target.read_text() != output:
            raise SystemExit(f'{target.name} differs from the survey bake')
    else:
        target.write_text(output)


if __name__ == '__main__':
    main()
