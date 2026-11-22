#!/usr/bin/env python3
"""Bake Brandweerkazerne Lunteren from the 3DBAG station survey."""

import argparse
import gzip
import json
from pathlib import Path
from runpy import run_path

from ede_gis import Frame
from ede_scene import SCENE_NAP_ORIGIN

ROOT = Path(__file__).resolve().parents[1]
BAG = '0228100000009538'
OSM = 'w271720889'
API = f'https://api.3dbag.nl/collections/pand/items/NL.IMBAG.Pand.{BAG}'


def packed(value):
    return json.dumps(value, separators=(',', ':'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('--fetch', action='store_true')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    cached_file = run_path(str(ROOT / 'tools/build-ede-school-survey.py'))['cached_file']
    survey = json.loads(cached_file(args.cache, f'{BAG}.json', API, args.fetch).read_text())
    if not survey['metadata']['metadata']['referenceSystem'].endswith('/7415'):
        raise ValueError('Expected RD New horizontal coordinates and NAP heights')
    with gzip.open(ROOT / 'assets/ede-map-v1.json.gz') as source:
        frame = Frame(json.load(source)['meta']['lonLatAffine'])
    bake = run_path(str(ROOT / 'tools/build-ede-estate-survey.py'))['bake']
    ground, outline, points, faces = bake(
        {'metadata': survey['metadata'], 'features': [survey['feature']]}, BAG, frame, SCENE_NAP_ORIGIN)
    # The facade uses the wider of the outer faces at the end of the mapped apron.
    front = [points[i] for i in faces[15][1]]
    if (faces[15][0] or min(p[0] for p in front) < -3753 or len(front) != 4):
        raise ValueError('Station frontage changed, review photo alignment')
    height = round(max(p[1] for p in points) - ground, 2)
    lines = [
        '// Surveyed 3DBAG LoD 2.2 shells in the Oude Kerk scene frame.',
        'export const LUNTEREN_FIRE_SURVEY = {',
        f'  ground: {ground}, wallColor: 0x866f61, roofColor: 0x3f4141,',
        f'  outline: {packed(outline)},',
        '  points: [',
        *('    ' + ', '.join(map(packed, points[i:i + 4])) + ',' for i in range(0, len(points), 4)),
        '  ],',
        '  faces: [',
        *('    ' + ', '.join(map(packed, faces[i:i + 4])) + ',' for i in range(0, len(faces), 4)),
        '  ],',
        '};',
        '',
        'export const EDE_LUNTEREN_FIRE_SITE = {',
        "  id: 'brandweerkazerne-lunteren', name: 'Brandweerkazerne Lunteren',",
        "  district: 'Lunteren', road: 'Zilvervoslaan',",
        f"  osmId: '{OSM}', bagIds: ['{BAG}'],",
        f'  x: -3760.56, z: -4310.96, height: {height}, focusHeight: 2.2,',
        '  approach: { x: -3743.8, z: -4311.1 }, worldSpace: true, mapScenic: true,',
        '  surveyFootprints: [{ outer: LUNTEREN_FIRE_SURVEY.outline[0].map(([x, z]) => ({ x, z })), holes: [] }],',
        '};',
        '',
    ]
    output = '\n'.join(lines)
    path = ROOT / 'js/ede-lunteren-fire-sites.js'
    if args.check:
        if path.read_text() != output:
            raise SystemExit(f'{path.name} differs from the survey bake')
    else:
        path.write_text(output)


if __name__ == '__main__':
    main()
