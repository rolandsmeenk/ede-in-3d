#!/usr/bin/env python3
"""Bake the Parkveste and Akulaan apartment shells from the pinned 3DBAG archive."""

import argparse
import gzip
import json
from pathlib import Path
import runpy
import struct

from ede_gis import Frame

ROOT = Path(__file__).resolve().parents[1]
ESTATE_BAKE = runpy.run_path(str(ROOT / 'tools/build-ede-estate-survey.py'))
SITES = {
    'parkveste': ('9-640-564', '0228100000082617', 0x897657, 0x514e47),
    'h2': ('9-644-564', '0228100000086250', 0x857562, 0x51524f),
    'h4': ('9-644-564', '0228100000086249', 0x91816f, 0x5c5b53),
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path, help='v20250903 3DBAG CityJSON cache')
    parser.add_argument('--output', type=Path, default=ROOT / 'js/ede-rail-apartment-surveys.js')
    args = parser.parse_args()

    with gzip.open(ROOT / 'assets/ede-map-v1.json.gz') as source:
        frame = Frame(json.load(source)['meta']['lonLatAffine'])
    datum = round(struct.unpack_from('<f', (ROOT / 'assets/ede-ahn.bin').read_bytes(), 24)[0], 2)
    lines = ['// 3DBAG v2025.09.03 LoD 2.2 in the Oude Kerk scene frame. Y is NAP minus 22.54 m.',
             'export const RAIL_APARTMENT_SURVEYS = {']
    documents = {}
    def compact(value):
        return json.dumps(value, separators=(',', ':'))
    for name, (tile, bag, wall, roof) in SITES.items():
        if tile not in documents:
            with gzip.open(args.cache / f'{tile}.city.json.gz') as source:
                documents[tile] = json.load(source)
            metadata = documents[tile]['metadata']
            if metadata['version'] != 'v2025.09.03' or not metadata['referenceSystem'].endswith('/7415'):
                raise ValueError(f'Unexpected CRS or release for {tile}')
        doc = documents[tile]
        source = {'metadata': {'transform': doc['transform']},
                  'features': [{'id': 'NL.IMBAG.Pand.' + bag, 'CityObjects': doc['CityObjects'],
                                'vertices': doc['vertices']}]}
        ground, _, points, faces = ESTATE_BAKE['bake'](source, bag, frame, datum)
        # Use the solid's ground rings for collision. LoD 0 also includes the Akulaan garage apron.
        city = doc['CityObjects']
        building = city['NL.IMBAG.Pand.' + bag]
        grounds = [rings for child in building['children'] for geometry in city[child]['geometry']
                   if geometry['lod'] == '2.2'
                   for kind, rings in ESTATE_BAKE['shell_faces'](geometry) if kind == 'GroundSurface']
        if len(grounds) != 1:
            raise ValueError(f'Expected one ground surface for {bag}')
        sx, sz, _ = doc['transform']['scale']
        tx, tz, _ = doc['transform']['translate']
        outline = [[tuple(round(v, 2) for v in frame.rd_to_scene(
            doc['vertices'][index][0] * sx + tx, doc['vertices'][index][1] * sz + tz))
            for index in ring] for ring in grounds[0]]
        lines += [f'  {name}: {{ ground: {ground}, wallColor: {wall:#08x}, roofColor: {roof:#08x},',
                  f'    outline: {compact(outline)},', '    points: [']
        lines += ['      ' + ', '.join(map(compact, points[i:i + 6])) + ',' for i in range(0, len(points), 6)]
        lines += ['    ],', '    faces: [', *[f'      {compact(face)},' for face in faces], '    ],', '  },']
        print(name, bag, len(points), len(faces), ground,
              min(p[0] for p in points), max(p[0] for p in points), min(p[2] for p in points), max(p[2] for p in points),
              'top', max(p[1] for p in points))
    args.output.write_text('\n'.join([*lines, '};']) + '\n')


if __name__ == '__main__':
    main()
