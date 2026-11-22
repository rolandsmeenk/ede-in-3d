#!/usr/bin/env python3
"""Bake the central Ede apartment landmarks from 3DBAG LoD 2.2."""

import argparse
from pathlib import Path
from runpy import run_path

from ede_gis import Frame

ROOT = Path(__file__).resolve().parents[1]
SKYLINE = run_path(str(ROOT / 'tools/build-ede-skyline-survey.py'))
# Public approaches are Museumplein, De Halte, the Kleefsehoek cycle path and Noordplein.
SITES = [
    ('de-griek', 'De Griek', 'Centrum', 'Museumplein', (-214.58, 300.04), 11.0, [
        ('0228100000019061', 'w271573184'),
    ]),
    ('de-halte-gelria', 'De Halte · Gelria', 'Centrum', 'De Halte', (-193.2, 421.0), 13.0, [
        ('0228100000043988', 'w271573593'),
    ]),
    ('kleefsehof', 'De Kleefsehof', 'Centrum-Noord', 'Kleefsehoek', (171.88, -493.54), 6.0, [
        ('0228100000019138', 'w271603190'), ('0228100000007949', 'w271603321'),
        ('0228100000061035', 'w271603371'),
    ]),
    ('de-witte-hinde', 'De Witte Hinde', 'Stationsgebied', 'Stationsweg', (19.8, 1911.9), 9.0, [
        ('0228100000068966', 'w271515175'),
    ]),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('--fetch', action='store_true')
    parser.add_argument('--output', type=Path, default=ROOT / 'js/ede-centre-skyline-survey.js')
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    frame = Frame(SKYLINE['load_map']('ede-map-v1.json.gz')['meta']['lonLatAffine'])
    pack, shell, bounds = (SKYLINE[name] for name in ('compact', 'shell', 'bounds'))
    sites = []
    lines = ['// © 3DBAG by tudelft3d and 3DGI, adapted under CC BY 4.0. https://docs.3dbag.nl/en/copyright/',
             '// Surveyed LoD 2.2 geometry measured in Oude Kerk scene metres.',
             '// Rebuild with tools/build-ede-centre-skyline-survey.py.', 'export const CENTRE_SKYLINE_SHELLS = {']
    for key, name, district, road, (ax, az), focus, sources in SITES:
        parts = [shell(bag, args.cache, args.fetch, frame) for bag, _ in sources]
        low_x, low_z, high_x, high_z = bounds(parts[0]['outline'][0])
        height = max(max(p[1] for p in part['points']) - part['ground'] for part in parts)
        sites.append(dict(id=key, name=name, district=district, road=road,
                          x=round((low_x + high_x) / 2, 2), z=round((low_z + high_z) / 2, 2),
                          height=round(height, 2), focusHeight=focus, approach=dict(x=ax, z=az),
                          osmId=sources[0][1], annexOsmIds=[osm for _, osm in sources[1:]],
                          bagIds=[bag for bag, _ in sources]))
        lines.append(f"  '{key}': [")
        for part in parts:
            lines.append('    {')
            for prop, value in part.items():
                if prop in {'points', 'faces'}:
                    lines.append(f'      {prop}: [')
                    lines.extend('        ' + ', '.join(map(pack, value[i:i + 6])) + ',' for i in range(0, len(value), 6))
                    lines.append('      ],')
                else:
                    lines.append(f'      {prop}: {pack(value)},')
            lines.append('    },')
        lines.append('  ],')
    lines.extend(['};', '', 'export const EDE_CENTRE_SKYLINE_LANDMARKS = [', *('  ' + pack(site) + ',' for site in sites),
                  '].map(site => ({', '  ...site, worldSpace: true, mapScenic: true,',
                  '  surveyFootprints: CENTRE_SKYLINE_SHELLS[site.id].map(({ outline: [outer, ...holes] }) => ({',
                  '    outer: outer.map(([x, z]) => ({ x, z })),', '    holes: holes.map(ring => ring.map(([x, z]) => ({ x, z }))),',
                  '  })),', '}));'])
    args.output.write_text('\n'.join(lines) + '\n')


if __name__ == '__main__':
    main()
