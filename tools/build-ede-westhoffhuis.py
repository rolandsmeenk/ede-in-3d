#!/usr/bin/env python3
"""Bake the Westhoffhuis shell from a cached 3DBAG CityJSON response."""

import argparse
import gzip
import json
from pathlib import Path
from runpy import run_path
from urllib.request import urlopen

from ede_gis import Frame
from ede_scene import SCENE_NAP_ORIGIN

ROOT = Path(__file__).resolve().parents[1]
BAG = '0228100000075047'
URL = f'https://api.3dbag.nl/collections/pand/items/NL.IMBAG.Pand.{BAG}'
BAKE = run_path(str(ROOT / 'tools/build-ede-estate-survey.py'))['bake']


def render(path):
    payload = json.loads(path.read_bytes())
    if not payload['metadata']['metadata']['referenceSystem'].endswith('/7415'):
        raise ValueError('Westhoffhuis survey requires RD New with NAP heights')
    with gzip.open(ROOT / 'assets/ede-map-v1.json.gz') as source:
        frame = Frame(json.load(source)['meta']['lonLatAffine'])
    source = {'metadata': payload['metadata'], 'features': [payload['feature']]}
    ground, outline, points, faces = BAKE(source, BAG, frame, SCENE_NAP_ORIGIN)

    def packed(value):
        return json.dumps(value, separators=(',', ':'))

    lines = [
        '// Westhoffhuis with its BAG / 3DBAG roof shell in Oude Kerk scene metres.',
        '// Refresh with tools/build-ede-westhoffhuis.py.',
        'export const WESTHOFFHUIS_SURVEY = {',
        f"  bagId: '{BAG}', osmId: 'w271720127', ground: {ground},",
        '  wallColor: 0x985c50, roofColor: 0x55585c,',
        f'  outline: {packed(outline)},',
    ]
    for field, rows in [('points', points), ('faces', faces)]:
        lines.append(f'  {field}: [')
        lines.extend('    ' + ', '.join(map(packed, rows[i:i + 5])) + ','
                     for i in range(0, len(rows), 5))
        lines.append('  ],')
    height = round(max(point[1] for point in points) - ground, 2)
    return '\n'.join(lines + [
        '};', '',
        'const [outer, ...holes] = WESTHOFFHUIS_SURVEY.outline.map(ring => ring.map(([x, z]) => ({ x, z })));',
        'export const EDE_WESTHOFFHUIS_LANDMARK = {',
        "  id: 'westhoffhuis', name: 'Westhoffhuis · Cultura Lunteren', district: 'Lunteren', road: 'Dorpsstraat',",
        f'  x: -3333.0, z: -4151.0, height: {height}, focusHeight: 4.2,',
        '  approach: { x: -3362.9, z: -4156.2 },',
        '  osmId: WESTHOFFHUIS_SURVEY.osmId, bagIds: [WESTHOFFHUIS_SURVEY.bagId],',
        '  surveyFootprints: [{ outer, holes }], worldSpace: true, mapScenic: true,',
        '};', '',
    ])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('--fetch', action='store_true')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    path = args.cache / 'westhoff-city.json'
    if args.fetch and not path.exists():
        args.cache.mkdir(parents=True, exist_ok=True)
        with urlopen(URL, timeout=45) as response:
            path.write_bytes(response.read())
    generated = render(path)
    destination = ROOT / 'js/ede-westhoffhuis-survey.js'
    if args.check:
        if destination.read_text() != generated:
            raise SystemExit(f'{destination.name} differs from the survey bake')
    else:
        destination.write_text(generated)


if __name__ == '__main__':
    main()
