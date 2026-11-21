#!/usr/bin/env python3
"""Bake surveyed shells for Oranjestaete and Villa Sterrenberg."""

import argparse
import gzip
import json
from pathlib import Path
import runpy
from urllib.request import urlopen

from ede_gis import Frame, SCENE_NAP_ORIGIN

ROOT = Path(__file__).resolve().parents[1]
survey = runpy.run_path(str(ROOT / 'tools/build-ede-public-survey.py'))['survey']
SITES = {
    'oranjestaete': ('0228100000020191', 0xaea89a, 0x686867),
    'villa-sterrenberg': ('0228100000020466', 0xe2ddd0, 0x524747),
}


SITE_REGISTRY = '''export const EDE_VILLA_HERITAGE_LANDMARKS = [
  { id: 'oranjestaete', name: 'Oranjestaete', district: 'Stationsgebied', road: 'Oude Bennekomseweg',
    osmId: 'w271377156', bagIds: ['0228100000020191'], x: 37.8, z: 2221, height: 20.02,
    worldSpace: true, approach: { x: 15.5, z: 2249 } },
  { id: 'villa-sterrenberg', name: 'Villa Sterrenberg', district: 'Centrum', road: 'Bergstraat',
    osmId: 'w271603284', bagIds: ['0228100000020466'], x: 272, z: -80, height: 14.61,
    worldSpace: true, approach: { x: 254.9, z: -46.3 } },
];'''


def compact(data):
    return json.dumps(data, separators=(',', ':'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('--fetch', action='store_true')
    parser.add_argument('--output', type=Path, default=ROOT / 'js/ede-villa-heritage-survey.js')
    args = parser.parse_args()
    with gzip.open(ROOT / 'assets/ede-map-v1.json.gz') as source:
        frame = Frame(json.load(source)['meta']['lonLatAffine'])

    lines = [
        '// 3DBAG LoD 2.2 by tudelft3d and 3DGI, CC BY 4.0. https://docs.3dbag.nl/en/copyright/',
        f'// Ede scene metres, Y relative to {SCENE_NAP_ORIGIN} m NAP. Faces are 0 walls and 1 roofs.',
        SITE_REGISTRY,
        '',
        'export const VILLA_HERITAGE_SURVEYS = {',
    ]
    for key, (bag, wall, roof) in SITES.items():
        path = args.cache / f'{bag}.json'
        if args.fetch and not path.exists():
            args.cache.mkdir(parents=True, exist_ok=True)
            url = f'https://api.3dbag.nl/collections/pand/items/NL.IMBAG.Pand.{bag}'
            with urlopen(url, timeout=30) as response:
                path.write_bytes(response.read())
        raw = json.loads(path.read_text())
        points, faces, outline = survey({**raw, 'features': [raw['feature']]}, bag, frame)
        ground = min(point[1] for point in points)
        lines += [
            f'  "{key}": {{ ground: {ground}, wallColor: {wall:#08x}, roofColor: {roof:#08x},',
            f'    outline: {compact(outline)},',
            '    points: [',
            *['      ' + ', '.join(map(compact, points[i:i+5])) + ',' for i in range(0, len(points), 5)],
            '    ],',
            '    faces: [',
            *['      ' + ', '.join(map(compact, faces[i:i+4])) + ',' for i in range(0, len(faces), 4)],
            '    ],',
            '  },',
        ]
    args.output.write_text('\n'.join([*lines, '};', '']), encoding='utf-8')


if __name__ == '__main__':
    main()
