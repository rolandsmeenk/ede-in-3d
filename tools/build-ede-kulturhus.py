#!/usr/bin/env python3
"""Bake the Kulturhus LoD 2.2 shell in the Oude Kerk scene frame."""

import argparse
import json
from pathlib import Path
from runpy import run_path

from shapely.geometry import Point, Polygon

from ede_gis import Frame, SCENE_NAP_ORIGIN
from ede_map import ROOT, load_scene_metadata


BAG = '0228100000075900'
OSM = 'w267687077'
BAKE = run_path(str(ROOT / 'tools/build-ede-estate-survey.py'))['bake']
CACHE_FILE = run_path(str(ROOT / 'tools/build-ede-school-survey.py'))['cached_file']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('--fetch', action='store_true')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    url = f'https://api.3dbag.nl/collections/pand/items/NL.IMBAG.Pand.{BAG}'
    data = json.loads(CACHE_FILE(args.cache, 'kulturhus-city.json', url, args.fetch).read_bytes())
    if not data['metadata']['metadata']['referenceSystem'].endswith('/7415'):
        raise ValueError('Expected RD New with NAP heights')
    frame = Frame(load_scene_metadata()['lonLatAffine'])
    base, outline, points, faces = BAKE({'metadata': data['metadata'], 'features': [data['feature']]},
                                       BAG, frame, SCENE_NAP_ORIGIN)
    polygon = Polygon(outline[0], outline[1:])
    center = (3049.4, -7303.6)
    approach = (3043., -7321.5)
    if not polygon.is_valid or not polygon.contains(Point(center)) or polygon.distance(Point(approach)) < 8:
        raise ValueError('Kulturhus survey and Dorpsplein controls do not agree')
    shell = dict(bagId=BAG, osmId=OSM, ground=base, wallColor=0x825144, roofColor=0x565454,
                 outline=outline, points=points, faces=faces)
    site = dict(id='kulturhus-wekerom', name='Kulturhus Wekerom', district='Wekerom', road='Dorpsplein',
                x=center[0], z=center[1], height=round(max(p[1] for p in points) - base, 2), focusHeight=4.05,
                approach=dict(x=approach[0], z=approach[1]), worldSpace=True, mapScenic=True)

    def compact(value):
        return json.dumps(value, ensure_ascii=False, separators=(',', ':'))

    lines = ['// 3DBAG LoD 2.2 in the Oude Kerk frame. Refresh with tools/build-ede-kulturhus.py.',
             'export const KULTURHUS_SHELL = {',
             *[f'  {key}: {compact(value)},' for key, value in shell.items() if key not in ('points', 'faces')]]
    for key in ('points', 'faces'):
        lines.append(f'  {key}: [')
        values = shell[key]
        lines.extend('    ' + ', '.join(compact(item) for item in values[i:i + 5]) + ','
                     for i in range(0, len(values), 5))
        lines.append('  ],')
    lines += ['};', '', 'const [outer, ...holes] = KULTURHUS_SHELL.outline.map(ring => ring.map(([x, z]) => ({ x, z })));',
              'export const KULTURHUS_SITE = {',
              *[f'  {k}: {compact(v)},' for k, v in site.items()],
              '  osmId: KULTURHUS_SHELL.osmId, bagIds: [KULTURHUS_SHELL.bagId],',
              '  surveyFootprints: [{ outer, holes }],', '};', '']
    output = '\n'.join(lines)
    target = ROOT / 'js/ede-kulturhus-survey.js'
    if args.check:
        if target.read_text() != output:
            raise SystemExit(f'{target.name} differs from the survey bake')
    else:
        target.write_text(output)


if __name__ == '__main__':
    main()
