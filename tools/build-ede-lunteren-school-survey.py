#!/usr/bin/env python3
"""Bake the five in-bounds Lunteren primary school exteriors from 3DBAG LoD 2.2."""

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
BAG_API = 'https://api.3dbag.nl/collections/pand/items/NL.IMBAG.Pand.'
# Exact BAG and OSM replacements, map anchors and public viewpoints in scene metres.
SCHOOLS = (
    ('lunteren-de-bron', 'De Bron', 'Postweg', '0228100000070828', 'w271717868',
     (-3712.99, -4440.89), (-3743.8, -4421.8), 3.4, 0x87584d, 0x515553),
    ('lunteren-de-wegwijzer', 'De Wegwijzer', 'Kerkhoflaan', '0228100000065881', 'w271717869',
     (-3543.19, -3852.34), (-3587.8, -3841.1), 3.4, 0x815348, 0x4b5151),
    ('lunteren-de-triangel', 'CNS De Triangel', 'Kerkhoflaan', '0228100000005202', 'w271720279',
     (-3534.49, -3814.08), (-3579.2, -3800.3), 3.1, 0xa4977d, 0x65615a),
    ('lunteren-de-triangel-marterlaan', 'CNS De Triangel · Marterlaan', 'Marterlaan',
     '0228100000021961', 'w271717896', (-3928.12, -4351.54), (-3901.9, -4352.1), 2.0, 0x8f6856, 0x5c625b),
    ('lunteren-nederwoud', 'CBS Nederwoud', 'Kruisbeekweg', '0228100000057010', 'w271591225',
     (-6519.52, -4863.80), (-6535.0, -4881.1), 3.0, 0x826d58, 0x4d504d),
)


def packed(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def render(cache, fetch, frame):
    lines = ['// BAG/3DBAG school footprints and LoD 2.2 surfaces in the Oude Kerk scene frame.',
             '// Sources and refresh are documented in tools/data/ede-lunteren-schools.sources.md.',
             'export const LUNTEREN_SCHOOL_SURVEYS = {']
    sites = []
    for key, name, road, bag, osm, center, approach, focus, wall, roof in SCHOOLS:
        path = CACHE_FILE(cache, f'{bag}.json', BAG_API + bag, fetch)
        payload = json.loads(path.read_bytes())
        if not payload['metadata']['metadata']['referenceSystem'].endswith('/7415'):
            raise ValueError(f'Expected RD New and NAP for {bag}')
        source = {'metadata': payload['metadata'], 'features': [payload['feature']]}
        ground, outline, points, faces = BAKE(source, bag, frame, SCENE_NAP_ORIGIN)
        lines += [f'  {packed(key)}: {{',
                  f'    bagId: {packed(bag)}, osmId: {packed(osm)}, ground: {ground},',
                  f'    wallColor: 0x{wall:06x}, roofColor: 0x{roof:06x},',
                  f'    outline: {packed(outline)},']
        for field, rows in [('points', points), ('faces', faces)]:
            lines.append(f'    {field}: [')
            lines.extend('      ' + ', '.join(map(packed, rows[i:i + 5])) + ','
                         for i in range(0, len(rows), 5))
            lines.append('    ],')
        lines.append('  },')
        x, z = center
        ax, az = approach
        height = round(max(point[1] for point in points) - ground, 2)
        sites.append(dict(id=key, name=name, district='Lunteren', road=road, x=x, z=z, height=height,
                          focusHeight=focus, approach=dict(x=ax, z=az)))
    lines += ['};', '', 'export const EDE_LUNTEREN_SCHOOL_LANDMARKS = [']
    lines.extend(f'  {packed(site)},' for site in sites)
    lines += ['].map(site => {',
              '  const { bagId, osmId, outline } = LUNTEREN_SCHOOL_SURVEYS[site.id];',
              '  const [outer, ...holes] = outline.map(ring => ring.map(([x, z]) => ({ x, z })));',
              '  return { ...site, osmId, bagIds: [bagId], surveyFootprints: [{ outer, holes }],',
              '    worldSpace: true, mapScenic: true };',
              '});', '']
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
    target = ROOT / 'js/ede-lunteren-school-sites.js'
    if args.check:
        if target.read_text() != output:
            raise SystemExit(f'{target.name} differs from the survey bake')
    else:
        target.write_text(output)


if __name__ == '__main__':
    main()
