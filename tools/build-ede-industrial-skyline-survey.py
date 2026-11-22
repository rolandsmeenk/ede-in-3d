#!/usr/bin/env python3
"""Bake the NIZO and Peti extensions and the built Victoria Vesta/Veste pair."""

import argparse
import json
from pathlib import Path
from runpy import run_path

from ede_gis import Frame

ROOT = Path(__file__).resolve().parents[1]
SKYLINE = run_path(str(ROOT / 'tools/build-ede-skyline-survey.py'))
shell, load_map, compact = (SKYLINE[key] for key in ('shell', 'load_map', 'compact'))

BUILDINGS = {
    'nizo-north': [('0228100000018156', 'w271586840')],
    'peti-protein': [('0228100000085782', 'w881326370')],
    'victoria-vesta': [('0228100000008709', 'w1074318792'), ('0228100000068581', 'w1074318791')],
    'victoria-veste': [('0228100000088327', 'w1348529488')],
}
SITES = {
    'nizo-north': ('NIZO · North production block', 'Kernhem', 'Kernhemseweg', (-638, -630)),
    'peti-protein': ('Peti Protein', 'De Klomp', 'Veredelingstraat', (-6125, 339)),
    'victoria-vesta': ('Victoria Vesta · Former offices', 'Veldhuizen', 'Victoriastein', (-1699.8, 617.7)),
    'victoria-veste': ('Victoria Veste · Proosdijpark', 'Veldhuizen', 'Proosdijpark', (-1843.5, 669.2)),
}


def built_veste(part):
    # The 2022 heights predate construction. The BAG plan includes a 100 m garage.
    # Fit the above-grade block to the west rectangle, with the penthouse setbacks
    # from Hoekstra's ninth-floor plan and the engineer's published 30 m height.
    ground = part['ground']
    outline = [[-1811.82, 674.54], [-1802.90, 696.07], [-1768.95, 681.91], [-1777.88, 660.37]]

    def inset(a, b, t):
        return [round(x + (end - x) * t, 2) for x, end in zip(a, b)]

    a, b, c, d = outline
    penthouse = [inset(a, d, .16), inset(b, c, .16), inset(c, b, .16), inset(d, a, .16)]
    points = [[x, round(ground + elevation, 2), z]
              for ring, elevation in [(outline, 0), (outline, 27.1), (penthouse, 27.1), (penthouse, 30)]
              for x, z in ring]
    faces = [[0, [j + i, j + (i + 1) % 4, j + (i + 1) % 4 + 4, j + i + 4]]
             for j in (0, 8) for i in range(4)]
    faces += [[1, [4, 5, 6, 7], [11, 10, 9, 8]], [1, [12, 13, 14, 15]]]
    return dict(ground=ground, outline=[outline], parcelOutline=part['outline'], points=points, faces=faces)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('--fetch', action='store_true')
    parser.add_argument('--output', type=Path, default=ROOT / 'js/ede-industrial-skyline-survey.js')
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    frame = Frame(load_map('ede-map-v1.json.gz')['meta']['lonLatAffine'])
    lines = [
        '// © 3DBAG by tudelft3d and 3DGI, adapted under CC BY 4.0. https://docs.3dbag.nl/en/copyright/',
        '// Rebuild with tools/build-ede-industrial-skyline-survey.py.',
        'export const INDUSTRIAL_SKYLINE_SHELLS = {',
    ]
    sites = []
    for key, sources in BUILDINGS.items():
        parts = [shell(bag, args.cache, args.fetch, frame) for bag, _ in sources]
        if key == 'victoria-veste':
            parts[0] = built_veste(parts[0])
        name, district, road, (ax, az) = SITES[key]
        xs, zs = zip(*parts[0]['outline'][0])
        height = max(max(y for _, y, _ in part['points']) - part['ground'] for part in parts)
        sites.append(dict(id=key, name=name, district=district, road=road,
                          x=round((min(xs) + max(xs)) / 2, 2), z=round((min(zs) + max(zs)) / 2, 2),
                          height=round(height, 2), focusHeight=round(height * .42, 1),
                          approach=dict(x=ax, z=az), osmId=sources[0][1],
                          annexOsmIds=[osm for _, osm in sources[1:]], bagIds=[bag for bag, _ in sources]))
        lines.append(f"  '{key}': [")
        for part in parts:
            lines.append('    {')
            for prop, value in part.items():
                if prop in ('points', 'faces'):
                    lines.append(f'      {prop}: [')
                    lines.extend('        ' + ', '.join(map(compact, value[i:i + 6])) + ','
                                 for i in range(0, len(value), 6))
                    lines.append('      ],')
                else:
                    lines.append(f'      {prop}: {compact(value)},')
            lines.append('    },')
        lines.append('  ],')
    lines.extend([
        '};', '',
        'const sites = [', *('  ' + compact(site) + ',' for site in sites), '].map(site => ({',
        '  ...site, worldSpace: true, mapScenic: true,',
        '  surveyFootprints: INDUSTRIAL_SKYLINE_SHELLS[site.id].map(({ outline, parcelOutline }) => {',
        '    const [outer, ...holes] = parcelOutline ?? outline;',
        '    return {',
        '      outer: outer.map(([x, z]) => ({ x, z })),',
        '      holes: holes.map(ring => ring.map(([x, z]) => ({ x, z }))),',
        '    };',
        '  }),',
        '}));',
        '', 'const [NIZO_NORTH_SITE, ...EDE_INDUSTRIAL_SKYLINE_LANDMARKS] = sites;',
        'export { NIZO_NORTH_SITE, EDE_INDUSTRIAL_SKYLINE_LANDMARKS };',
    ])
    args.output.write_text('\n'.join(lines) + '\n')


if __name__ == '__main__':
    main()
